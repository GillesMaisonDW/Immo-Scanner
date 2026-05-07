const express    = require('express');
const path       = require('path');
const { createClient } = require('@supabase/supabase-js');
const app        = express();
// ── Config ────────────────────────────────────────────────────────
const PORT           = process.env.PORT || 3000;
const API_KEY        = process.env.ANTHROPIC_API_KEY;
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SUPABASE_URL   = process.env.SUPABASE_URL   || 'https://esnpeegulhbcyjnvszaf.supabase.co';
const SUPABASE_KEY   = process.env.SUPABASE_ANON_KEY;
// ── Supabase client ───────────────────────────────────────────────
const supabase = SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
if (!supabase) console.warn('Supabase ANON KEY niet ingesteld.');
if (!API_KEY)  console.warn('ANTHROPIC_API_KEY niet ingesteld!');
// ── Middleware ────────────────────────────────────────────────────
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));
// ================================================================
//  HULPFUNCTIES
// ================================================================
// ── URL verificatie ───────────────────────────────────────────────
async function checkUrlActief(url) {
  if (!url) return null;
  try {
    const resp = await fetch(url, {
      method: 'HEAD', redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ImmoScanner/1.0)' },
      signal: AbortSignal.timeout(6000)
    });
    if (resp.status === 404 || resp.status === 410) return false;
    if (resp.status >= 200 && resp.status < 400) return true;
    return null;
  } catch (e) {
    console.warn('URL check mislukt voor', url, ':', e.message);
    return null;
  }
}
// ── Diepte-zoekactie in JSON-object ──────────────────────────────
function _deepFind(obj, sleutel, maxDiepte = 8) {
  if (!obj || typeof obj !== 'object' || maxDiepte === 0) return undefined;
  if (sleutel in obj) return obj[sleutel];
  for (const waarde of Object.values(obj)) {
    const gevonden = _deepFind(waarde, sleutel, maxDiepte - 1);
    if (gevonden !== undefined) return gevonden;
  }
  return undefined;
}
// ── Details extraheren uit HTML detailpagina ─────────────────────
function _extractDetailsUitHtml(html, urlLabel) {
  let adres = null, prijs = null, slaapkamers = null, oppervlakte = null;
  // Methode 1: JSON-LD
  const jsonldRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let jm;
  while ((jm = jsonldRegex.exec(html)) !== null) {
    try {
      const ld = JSON.parse(jm[1]);
      if (!adres) {
        const straat   = _deepFind(ld, 'streetAddress');
        const postcode = _deepFind(ld, 'postalCode');
        const regio    = _deepFind(ld, 'addressRegion');
        if (straat && typeof straat === 'string' && straat.length > 3) {
          const delen = [straat.trim()];
          if (postcode || regio) delen.push([postcode, regio].filter(Boolean).join(' '));
          adres = delen.join(', ');
          console.log(`📍 Adres via JSON-LD (${urlLabel}): ${adres}`);
        }
      }
      if (!prijs) {
        const prijsRaw = _deepFind(ld, 'price');
        if (prijsRaw != null) {
          const p = parseFloat(String(prijsRaw).replace(/[^\d.,]/g, '').replace(',', '.'));
          if (!isNaN(p) && p > 10000) prijs = `EUR ${Math.round(p).toLocaleString('nl-BE')}`;
        }
      }
      if (!slaapkamers) {
        const kamers = _deepFind(ld, 'numberOfBedrooms') || _deepFind(ld, 'numberOfRooms');
        if (kamers != null) slaapkamers = parseInt(kamers) || null;
      }
      if (!oppervlakte) {
        const vloer = _deepFind(ld, 'floorSize');
        if (vloer != null) {
          const m2 = typeof vloer === 'object' ? (vloer.value ?? vloer) : vloer;
          oppervlakte = parseFloat(m2) || null;
        }
      }
    } catch {}
  }
  // Methode 2: og:title
  if (!adres) {
    const ogTitleMatch = html.match(/<meta[^>]*(?:name|property)="og:title"[^>]*content="([^"]+)"/i)
      || html.match(/<meta[^>]*content="([^"]+)"[^>]*(?:name|property)="og:title"/i);
    if (ogTitleMatch) {
      const adresMatch = ogTitleMatch[1].match(/[-\u2013]\s*([A-Z][^,]{4,50},\s*\d{4}\s+\S[^"]{2,40})/);
      if (adresMatch) {
        adres = adresMatch[1].trim();
        console.log(`📍 Adres via og:title (${urlLabel}): ${adres}`);
      }
    }
  }
  // Methode 3: __NEXT_DATA__
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const nd   = JSON.parse(nextMatch[1]);
      const pp   = nd?.props?.pageProps || {};
      const prop = pp.property || pp.listing || pp.classified || pp.result || {};
      if (!adres) {
        const loc      = prop.location || prop.address || {};
        const straat   = loc.street || loc.streetAddress || loc.straat || null;
        const nr       = loc.number || loc.houseNumber || '';
        const gemeente = loc.locality || loc.city || loc.gemeente || '';
        if (straat) {
          const a = [straat, nr].filter(Boolean).join(' ').trim();
          adres = gemeente ? `${a}, ${gemeente}` : a;
          console.log(`📍 Adres via __NEXT_DATA__ (${urlLabel}): ${adres}`);
        }
      }
      if (!prijs) {
        const p = prop.price?.value ?? prop.price ?? prop.asking_price ?? null;
        if (p != null) {
          const val = parseFloat(String(p).replace(/[^\d.,]/g, '').replace(',', '.'));
          if (!isNaN(val) && val > 10000) prijs = `EUR ${Math.round(val).toLocaleString('nl-BE')}`;
        }
      }
      if (!slaapkamers) slaapkamers = parseInt(prop.bedroomCount || prop.bedrooms || prop.slaapkamers) || null;
      if (!oppervlakte) oppervlakte = parseFloat(prop.surface || prop.area || prop.floorSize?.value) || null;
    } catch {}
  }
  // Methode 4: Adres via regex
  if (!adres) {
    const adresPatterns = [
      /"streetAddress"\s*:\s*"([^"]{5,80})"/i,
      /"adres"\s*:\s*"([^"]{5,80})"/i,
      /"address"\s*:\s*"([^"]{5,80})"/i,
    ];
    for (const pattern of adresPatterns) {
      const match = html.match(pattern);
      if (match) { adres = match[1].trim(); break; }
    }
  }
  // Methode 5: Prijs via regex
  if (!prijs) {
    const prijsPatterns = [/"price"\s*:\s*(\d{5,7})/i, /"prijs"\s*:\s*(\d{5,7})/i, /"asking_price"\s*:\s*(\d{5,7})/i];
    for (const p of prijsPatterns) {
      const m = html.match(p);
      if (m) {
        const val = parseInt(m[1]);
        if (val > 10000) { prijs = `EUR ${val.toLocaleString('nl-BE')}`; break; }
      }
    }
  }
  if (prijs)       console.log(`💰 Prijs via detailpagina (${urlLabel}): ${prijs}`);
  if (slaapkamers) console.log(`🛏️  Slaapkamers (${urlLabel}): ${slaapkamers}`);
  if (oppervlakte) console.log(`📐 Oppervlakte (${urlLabel}): ${oppervlakte}m2`);
  return { adres, prijs, slaapkamers, oppervlakte };
}
function _extractAdresUitHtml(html, urlLabel) {
  return _extractDetailsUitHtml(html, urlLabel).adres;
}
// ── fetchDetailVanListing ─────────────────────────────────────────
async function fetchDetailVanListing(url) {
  if (!url) return { adres: null, prijs: null, slaapkamers: null, oppervlakte: null };
  try {
    const label = url.split('/').slice(-2).join('/');
    const directResp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (directResp.ok) {
      const html = await directResp.text();
      const detail = _extractDetailsUitHtml(html, label);
      if (!detail.adres) console.log(`Geen adres via directe fetch voor ${url} -- geen Puppeteer fallback`);
      return detail;
    }
    console.warn(`fetchDetailVanListing: HTTP ${directResp.status} voor ${url}`);
  } catch (e) {
    console.warn('fetchDetailVanListing fout:', e.message);
  }
  return { adres: null, prijs: null, slaapkamers: null, oppervlakte: null };
}
async function fetchAdresVanListing(url) {
  const detail = await fetchDetailVanListing(url);
  return detail.adres;
}
// ── Visuele gebouwbevestiging ─────────────────────────────────────
async function haalListingFotos(listingUrl) {
  const fotos = [];
  try {
    const resp = await fetch(listingUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8' },
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) return fotos;
    const html = await resp.text();
    const ogMatch = html.match(/<meta[^>]*(?:property|name)="og:image"[^>]*content="([^"]+)"/i)
      || html.match(/<meta[^>]*content="([^"]+)"[^>]*(?:property|name)="og:image"/i);
    if (ogMatch?.[1] && ogMatch[1].startsWith('http')) fotos.push(ogMatch[1]);
    const jsonldRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = jsonldRegex.exec(html)) !== null && fotos.length < 4) {
      try {
        const ld = JSON.parse(m[1]);
        const imgs = ld.image || ld.photo || [];
        const lijst = Array.isArray(imgs) ? imgs : [imgs];
        for (const img of lijst) {
          const url = typeof img === 'string' ? img : (img?.url || img?.contentUrl);
          if (url?.startsWith('http') && !fotos.includes(url)) fotos.push(url);
          if (fotos.length >= 4) break;
        }
      } catch {}
    }
    return [...new Set(fotos)].slice(0, 3);
  } catch (e) {
    console.warn('haalListingFotos fout:', e.message);
    return fotos;
  }
}
async function haalAfbeeldingAlsBase64(url) {
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(7000) });
    if (!resp.ok) return null;
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const mime = contentType.split(';')[0].trim();
    if (!mime.startsWith('image/')) return null;
    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength > 4 * 1024 * 1024) return null;
    return { data: Buffer.from(buffer).toString('base64'), mime };
  } catch (e) {
    console.warn('haalAfbeeldingAlsBase64 fout:', e.message);
    return null;
  }
}
async function _eenFotoVergelijking(bordBase64, bordMime, listingFoto, pogingNr) {
  const systeemPrompt = pogingNr === 1
    ? `Je vergelijkt twee fotos om te bepalen of ze hetzelfde gebouw tonen. Foto 1 = gsm-foto van een makelaarsbord, gebouw op achtergrond. Foto 2 = listing-foto. Kijk naar dakrand, zijgevels, ramen, gevelbekleding naast/boven het bord. Negeer seizoen, lichtomstandigheden, autos, beplanting. Antwoord ENKEL met deze JSON: {"match": "JA"|"NEE"|"ONZEKER", "reden": "max 12 woorden"}`
    : `Je vergelijkt twee fotos om te bepalen of ze hetzelfde gebouw tonen. Foto 1 = gsm-foto van makelaarsbord. Foto 2 = andere listing-foto. Let op gevelkleur, gevelmateriaal, raamverdeling, daktype. Antwoord ENKEL met deze JSON: {"match": "JA"|"NEE"|"ONZEKER", "reden": "max 12 woorden"}`;
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6', max_tokens: 150, temperature: 0, system: systeemPrompt,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: bordMime || 'image/jpeg', data: bordBase64 } },
        { type: 'image', source: { type: 'base64', media_type: listingFoto.mime, data: listingFoto.data } },
        { type: 'text', text: 'Zijn dit hetzelfde gebouw? Geef JSON.' }
      ]}]
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) throw new Error(`API fout ${resp.status}`);
  const data = await resp.json();
  const text = data.content?.find(b => b.type === 'text')?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) throw new Error('Geen JSON in response');
  return JSON.parse(jsonMatch[0]);
}
async function vergelijkGebouwen(bordBase64, bordMime, listingUrl) {
  try {
    const fotoUrls = await haalListingFotos(listingUrl);
    if (fotoUrls.length === 0) return { resultaat: 'niet_gecontroleerd', reden: 'Geen foto beschikbaar op listingpagina' };
    for (let i = 0; i < Math.min(fotoUrls.length, 3); i++) {
      const listingFoto = await haalAfbeeldingAlsBase64(fotoUrls[i]);
      if (!listingFoto) continue;
      const vgl = await _eenFotoVergelijking(bordBase64, bordMime, listingFoto, i + 1);
      const resultaat = vgl.match === 'JA' ? 'bevestigd' : vgl.match === 'NEE' ? 'twijfel' : 'onzeker';
      console.log(`📷 Visuele check (foto ${i + 1}/${fotoUrls.length}): ${resultaat} -- "${vgl.reden}"`);
      if (resultaat === 'bevestigd' || resultaat === 'twijfel') return { resultaat, reden: vgl.reden };
    }
    return { resultaat: 'onzeker', reden: 'Gebouw niet duidelijk zichtbaar' };
  } catch (e) {
    console.warn('vergelijkGebouwen fout:', e.message);
    return { resultaat: 'niet_gecontroleerd', reden: e.message };
  }
}
// ── Postcode → gemeente ───────────────────────────────────────────
const _postcodeCachce = {};
async function gemeenteViaPostcode(postcode, landcode) {
  if (!postcode || !landcode) return null;
  const cacheKey = `${landcode}-${postcode}`;
  if (_postcodeCachce[cacheKey]) return _postcodeCachce[cacheKey];
  try {
    const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(postcode)}&country=${landcode}&format=json&limit=1&addressdetails=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'ImmoScannerApp/1.0 (gilles@maisondw.be)' }, signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || data.length === 0) return null;
    const addr = data[0].address || {};
    const gemeente = addr.city || addr.town || addr.village || addr.municipality || null;
    if (gemeente) { _postcodeCachce[cacheKey] = gemeente.toLowerCase(); }
    return gemeente ? gemeente.toLowerCase() : null;
  } catch (e) { console.warn('Postcode lookup fout:', e.message); return null; }
}
// ── Reverse geocoding ─────────────────────────────────────────────
const _geocodeCache = new Map();
async function _geocodeViaPhoton(lat, lon) {
  try {
    const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'ImmoScannerApp/1.0 (gilles@maisondw.be)' }, signal: AbortSignal.timeout(6000) });
    if (!resp.ok) { console.warn(`Photon HTTP fout: ${resp.status}`); return null; }
    const data = await resp.json();
    const props = data?.features?.[0]?.properties;
    if (!props) return null;
    const straat     = props.street || null;
    const huisnummer = props.housenumber ? String(props.housenumber).trim() : null;
    const postcode   = props.postcode || null;
    const landcode   = (props.countrycode || 'BE').toUpperCase();
    const gemeente   = props.city || props.town || props.village || props.municipality || null;
    console.log(`🗺️  Photon: straat=${straat}, huisnummer=${huisnummer}, postcode=${postcode}, gemeente=${gemeente}`);
    return { straat, huisnummer, gemeente, hoofdgemeente: gemeente?.toLowerCase() || null, postcode, landcode };
  } catch (e) { console.warn('Photon fout:', e.message); return null; }
}
async function _geocodeViaBigDataCloud(lat, lon) {
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=nl`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'ImmoScannerApp/1.0 (gilles@maisondw.be)' }, signal: AbortSignal.timeout(6000) });
    if (!resp.ok) { console.warn(`BigDataCloud HTTP fout: ${resp.status}`); return null; }
    const data = await resp.json();
    const postcode = data.postcode || null;
    const landcode = (data.countryCode || 'BE').toUpperCase();
    const gemeente = data.city || data.locality || null;
    const straat   = data.localityInfo?.place?.find(p => p.isoName?.toLowerCase().includes('road') || p.description?.toLowerCase().includes('street'))?.name || null;
    console.log(`🗺️  BigDataCloud: straat=${straat}, postcode=${postcode}, gemeente=${gemeente}`);
    return { straat, gemeente, hoofdgemeente: gemeente?.toLowerCase() || null, postcode, landcode };
  } catch (e) { console.warn('BigDataCloud fout:', e.message); return null; }
}
async function _geocodeViaNominatim(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
    let resp = await fetch(url, { headers: { 'User-Agent': 'ImmoScannerApp/1.0 (gilles@maisondw.be)' }, signal: AbortSignal.timeout(8000) });
    if (resp.status === 429) {
      await new Promise(r => setTimeout(r, 2000));
      resp = await fetch(url, { headers: { 'User-Agent': 'ImmoScannerApp/1.0 (gilles@maisondw.be)' }, signal: AbortSignal.timeout(8000) });
    }
    if (!resp.ok) { console.warn(`Nominatim HTTP fout: ${resp.status}`); return null; }
    const data = await resp.json();
    const addr = data.address || {};
    const postcode     = addr.postcode || null;
    const landcode     = addr.country_code?.toUpperCase() || 'BE';
    const deelgemeente = addr.village || addr.suburb || null;
    const hoofdstad    = addr.city || addr.town || addr.municipality || null;
    const straat       = addr.road || addr.pedestrian || addr.square || addr.path || null;
    const huisnummer   = addr.house_number ? String(addr.house_number).trim() : null;
    console.log(`🗺️  Nominatim: straat=${straat}, huisnummer=${huisnummer}, postcode=${postcode}, gemeente=${deelgemeente || hoofdstad}`);
    return { straat, huisnummer, gemeente: deelgemeente || hoofdstad, hoofdgemeente: hoofdstad?.toLowerCase() || deelgemeente?.toLowerCase() || null, postcode, landcode };
  } catch (e) { console.warn('Nominatim fout:', e.message); return null; }
}
function _normaliseHuisnummer(tekst) {
  if (!tekst) return '';
  return String(tekst).toLowerCase().replace(/[\s\/\-]/g, '');
}
async function reverseGeocode(lat, lon) {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return null;
  const cacheKey = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
  if (_geocodeCache.has(cacheKey)) return _geocodeCache.get(cacheKey);
  let resultaat = await _geocodeViaPhoton(lat, lon);
  if (!resultaat?.straat) {
    const fallback = await _geocodeViaBigDataCloud(lat, lon);
    if (fallback?.straat) resultaat = fallback;
  }
  if (!resultaat?.straat) {
    const fallback = await _geocodeViaNominatim(lat, lon);
    if (fallback?.straat) resultaat = fallback;
  }
  if (resultaat) {
    if (_geocodeCache.size >= 200) _geocodeCache.delete(_geocodeCache.keys().next().value);
    _geocodeCache.set(cacheKey, resultaat);
  }
  return resultaat;
}
// ── Makelaar database ─────────────────────────────────────────────
let _makelaarsCacheTs = 0;
let _makelaarsCache   = [];
const CACHE_TTL_MS    = 5 * 60 * 1000;
async function laadMakelaarsUitSupabase() {
  const nu = Date.now();
  if (nu - _makelaarsCacheTs < CACHE_TTL_MS && _makelaarsCache.length > 0) return _makelaarsCache;
  if (!supabase) return [];
  const { data, error } = await supabase.from('makelaars').select('domein, naam, koop_url, huur_url, immoweb_agency_id').order('bevestigd', { ascending: false });
  if (error) { console.warn('Makelaars laden mislukt:', error.message); return []; }
  _makelaarsCache   = data || [];
  _makelaarsCacheTs = nu;
  console.log(`🏢 ${_makelaarsCache.length} makelaars geladen uit Supabase`);
  return _makelaarsCache;
}
// ── Beschikbaarheidscheck ─────────────────────────────────────────
async function isNietBeschikbaar(url) {
  if (!url) return false;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ImmoScanner/1.0)' }, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return false;
    const html = await resp.text();
    const tekst = html.toLowerCase();
    const tekstSignalen = ['verkocht','vendu','sold','verkauft','verhuurd','loue','rented','vermietet','onder compromis','sous compromis','under offer','onder bod','onder optie','sous option','niet meer beschikbaar','plus disponible','no longer available','reeds verhuurd','reeds verkocht','al verhuurd','al verkocht','helaas niet meer','dit pand is niet meer','deze woning is niet meer','pand is al','woning is al','dit object is'];
    const cssSignalen = ['class="sold"','class="verkocht"','class="vendu"','status--sold','property-sold','listing-sold','data-status="sold"','"sold":true','"is_sold":true','"status":"sold"'];
    const tekstTreffer = tekstSignalen.find(s => tekst.includes(s));
    if (tekstTreffer) { console.log(`Niet beschikbaar (tekst: "${tekstTreffer}"): ${url}`); return true; }
    const cssTreffer = cssSignalen.find(s => tekst.includes(s));
    if (cssTreffer) { console.log(`Niet beschikbaar (CSS: "${cssTreffer}"): ${url}`); return true; }
    return false;
  } catch (e) { return false; }
}
function vulUrlIn(template, gemeente, postcode) {
  if (!template) return null;
  return template.replace(/\{gemeente\}/g, (gemeente || 'gent').toLowerCase()).replace(/\{postcode\}/g, postcode || '9000');
}
async function voegMakelaarToeAanSupabase(domein, naam, koopUrl, huurUrl, telefoon) {
  if (!supabase || !domein) return;
  const record = { domein, naam: naam || domein, koop_url: koopUrl || null, huur_url: huurUrl || null, toegevoegd_door: 'automatisch', bevestigd: false, updated_at: new Date().toISOString() };
  if (telefoon) record.telefoon = telefoon;
  const { error } = await supabase.from('makelaars').upsert(record, { onConflict: 'domein', ignoreDuplicates: false });
  if (error) console.warn('Makelaar toevoegen mislukt:', error.message);
  else { console.log(`Makelaar "${naam || domein}" (${domein}) opgeslagen`); _makelaarsCacheTs = 0; }
}
// ── Puppeteer ─────────────────────────────────────────────────────
let _chromium  = null;
let _puppeteer = null;
let _browser   = null;
let _browserLastUsed = 0;
async function laadPuppeteer() {
  if (_chromium && _puppeteer) return true;
  try {
    // Dynamische import werkt zowel voor ESM- als CJS-pakketten.
    // require() faalt voor ESM-only pakketten zoals nieuwere versies van @sparticuz/chromium.
    const chromiumMod  = await import('@sparticuz/chromium');
    const puppeteerMod = await import('puppeteer-core');
    _chromium  = chromiumMod.default  ?? chromiumMod;
    _puppeteer = puppeteerMod.default ?? puppeteerMod;
    return true;
  } catch (e) {
    console.warn('Puppeteer niet beschikbaar:', e.message);
    return false;
  }
}
async function getPuppeteerBrowser() {
  if (_browser) {
    try { if (_browser.isConnected()) { _browserLastUsed = Date.now(); return _browser; } } catch (_) {}
    _browser = null;
  }
  if (!(await laadPuppeteer())) return null;
  try {
    const execPath = await _chromium.executablePath();
    _browser = await _puppeteer.launch({ args: [..._chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run','--no-zygote','--single-process'], defaultViewport: _chromium.defaultViewport, executablePath: execPath, headless: _chromium.headless, ignoreHTTPSErrors: true });
    _browserLastUsed = Date.now();
    return _browser;
  } catch (e) { console.warn('Browser starten mislukt:', e.message); _browser = null; return null; }
}
setInterval(() => {
  if (_browser && Date.now() - _browserLastUsed > 3 * 60 * 1000) {
    _browser.close().catch(() => {}); _browser = null;
  }
}, 60 * 1000);
async function fetchWithPuppeteer(url, timeout = 20000) {
  const browser = await getPuppeteerBrowser();
  if (!browser) return null;
  let page = null;
  try {
    page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');
    await page.setRequestInterception(true);
    page.on('request', req => { const t = req.resourceType(); if (['image','font','media'].includes(t)) req.abort(); else req.continue(); });
    await page.goto(url, { waitUntil: 'load', timeout });
    await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight / 2); });
    await new Promise(r => setTimeout(r, 800));
    await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
    await new Promise(r => setTimeout(r, 1200));
    const html = await page.content();
    return html;
  } catch (e) {
    console.warn('Puppeteer fetch fout voor', url, ':', e.message);
    if (_browser) { _browser.close().catch(() => {}); _browser = null; }
    return null;
  } finally { if (page) await page.close().catch(() => {}); }
}
async function slimFetchHtml(url) {
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8' }, signal: AbortSignal.timeout(10000) });
    if (!resp.ok) { console.warn(`slimFetchHtml: HTTP ${resp.status} voor ${url}`); }
    else {
      const html = await resp.text();
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const zichtbareTekst = (bodyMatch?.[1] || html).replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
      if (zichtbareTekst.length >= 800) return html;
    }
  } catch (e) { console.warn(`slimFetchHtml mislukt voor ${url}: ${e.message}`); }
  return await fetchWithPuppeteer(url);
}
// ── fetchDetailMetPuppeteer ───────────────────────────────────────
// Voor de definitief gevonden listing — met echte Puppeteer fallback.
// Verschil met slimFetchHtml: die checkt enkel op tekst-lengte (≥800 tekens).
// JS-sites zoals huysewinkel.be hebben genoeg navigatietekst om die drempel te halen,
// maar de listing-data is nog niet gerenderd. Hier checken we op ECHTE data.
async function fetchDetailMetPuppeteer(url) {
  if (!url) return { adres: null, prijs: null, slaapkamers: null, oppervlakte: null };
  const label = url.split('/').slice(-2).join('/');
  // Stap 1: directe fetch — snel, werkt voor SSR-sites
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (resp.ok) {
      const html = await resp.text();
      const detail = _extractDetailsUitHtml(html, label);
      // Alleen teruggeven als we echt iets nuttig gevonden hebben
      if (detail.adres || detail.prijs || detail.slaapkamers) {
        console.log(`  fetchDetailMetPuppeteer: data via directe fetch (${label})`);
        return detail;
      }
      console.log(`  fetchDetailMetPuppeteer: directe fetch leeg → Puppeteer (${label})`);
    } else {
      console.warn(`  fetchDetailMetPuppeteer: HTTP ${resp.status} voor ${url}`);
    }
  } catch (e) {
    console.warn(`  fetchDetailMetPuppeteer directe fetch fout (${label}):`, e.message);
  }
  // Stap 2: Puppeteer — voor JS-zware sites (React/Vue zonder SSR)
  // Puppeteer voert JS uit en wacht tot de pagina geladen is
  try {
    console.log(`  fetchDetailMetPuppeteer: Puppeteer starten voor ${label}...`);
    const html = await fetchWithPuppeteer(url, 25000);
    if (html) {
      const detail = _extractDetailsUitHtml(html, label);
      if (detail.adres || detail.prijs || detail.slaapkamers) {
        console.log(`  fetchDetailMetPuppeteer: data via Puppeteer (${label})`);
      } else {
        console.log(`  fetchDetailMetPuppeteer: ook Puppeteer gaf geen data (${label})`);
      }
      return detail;
    }
  } catch (e) {
    console.warn(`  fetchDetailMetPuppeteer Puppeteer fout (${label}):`, e.message);
  }
  return { adres: null, prijs: null, slaapkamers: null, oppervlakte: null };
}
// ── Auto-ontdekking makelaar URLs ─────────────────────────────────
async function ontdekMakelaarUrls(domein) {
  const homepage = `https://${domein.startsWith('www.') ? domein : 'www.' + domein}`;
  const html = await slimFetchHtml(homepage);
  if (!html) return { koopUrl: null, huurUrl: null };
  const alleLinks = [];
  const linkRegex = /href="([^"]{5,120})"/g;
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    let href = m[1];
    if (href.startsWith('/')) href = `https://${domein.startsWith('www.') ? domein : 'www.' + domein}${href}`;
    if (href.startsWith('http') && href.includes(domein.replace('www.',''))) alleLinks.push(href);
  }
  const koopKandidaten = alleLinks.filter(l => /te-koop|tekoop|\/koop|\/sale|\/properties|\/aanbod/i.test(l)).sort((a,b) => a.length - b.length);
  const huurKandidaten = alleLinks.filter(l => /te-huur|tehuur|\/huur|\/rent|\/location|\/verhuur/i.test(l)).sort((a,b) => a.length - b.length);
  const kiesBesteUrl = (kandidaten) => { for (const url of kandidaten) { const pad = url.replace(/https?:\/\/[^/]+/,''); if (pad.split('/').filter(Boolean).length <= 3) return url; } return kandidaten[0] || null; };
  const koopUrl = kiesBesteUrl(koopKandidaten);
  const huurUrl = kiesBesteUrl(huurKandidaten);
  console.log(`🔍 Ontdekte URLs voor ${domein}: koop=${koopUrl}, huur=${huurUrl}`);
  if (supabase && (koopUrl || huurUrl)) {
    const { error } = await supabase.from('makelaars').update({ koop_url: koopUrl || null, huur_url: huurUrl || null, updated_at: new Date().toISOString() }).eq('domein', domein);
    if (!error) { _makelaarsCacheTs = 0; }
  }
  return { koopUrl, huurUrl };
}
// ── Adres-verrijking ──────────────────────────────────────────────
async function verrijkListingAdressen(listings, hoofdgemeente, postcode, straatGps) {
  if (!listings || listings.length === 0) return listings;
  const gem      = (hoofdgemeente || '').toLowerCase().replace(/\s+/g,'-');
  const pc       = (postcode || '').toString();
  const straatLw = (straatGps || '').toLowerCase();
  const zonderAdres = listings.filter(l => !l.address && l.url);
  const isLokaal = (l) => { const urlLow = (l.url || '').toLowerCase(); return (pc && urlLow.includes(pc)) || (gem && gem.length > 2 && urlLow.includes(gem)); };
  const lokaal = zonderAdres.filter(isLokaal);
  const overig = zonderAdres.filter(l => !isLokaal(l));
  const extractId = (l) => parseInt((l.url || '').split('/').pop()) || 0;
  lokaal.sort((a,b) => extractId(b) - extractId(a));
  const maxKandidaten = straatLw ? Math.min(lokaal.length + overig.length, 30) : 10;
  const kandidaten = [...lokaal, ...overig].slice(0, maxKandidaten);
  if (kandidaten.length === 0) return listings;
  console.log(`📍 Adres ophalen voor max ${kandidaten.length} listings (${lokaal.length} lokaal${straatLw ? `, early exit op "${straatGps}"` : ''})`);
  let opeenvolgendeMislukkingen = 0;
  for (const listing of kandidaten) {
    try {
      const adres = await fetchAdresVanListing(listing.url);
      if (adres) {
        opeenvolgendeMislukkingen = 0;
        listing.address = adres;
        if (straatLw && adres.toLowerCase().includes(straatLw)) { console.log(`✅  GPS-straat "${straatGps}" gevonden -- stop`); break; }
      } else {
        opeenvolgendeMislukkingen++;
        if (opeenvolgendeMislukkingen >= 5) {
          console.log(`⏭️  5 opeenvolgende mislukkingen — JS-site waarschijnlijk, stop adres ophalen (STAP 3 zoekt verder)`);
          break;
        }
      }
    } catch (e) {
      opeenvolgendeMislukkingen++;
      console.warn(`  Adres ophalen mislukt voor ${listing.url}: ${e.message}`);
      if (opeenvolgendeMislukkingen >= 5) {
        console.log(`⏭️  5 opeenvolgende mislukkingen — JS-site waarschijnlijk, stop adres ophalen`);
        break;
      }
    }
  }
  return listings;
}
// ── searchMakelaar ────────────────────────────────────────────────
async function searchMakelaar(makelaarNaam, listingType, gemeente, postcode, makelaarWebsite) {
  const normaliseer  = (s) => (s || '').toLowerCase().replace(/[-\s]+/g,' ').trim();
  const naamLower    = normaliseer(makelaarNaam);
  const websiteLower = (makelaarWebsite || '').toLowerCase().replace('www.','');
  const makelaars = await laadMakelaarsUitSupabase();
  let match = null;
  for (const m of makelaars) {
    const siteNorm    = normaliseer(m.domein.replace(/\.(be|com|nl|immo|eu|net|org)$/,''));
    const domeinClean = m.domein.replace('www.','');
    if (websiteLower && (websiteLower === domeinClean || websiteLower.includes(domeinClean) || domeinClean.includes(websiteLower))) { match = m; break; }
    const eersteWoord = naamLower.split(' ')[0];
    if (naamLower.includes(siteNorm) || (eersteWoord.length >= 5 && siteNorm.includes(eersteWoord))) { match = m; break; }
    const woorden = naamLower.split(' ').filter(w => w.length > 2);
    if (woorden.length > 0 && woorden.every(w => siteNorm.includes(w))) { match = m; break; }
  }
  if (!match) { console.log(`❓ Makelaar "${makelaarNaam}" niet in database`); return []; }
  const domein = match.domein;
  const isHuur = listingType === 'Te huur';
  let urlTemplate = isHuur ? match.huur_url : match.koop_url;
  const gem = gemeente?.toLowerCase() || 'gent';
  const pc  = postcode || '9000';
  if (!urlTemplate) {
    const ontdekt = await ontdekMakelaarUrls(domein);
    urlTemplate = isHuur ? ontdekt.huurUrl : ontdekt.koopUrl;
    if (!urlTemplate) { console.log(`URL-ontdekking mislukt voor ${domein}`); return []; }
  }
  const url = vulUrlIn(urlTemplate, gem, pc);
  if (!url) return [];
  console.log(`🔍 Makelaar ${domein} rechtstreeks ophalen:`, url);
  try {
    const html = await slimFetchHtml(url);
    if (!html) { console.warn(`Makelaarsite ophalen mislukt voor ${url}`); return []; }
    console.log(`📄 ${domein} HTML: ${html.length} bytes`);
    const listings = [];
    // Methode 1: __NEXT_DATA__
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const nd = JSON.parse(nextMatch[1]);
        const pp = nd?.props?.pageProps || {};
        const results = pp.properties || pp.listings || pp.results || pp.classifieds || pp.estates || pp.items || pp.data?.properties || pp.data?.listings || pp.data?.results || [];
        if (Array.isArray(results) && results.length > 0) {
          for (const item of results.slice(0,25)) {
            const loc = item.location || item.address || {};
            listings.push({ id: item.id || item.reference, title: item.title || item.name || `${item.type||''} ${item.subtype||''}`.trim(), url: item.url || item.link || null, price: item.price?.value ? `EUR ${item.price.value}` : (item.price ? `EUR ${item.price}` : null), address: [loc.street, loc.number, loc.locality||loc.city].filter(Boolean).join(' ') || null, bedrooms: item.bedroomCount || item.bedrooms || null, area: item.surface || item.area || null, bron: `${domein}_nextdata` });
          }
        }
      } catch (e) { console.warn(`${domein} __NEXT_DATA__ fout:`, e.message); }
    }
    // Methode 2: JSON-LD
    const jsonldRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
    let jm;
    while ((jm = jsonldRegex.exec(html)) !== null) {
      try {
        const ld = JSON.parse(jm[1]);
        const items = ld['@type'] === 'ItemList' ? (ld.itemListElement || []) : [ld];
        for (const item of items) {
          const thing = item.item || item;
          if (thing.url && (thing['@type'] === 'RealEstateListing' || thing.offers)) {
            listings.push({ title: thing.name || 'Listing', url: thing.url, price: thing.offers?.price ? `EUR ${thing.offers.price}` : null, address: thing.address?.streetAddress || null, bron: `${domein}_jsonld` });
          }
        }
      } catch {}
    }
    // Methode 3: Regex links
    const linkRegex = /href="((?:https?:\/\/[^"]*)?\/(?:te-huur|te-koop|huur|koop|detail|listing|property|aanbod|object|pand|woning|appartement)[\/\-][^"]{5,120})"/gi;
    let lm;
    const seenUrls = new Set(listings.map(l => l.url));
    while ((lm = linkRegex.exec(html)) !== null) {
      let href = lm[1];
      if (!href.startsWith('http')) href = `https://${domein}${href}`;
      const hrefZonderQuery = href.split('?')[0];
      // Sla statische bestanden over — nooit een listing-URL
      if (/\.(css|js|jpg|jpeg|png|gif|svg|ico|woff|woff2|ttf|eot|pdf|map)$/i.test(hrefZonderQuery)) continue;
      if (!seenUrls.has(hrefZonderQuery) && hrefZonderQuery.split('/').length > 3) {
        seenUrls.add(hrefZonderQuery);
        const urlSegmenten = hrefZonderQuery.split('/').filter(Boolean);
        const beschrijvend = urlSegmenten.slice(-2).find(s => !/^\d+$/.test(s)) || urlSegmenten[urlSegmenten.length-1] || 'Listing';
        listings.push({ url: hrefZonderQuery, title: beschrijvend.replace(/-/g,' '), bron: `${domein}_regex` });
      }
    }
    console.log(`🏠 ${domein}: ${listings.length} listings gevonden`);
    return listings;
  } catch (e) { console.warn(`Makelaarsite fetch fout voor ${domein}:`, e.message); return []; }
}
// ── searchImmoweb ─────────────────────────────────────────────────
async function searchImmoweb(pandType, listingType, gemeente, postcode) {
  const typeMap = { 'appartement':'appartement','duplex':'duplex','studio':'studio','penthouse':'penthouse','loft':'loft','kot':'kot','woning':'huis','huis':'huis','rijwoning':'huis','villa':'huis','fermette':'huis','herenwoning':'huis','bel-etage':'huis','bungalow':'huis','chalet':'huis','grond':'grond','bouwgrond':'grond','handelspand':'handelspand','kantoor':'kantoor','garage':'garage','parkeerplaats':'garage' };
  const transactieMap = { 'Te koop':'te-koop', 'Te huur':'te-huur' };
  const type       = typeMap[pandType?.toLowerCase()] || 'appartement';
  const transactie = transactieMap[listingType] || 'te-huur';
  const gem        = (gemeente || 'gent').toLowerCase().replace(/\s+/g,'-');
  const pc         = postcode || '9000';
  const typesToTry = [type];
  if (type === 'duplex') typesToTry.push('appartement');
  if (type === 'huis')   typesToTry.push('woning');
  const allListings = [];
  for (const t of typesToTry) {
    const url = `https://www.immoweb.be/nl/zoeken/${t}/${transactie}/${gem}/${pc}?orderBy=relevance`;
    console.log('Immoweb ophalen:', url);
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8' }, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) { console.warn('Immoweb HTTP', resp.status); continue; }
      const html = await resp.text();
      // __NEXT_DATA__
      const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextMatch) {
        try {
          const nextData = JSON.parse(nextMatch[1]);
          const pageProps = nextData?.props?.pageProps || {};
          const searchData = pageProps.searchResults?.results || pageProps.results || pageProps.classifieds || pageProps.searchState?.results || [];
          if (Array.isArray(searchData) && searchData.length > 0) {
            for (const item of searchData.slice(0,20)) {
              const prop = item.property || item;
              const loc  = prop.location || {};
              const price = item.price || item.transaction?.sale?.price || item.transaction?.rental?.monthlyRentalPrice || {};
              allListings.push({ id: item.id || item.classified?.id || null, title: item.title || `${prop.type||''} ${prop.subtype||''}`.trim(), url: item.id ? `https://www.immoweb.be/nl/zoekertje/${t}/${transactie}/${gem}/${pc}/${item.id}` : null, price: price.mainValue ? `EUR ${price.mainValue.toLocaleString('nl-BE')}` : (price.value ? `EUR ${price.value}` : null), address: [loc.street, loc.number, loc.locality].filter(Boolean).join(' ') || null, postcode: loc.postalCode || null, bedrooms: prop.bedroomCount || null, area: prop.netHabitableSurface || prop.surface || null, agency: item.customerName || null, bron: 'immoweb_nextdata' });
            }
          }
        } catch (e) { console.warn('__NEXT_DATA__ fout:', e.message); }
      }
      // Regex URLs
      const urlRegex = /href="(\/nl\/zoekertje\/[^"]+\/(\d{5,}))/g;
      let urlMatch;
      const seenIds = new Set(allListings.map(l => String(l.id)));
      while ((urlMatch = urlRegex.exec(html)) !== null) {
        const listingId = urlMatch[2];
        if (!seenIds.has(listingId)) { seenIds.add(listingId); allListings.push({ id: listingId, title: `Listing ${listingId}`, url: `https://www.immoweb.be${urlMatch[1]}`, bron: 'immoweb_regex' }); }
      }
    } catch (e) { console.warn('Immoweb fetch fout:', e.message); }
  }
  const unique = [];
  const seen = new Set();
  for (const l of allListings) { const key = l.id || l.url; if (key && !seen.has(key)) { seen.add(key); unique.push(l); } }
  console.log(`Immoweb totaal: ${unique.length} unieke listings`);
  return unique;
}
// ── Immoweb agentschapspagina direct scrapen ──────────────────────
// Omzeilt Google search: fetcht de makelaarspagina op Immoweb rechtstreeks.
// Voordeel: altijd de meest actuele listings van die makelaar, zonder Google-ruis.
async function zoekImmowebViaAgentschap(agencyId, straat, postcode, pandType, makelaarNaam) {
  if (!agencyId) return null;
  // URL-formaat: /nl/agentschap/[slug]/[id] — slug = makelaarsnaam als kebab-case
  // Immoweb gebruikt de slug voor SEO maar redirect bij verkeerde slug op basis van ID
  const slug = (makelaarNaam || 'kantoor')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'kantoor';
  const agencyUrl = `https://www.immoweb.be/nl/agentschap/${slug}/${agencyId}`;
  console.log(`🏢 Immoweb agentschap direct: ${agencyUrl}`);
  try {
    const resp = await fetch(agencyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8'
      },
      signal: AbortSignal.timeout(12000)
    });
    if (!resp.ok) {
      console.warn(`Immoweb agentschap HTTP ${resp.status} voor agency ${agencyId}`);
      return null;
    }
    const html = await resp.text();
    const listings = [];
    // Methode 1: __NEXT_DATA__ (meest betrouwbaar)
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const nd = JSON.parse(nextMatch[1]);
        const pp = nd?.props?.pageProps || {};
        // Immoweb agentschapspagina kan listings op meerdere plekken stoppen
        const results =
          pp.classifieds ||
          pp.listings ||
          pp.results ||
          pp.searchResults?.results ||
          pp.agency?.classifieds ||
          pp.data?.classifieds ||
          [];
        if (Array.isArray(results) && results.length > 0) {
          for (const item of results.slice(0, 50)) {
            const prop = item.property || item;
            const loc  = prop.location || item.location || {};
            const trans = item.transaction || {};
            const priceObj = item.price || trans.sale || trans.rental || {};
            const listingId = item.id || item.classified?.id || null;
            const gemeente  = (loc.locality || loc.city || '').toLowerCase().replace(/\s+/g, '-');
            const pc        = loc.postalCode || postcode || '';
            const typeSlug  = (prop.type || prop.subtype || pandType || 'appartement').toLowerCase();
            const transSlug = trans.type === 'FOR_RENT' ? 'te-huur' : 'te-koop';
            const listingUrl = listingId
              ? `https://www.immoweb.be/nl/zoekertje/${typeSlug}/${transSlug}/${gemeente}/${pc}/${listingId}`
              : null;
            listings.push({
              id:      listingId,
              url:     listingUrl,
              address: [loc.street, loc.number, loc.locality].filter(Boolean).join(' ') || null,
              postcode: pc || null,
              price:   priceObj.mainValue ? `EUR ${priceObj.mainValue.toLocaleString('nl-BE')}` : (priceObj.value ? `EUR ${priceObj.value}` : null),
              bedrooms: prop.bedroomCount || null,
              area:     prop.netHabitableSurface || prop.surface || null,
              bron:    'immoweb_agentschap'
            });
          }
          console.log(`  📋 Immoweb agentschap __NEXT_DATA__: ${listings.length} listings`);
        }
      } catch (e) { console.warn('Immoweb agentschap __NEXT_DATA__ fout:', e.message); }
    }
    // Methode 2: Regex op listing-URLs als fallback
    if (listings.length === 0) {
      const urlRegex = /href="(\/nl\/zoekertje\/[^"]+\/(\d{5,}))"/g;
      let m;
      const seenIds = new Set();
      while ((m = urlRegex.exec(html)) !== null) {
        const id  = m[2];
        const url = `https://www.immoweb.be${m[1]}`;
        if (!seenIds.has(id)) {
          seenIds.add(id);
          listings.push({ id, url, bron: 'immoweb_agentschap_regex' });
        }
      }
      console.log(`  📋 Immoweb agentschap regex: ${listings.length} listing-URLs`);
    }
    if (listings.length === 0) {
      console.warn(`  Immoweb agentschap ${agencyId}: geen listings geparsed`);
      return null;
    }
    // Filter op straat als GPS-straat beschikbaar
    if (straat && straat.length >= 4) {
      const straatLow = straat.toLowerCase();
      const metAdres  = listings.filter(l => l.address && l.address.toLowerCase().includes(straatLow));
      if (metAdres.length > 0) {
        console.log(`  ✅ Immoweb agentschap: ${metAdres.length} listing(s) matchen straat "${straat}"`);
        return metAdres[0].url;
      }
      // Geen adres in __NEXT_DATA__? Haal detail op van recente listings
      console.log(`  ⏳ Immoweb agentschap: adres niet in overzicht, detail ophalen voor ${Math.min(listings.length, 10)} listings...`);
      for (const listing of listings.slice(0, 10)) {
        if (!listing.url) continue;
        const detail = await fetchDetailVanListing(listing.url);
        if (detail?.adres && detail.adres.toLowerCase().includes(straatLow)) {
          console.log(`  ✅ Immoweb agentschap detail-match: ${listing.url} → ${detail.adres}`);
          return listing.url;
        }
      }
      console.log(`  ❌ Immoweb agentschap: geen listing met straat "${straat}" gevonden`);
      return null;
    }
    // Geen straat? Geef meest recente listing terug
    return listings[0]?.url || null;
  } catch (e) {
    console.warn('zoekImmowebViaAgentschap fout:', e.message);
    return null;
  }
}
// ── Makelaar afleiden via Immoweb op adres ────────────────────────
async function ontdekMakelaarViaAdres(straat, gemeente, postcode) {
  if (!straat || !gemeente) return null;
  const gem = gemeente.toLowerCase().replace(/\s+/g,'-');
  const pc  = postcode || '9000';
  const urls = [`https://www.immoweb.be/nl/zoeken/appartement/te-koop/${gem}/${pc}?orderBy=relevance`,`https://www.immoweb.be/nl/zoeken/huis/te-koop/${gem}/${pc}?orderBy=relevance`,`https://www.immoweb.be/nl/zoeken/appartement/te-huur/${gem}/${pc}?orderBy=relevance`];
  const straatNorm = straat.toLowerCase().replace(/\s+/g,' ').trim();
  for (const url of urls) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'nl-BE,nl;q=0.9' }, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) continue;
      const html = await resp.text();
      const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!nextMatch) continue;
      const nd = JSON.parse(nextMatch[1]);
      const results = nd?.props?.pageProps?.searchResults?.results || nd?.props?.pageProps?.classifieds || [];
      for (const item of results) {
        const loc = item.property?.location || item.location || {};
        const itemStraat = (loc.street || '').toLowerCase();
        if (itemStraat && straatNorm && itemStraat.includes(straatNorm.split(' ')[0])) {
          const agency = item.customers?.[0] || item.agency || item.customer || {};
          const naam = agency.name || agency.agencyName || null;
          if (naam) { console.log(`Stap 1.5: Makelaar via adres: "${naam}"`); return { naam, via: 'immoweb_adres_match' }; }
        }
      }
    } catch (e) { console.warn('ontdekMakelaarViaAdres fout:', e.message); }
  }
  return null;
}
// ── Correcties uit Supabase ───────────────────────────────────────
async function laadMakelaarCorrecties() {
  if (!supabase) return {};
  try {
    const { data, error } = await supabase.from('feedback').select('makelaar_naam_correct').not('makelaar_naam_correct','is',null).order('created_at',{ascending:false}).limit(100);
    if (error || !data) return {};
    const tellingen = {};
    for (const row of data) { const naam = row.makelaar_naam_correct.trim(); tellingen[naam] = (tellingen[naam] || 0) + 1; }
    return tellingen;
  } catch (e) { return {}; }
}
// ── Nabijgelegen straten via Overpass (fallback hoekpanden) ───────
async function straatNamenInBuurt(lat, lon, straal = 120) {
  try {
    const query = `[out:json][timeout:5];(way(around:${straal},${lat},${lon})["highway"]["name"];node(around:${straal},${lat},${lon})["place"="square"]["name"];way(around:${straal},${lat},${lon})["place"="square"]["name"];relation(around:${straal},${lat},${lon})["place"="square"]["name"];);out tags;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'ImmoScannerApp/1.0 (gilles@maisondw.be)' }, signal: AbortSignal.timeout(7000) });
    if (!resp.ok) { console.warn(`Overpass HTTP fout: ${resp.status}`); return []; }
    const data = await resp.json();
    const straten = [...new Set((data.elements || []).filter(e => e.tags?.highway && e.tags?.name).map(e => e.tags.name).filter(Boolean))];
    const pleinen = [...new Set((data.elements || []).filter(e => e.tags?.place === 'square' && e.tags?.name).map(e => e.tags.name).filter(Boolean))];
    console.log(`🗺️  Overpass: ${straten.length} straten, ${pleinen.length} pleinen binnen ${straal}m: ${[...straten, ...pleinen].join(', ')}`);
    return { straten, pleinen };
  } catch (e) { console.warn('Overpass API fout:', e.message); return { straten: [], pleinen: [] }; }
}
// ================================================================
//  STAP 2.5 — PARALLEL PORTAL SEARCHES (Serper.dev = echte Google)
// ================================================================
async function zoekPortalenParallel(makelaarNaam, domeinHint, zoekAdres, postcode, referentienummer, pandType, listingType) {
  if (!zoekAdres && !postcode) return [];
  const ad = zoekAdres || postcode;
  // Postcode weglaten uit queries
  const adZonderPostcode = postcode ? ad.replace(postcode, '').replace(/\s{2,}/g, ' ').trim() : ad;
  // Huisnummer weglaten — GPS-huisnummers zijn vaak incorrect (375 ipv 373, drift van 1-2 nummers)
  // "Coupure Links" vindt altijd meer dan "Coupure Links 375" dat niets vindt
  const adZonderNummer = adZonderPostcode.replace(/\s+\d+[a-zA-Z]?\s*$/i, '').trim() || adZonderPostcode;

  // Zoek het immoweb_agency_id op voor deze makelaar (uit de reeds gecachte DB)
  let agencyId = null;
  {
    const makelaars = await laadMakelaarsUitSupabase();
    const naamLow   = (makelaarNaam || '').toLowerCase().replace(/[-\s]+/g, ' ').trim();
    const domClean  = domeinHint.replace('www.', '');
    const dbMatch   = makelaars.find(m => {
      const d = m.domein.replace('www.', '');
      return d === domClean || d.includes(domClean) || domClean.includes(d) ||
        (m.naam || '').toLowerCase().replace(/[-\s]+/g, ' ').trim() === naamLow;
    });
    if (dbMatch?.immoweb_agency_id) {
      agencyId = dbMatch.immoweb_agency_id;
      console.log(`  🏢 Immoweb agency ID gevonden voor ${makelaarNaam}: ${agencyId} → directe agentschapspagina`);
    }
  }

  // Zoek 1: open Google-search makelaar — geen site:-filter zodat Google de beste match kiest
  // Zoek 2: Immoweb — directe agentschapspagina als agency_id bekend, anders Google fallback
  // Zoek 3: Zimmo specifiek (actuele listings, secondary)
  // Realo en Immoscoop weggelaten — tonen voornamelijk verlopen/historische data
  const portalen = [
    {
      label: 'makelaar',
      domein: domeinHint,
      // Met referentienummer: altijd site:-filter (uniek ID → altijd correct)
      // Zonder: open Google-search "straat" + "makelaar naam" → Google kiest beste match
      query: referentienummer
        ? `"${referentienummer}" site:${domeinHint}`
        : `"${adZonderNummer}" "${makelaarNaam}" ${listingType === 'Te huur' ? 'te huur' : 'te koop'}`,
      openSearch: !referentienummer, // vlag: URL kan van elk domein zijn
    },
    {
      label: 'Immoweb',
      domein: 'immoweb.be',
      // Agency ID bekend → directe agentschapspagina (geen Google ruis)
      // Onbekend → Google fallback met makelaarsnaam + straat
      agencyId: agencyId || null,
      query: `"${adZonderNummer}" "${makelaarNaam}" site:immoweb.be`,
      openSearch: false,
    },
    {
      label: 'Zimmo',
      domein: 'zimmo.be',
      // Makelaarsnaam + straat → specifiek genoeg voor Zimmo
      query: `"${adZonderNummer}" "${makelaarNaam}" site:zimmo.be`,
      openSearch: false,
    },
  ];
  const _isDetailUrl = (url, openSearch = false) => {
    const pad = url.replace(/https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
    const segs = pad.split('/').filter(Boolean).length;
    const heeftNumId = /\/\d{4,}(\/|$)/.test(pad);
    // Immoweb: enkel zoekertje/classified detail-URLs accepteren (geen agentschap, geen zoeken-goedkope)
    if (url.includes('immoweb.be')) return /\/(zoekertje|classified)\//i.test(url) && heeftNumId;
    // Blokkeer zoekpagina's, overzichten en agentschapspagina's (altijd)
    const geblokkeerd = /\/search\/|\/zoeken\/|\/resultaten\/|\/overzicht|\/agentschap\/|\?(q|page|filter)=/i.test(url);
    if (geblokkeerd) return false;
    // Open search (makelaar-query via Google): soepeler — 2+ segmenten is genoeg
    // Google heeft al gefilterd op relevantie, we hoeven niet nog eens streng te zijn
    if (openSearch) return segs >= 2;
    // Gesloten search (site:-filter op portaal): strenger — numeriek ID of 3+ segmenten
    return heeftNumId || segs >= 3;
  };
  const _stripQueryParams = (url) => url.split('?')[0].split('#')[0];
  async function zoekEen({ domein, label, query, openSearch, agencyId }) {
    // Immoweb met gekend agency ID → directe agentschapspagina, geen Google
    if (label === 'Immoweb' && agencyId) {
      console.log(`\n  🔎 [Immoweb] Directe agentschapspagina (agency ${agencyId}), straat: "${adZonderPostcode}"`);
      const straatVoorFilter = adZonderPostcode || null;
      const url = await zoekImmowebViaAgentschap(agencyId, straatVoorFilter, postcode, pandType, makelaarNaam);
      if (url) {
        console.log(`  Portal [Immoweb]: ✅ ${url}`);
        return [{ label: 'Immoweb', url, domein: 'immoweb.be', query: `agentschap/${agencyId}` }];
      }
      console.log(`  Portal [Immoweb]: 0 URLs gevonden via agentschapspagina`);
      return [];
    }

    if (!SERPER_API_KEY) {
      console.warn(`  Portal [${label}]: SERPER_API_KEY niet ingesteld — zoeken overgeslagen`);
      return [];
    }

    console.log(`\n  🔎 [${label}] Serper (Google) query: ${query}`);
    try {
      const resp = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': SERPER_API_KEY },
        body: JSON.stringify({ q: query, gl: 'be', hl: 'nl', num: 10 }),
        signal: AbortSignal.timeout(10000)
      });
      if (!resp.ok) { console.warn(`  Portal [${label}]: Serper HTTP ${resp.status}`); return []; }
      const data = await resp.json();

      // Serper geeft organic zoekresultaten terug — dit zijn echte Google-resultaten
      const organicUrls = (data.organic || []).map(r => _stripQueryParams(r.link)).filter(Boolean);

      if (organicUrls.length === 0) {
        console.log(`  📋 [${label}] Geen organische resultaten van Serper`);
        return [];
      }

      // Filter: open search pakt alles (makelaar-zoekopdracht), gesloten search filtert op domein
      const gevonden = [];
      const alleUrls = [];
      for (const url of organicUrls) {
        alleUrls.push(url);
        const domeinMatch = openSearch || url.includes(domein.replace('www.', ''));
        if (domeinMatch && _isDetailUrl(url, openSearch) && !gevonden.includes(url)) gevonden.push(url);
      }

      console.log(`  📋 [${label}] Serper resultaten (${alleUrls.length}):`);
      alleUrls.forEach(u => {
        const ok = gevonden.includes(u);
        console.log(`      ${ok ? '✅ detail' : '⏭️  filter'} ${u}`);
      });

      // Open search: categoriseer op domein (makelaar / Immoweb / Zimmo / ...)
      const resultaten = gevonden.slice(0, 3).map(url => {
        if (!openSearch) return { label, url, domein, query };
        const match = url.match(/https?:\/\/(?:www\.)?([\w.-]+)/);
        const effectiefDomein = match ? match[1] : domein;
        let effectiefLabel = label;
        if (effectiefDomein.includes('immoweb.be'))        effectiefLabel = 'Immoweb';
        else if (effectiefDomein.includes('zimmo.be'))     effectiefLabel = 'Zimmo';
        else if (effectiefDomein.includes('realo.be'))     effectiefLabel = 'Realo';
        else if (effectiefDomein.includes('immoscoop.be')) effectiefLabel = 'Immoscoop';
        return { label: effectiefLabel, url, domein: effectiefDomein, query };
      }).filter(Boolean);

      if (gevonden.length > 0) {
        gevonden.forEach(u => {
          const doorgegeven = resultaten.some(r => r.url === u);
          console.log(`  Portal [${label}]: ${doorgegeven ? '✅' : '⏭️ '} ${u}`);
        });
      } else {
        console.log(`  Portal [${label}]: 0 detail-URLs na filter`);
      }
      return resultaten;
    } catch (e) { console.warn(`  Portal [${label}] mislukt:`, e.message); return []; }
  }
  const t = Date.now();
  const resultaten = await Promise.all(portalen.map(zoekEen));
  const gevonden = resultaten.flat();
  console.log(`✅ STAP 2.5 klaar (${((Date.now()-t)/1000).toFixed(1)}s): ${gevonden.length} URLs gevonden`);
  return gevonden;
}

// ================================================================
//  SYSTEM PROMPTS
// ================================================================
const PROMPT_STAP1 = `Analyseer dit makelaarsbord. Geef ENKEL deze JSON terug, niets anders:
{
  "makelaar": "naam van de makelaar",
  "makelaar_website": "domeinnaam als zichtbaar op bord (bv. janssen.be), anders null",
  "makelaar_herkenning": "hoe herkend (kleur + logo + tekst)",
  "makelaar_betrouwbaarheid": "HOOG" | "MIDDEL" | "LAAG",
  "makelaar_extra": {"naam": "naam tweede makelaar", "website": "domein of null", "telefoon": "nummer of null"} | null,
  "listing_type": "Te koop" | "Te huur",
  "pand_type_slug": "duplex" | "appartement" | "huis" | "studio" | "penthouse" | "grond" | "handelspand" | "kantoor" | "garage",
  "pand_type_display": "Woning" | "Appartement" | "Nieuwbouw" | "Commercieel" | "Grond",
  "referentienummer": "als zichtbaar op het bord, anders null",
  "telefoon": "als zichtbaar op het bord, anders null",
  "tekst_op_bord": "alle leesbare tekst op het bord letterlijk overgetypt, ook gedeeltelijk",
  "gebouw_naam": "naam van de residentie of het gebouw als zichtbaar, anders null"
}

## STAP 1: LEES EERST ALLE TEKST OP HET BORD
- Naam van de makelaar staat bijna ALTIJD in letters op het bord
- Website-URL: zoek naar .be, .com, .nl, .immo achteraan een woord
- Telefoonnummer: Belgische nummers beginnen met 09xx (vast) of 04xx (mobiel)
- Referentienummer: bv. "Ref: 12345"
- Gebouwnaam: residentienamen staan soms in steen gebeiteld op de gevel

## CO-MAKELAARSCHAP (twee makelaars op een bord)
Als je TWEE verschillende makelaarsnamen, websites of telefoonnummers ziet:
- Zet de meest prominente in "makelaar" (hoofd)
- Zet de tweede in "makelaar_extra": {"naam": "...", "website": "...", "telefoon": "..."}
- Als er maar een makelaar is: "makelaar_extra": null

## STAP 2: HERKENNING VIA LOGO + KLEUR + TEKST
BEKENDE MAKELAARS (kleur, naam, website):
- ERA: rood + wit, "ERA" vetgedrukt blokschrift, era.be
- Trevi: rood + wit, "Trevi" cursief, trevi.be
- DeWaele: rood + wit, "Dewaele" schreefloos, dewaele.com
- Heylen: donkerblauw + wit, H-logo, heylenvastgoed.be
- Hillewaere: ORANJE + wit, H-logo, hillewaere-vastgoed.be
- Century 21: geel + zwart, century21.be
- Crevits: donkergroen + wit/goud, crevits.be
- Huysewinkel: wit + bruin H-logo, huysewinkel.be
- de Fooz: donkerblauw + goud/oranje, defooz.com
- Quares: zwart + wit, quares.be
- Engel & Volkers: groen + goud, engelvoelkers.com/be
- Carlo Eggermont: marineblauw + wit, carloeggermont.be
Onderscheid bij rood: ERA = vetgedrukt blokschrift. Trevi = cursief. DeWaele = schreefloos.
Onderscheid bij H-logo: Heylen = BLAUW. Hillewaere = ORANJE.

## STAP 3: BETROUWBAARHEID
- HOOG: naam letterlijk gelezen OF logo + kleur 100% duidelijk
- MIDDEL: logo/kleur herkend maar naam niet volledig leesbaar
- LAAG: onzeker, bord gedeeltelijk zichtbaar, of onbekende makelaar

Geef ENKEL de JSON terug.`;

const PROMPT_STAP2 = `Je bent de Immo Scanner. Je krijgt een foto van een makelaarsbord + een lijst van vooraf gevonden URLs. Jouw taak: kies de juiste URL en vul de JSON in. Zoek NIET zelf — alle zoekwerk is al gedaan.

## ALTIJD GELDENDE REGELS
1. Geen hallucinations. Vul enkel velden in met data uit de aangeleverde listings of URLs.
2. Transactie (te koop / te huur) moet kloppen met het bord.
3. Kies nooit raak. "niet_gevonden" of "gedeeltelijk" is eerlijker dan een verkeerde match.
4. Een URL van Realo of Immoscoop is BETER dan geen URL.
5. Kies een prijs van de meest betrouwbare bron.
6. "gevonden_via": gebruik UITSLUITEND één van deze exacte waarden: "web_search" | "makelaar_direct" | "immoweb_fallback" | "niet_gevonden". Geen andere tekst.

## STATUS-REGELS (volg exact)
- "gevonden": straatnaam matcht EN (huisnummer exact ÓF verschil ≤ 2) EN transactie klopt.
  → GPS geeft soms 1-2 nummers naast het pand. Rechtstraat 64 vs 65A = GEVONDEN.
- "gedeeltelijk": straatnaam matcht maar huisnummer onbekend of twijfelachtig. Óf: listing gevonden maar adres niet volledig bevestigd.
- "niet_gevonden": straatnaam matcht niet, of echt niets gevonden.

## HOE JE DE AANGELEVERDE URLs GEBRUIKT
Je krijgt een sectie "GEVONDEN PORTAL-URLS" of "LISTINGS". Werk als volgt:
- Makelaar eigen site URL → zet in "url" (enkel detail-pagina's, nooit overzicht)
- Immoweb / Zimmo / Realo / Immoscoop URLs → zet in "url_alternatieven" (max 1 per portaal)
- Als de URL van de makelaar eigen site staat: status = "gevonden" als GPS-straat overeenkomt, anders "gedeeltelijk"
- Als alleen aggregator-URLs: status = "gedeeltelijk" tenzij adres volledig bevestigd

## URL-REGELS
- "url": ENKEL de URL op de website van de makelaar zelf. Null als niet gevonden.
  NOOIT een overzichtspagina (bv. /nl/te-koop, /te-koop/gent) — enkel detail-pagina's.
- "url_alternatieven": directe detail-pagina URLs van aggregators. GEEN Spotto.
  VERBODEN: zoekresultatenpagina's (herkenbaar aan /search/, /zoeken/, ?q=, ?page=).
  TOEGESTAAN: realo.be/nl/wapenplein-14-8400-oostende/3696695 → detail-pagina met ID.
- Volgorde url_alternatieven: Immoscoop → Immoweb → Realo → Zimmo.

ADRESREGEL: match ALTIJD op straatnaam. Huisnummerverschil ≤ 2 is acceptabel (GPS-drift).
BRONREGEL: prijs, oppervlakte en slaapkamers moeten van DEZELFDE pagina komen als de URL.

## WANNEER JE EEN LIJST VAN LISTINGS KRIJGT
Kies de listing die het beste overeenkomt op basis van GPS-straatnaam, pand-type en transactie. Huisnummerverschil ≤ 2 is geen reden voor "gedeeltelijk" — tel dat als "gevonden".

## OUTPUT
{
  "status": "gevonden" | "niet_gevonden" | "gedeeltelijk",
  "makelaar": "naam",
  "makelaar_herkenning": "hoe herkend",
  "makelaar_betrouwbaarheid": "HOOG" | "MIDDEL" | "LAAG",
  "pand_type": "Woning" | "Appartement" | "Nieuwbouw" | "Commercieel" | "Grond",
  "listing_type": "Te koop" | "Te huur",
  "adres": "adres UIT DE GEVONDEN LISTING, of null",
  "gemeente": "gemeente",
  "prijs": "EUR bedrag of 'Op aanvraag' of null",
  "slaapkamers": "aantal of null",
  "oppervlakte": "m2 of null",
  "staat": "Instapklaar" | "Op te frissen" | "Te renoveren" | "Nieuwbouw" | "Onbekend",
  "extras": ["garage", "tuin", "terras"],
  "url": "directe URL op de website van de makelaar zelf, of null",
  "url_alternatieven": [{"label": "Immoscoop", "url": "https://..."}, {"label": "Realo", "url": "https://..."}],
  "telefoon": "telefoonnummer of null",
  "gevonden_via": "web_search" | "makelaar_direct" | "immoweb_fallback" | "niet_gevonden",
  "faal_categorie": null | "MAKELAAR_NIET_HERKEND" | "LISTING_NIET_ONLINE" | "ADRES_NIET_BEPAALBAAR" | "FALLBACK_OOK_LEEG" | "FOTO_ONLEESBAAR",
  "notitie": "korte uitleg voor de gebruiker, max 2 zinnen, niet technisch"
}
Geef ENKEL de JSON terug, geen extra tekst.`;

// ================================================================
//  API ENDPOINTS
// ================================================================
app.post('/api/scan', async (req, res) => {
  const { image, mime, gps, makelaar_override, adres_manueel } = req.body;
  if (!image)   return res.status(400).json({ error: 'Geen foto meegestuurd.' });
  if (!API_KEY) return res.status(500).json({ error: 'API key niet geconfigureerd.' });
  const startTime = Date.now();

  let geocodeResultaat = null;
  let adresFoto        = null;

  if (adres_manueel && adres_manueel.trim().length > 3) {
    console.log(`📍 Manueel adres: "${adres_manueel}"`);
    const m = adres_manueel.trim().match(/^(.+?),\s*(\d{4})\s+(.+)$/);
    if (m) {
      geocodeResultaat = { straat: m[1].trim(), postcode: m[2].trim(), gemeente: m[3].trim(), hoofdgemeente: m[3].trim().toLowerCase(), landcode: 'BE', volledig: adres_manueel.trim() };
    } else {
      geocodeResultaat = { straat: adres_manueel.trim(), gemeente: null, postcode: null, landcode: 'BE', volledig: adres_manueel.trim() };
    }
    adresFoto = adres_manueel.trim();
  } else {
    if (gps) {
      const geocodeLat = gps.property_lat || gps.lat;
      const geocodeLon = gps.property_lon || gps.lon;
      geocodeResultaat = await reverseGeocode(geocodeLat, geocodeLon);
    if (geocodeResultaat) console.log(`🗺️  GPS: lat=${gps.lat}, lon=${gps.lon} → ${geocodeResultaat.straat || '?'}, ${geocodeResultaat.gemeente || '?'}`);
    }
    const _straatMet = geocodeResultaat?.straat
      ? [geocodeResultaat.straat, geocodeResultaat.huisnummer].filter(Boolean).join(' ')
      : null;
    adresFoto = _straatMet ? `${_straatMet}, ${geocodeResultaat.gemeente || ''}`.trim().replace(/,$/, '') : null;
  }

  try {
    // ── STAP 1: Foto-analyse ──────────────────────────────────────
    console.log('📸 STAP 1: Foto-analyse starten...');
    const stap1ReqBody = JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 600, temperature: 0, system: PROMPT_STAP1, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime || 'image/jpeg', data: image } }, { type: 'text', text: 'Analyseer dit makelaarsbord. Geef de JSON.' }] }] });
    const stap1ReqHeaders = { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' };
    let stap1Resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: stap1ReqHeaders, body: stap1ReqBody });
    if (!stap1Resp.ok && [500, 529].includes(stap1Resp.status)) {
      const errBody = await stap1Resp.text();
      console.warn(`⚠️ STAP 1 fout ${stap1Resp.status} — retry over 8s. Detail: ${errBody.slice(0, 200)}`);
      await new Promise(r => setTimeout(r, 8000));
      stap1Resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: stap1ReqHeaders, body: stap1ReqBody });
    }
    if (!stap1Resp.ok) { const err = await stap1Resp.text(); console.error(`❌ STAP 1 mislukt (${stap1Resp.status}): ${err.slice(0, 400)}`); return res.status(502).json({ error: `Claude API fout stap 1 (${stap1Resp.status}).` }); }
    const stap1Data  = await stap1Resp.json();
    const stap1Text  = stap1Data.content?.find(b => b.type === 'text')?.text || '';
    const stap1Match = stap1Text.match(/\{[\s\S]*\}/);
    if (!stap1Match) return res.status(500).json({ error: 'Foto-analyse mislukt.' });
    const bordInfo = JSON.parse(stap1Match[0]);

    if (makelaar_override) {
      bordInfo.makelaar = makelaar_override;
      bordInfo.makelaar_herkenning = `Gecorrigeerd door gebruiker: ${makelaar_override}`;
      bordInfo.makelaar_betrouwbaarheid = 'HOOG';
    }
    console.log('✅ STAP 1 klaar:', bordInfo.makelaar, bordInfo.makelaar_betrouwbaarheid, bordInfo.listing_type);

    const gemeente = geocodeResultaat?.gemeente || 'Gent';
    const postcode = geocodeResultaat?.postcode || '9000';
    const landcode = geocodeResultaat?.landcode || 'BE';
    const hoofdgemeenteViaPostcode = await gemeenteViaPostcode(postcode, landcode);
    const hoofdgemeente = hoofdgemeenteViaPostcode || geocodeResultaat?.hoofdgemeente || gemeente.toLowerCase();

    // ── STAP 1.5a: Telefoonnummer ─────────────────────────────────
    if (!makelaar_override && bordInfo.telefoon) {
      console.log(`📞 Stap 1.5a: Telefoonnummer "${bordInfo.telefoon}" opzoeken...`);
      try {
        const telResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
          body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1024, tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }], system: `Je identificeert Belgische makelaars via hun telefoonnummer. Geef altijd op een aparte lijn: RESULTAAT: {"naam": "bedrijfsnaam", "website": "domein.be"}. Als niet gevonden: RESULTAAT: {"naam": null, "website": null}`, messages: [{ role: 'user', content: `Zoek welke Belgische vastgoedmakelaar dit telefoonnummer heeft: ${bordInfo.telefoon}` }] })
        });
        if (telResp.ok) {
          const telData = await telResp.json();
          const telText = telData.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';
          const telMatch = telText.match(/RESULTAAT:\s*(\{[\s\S]*?\})/);
          if (telMatch) {
            const telInfo = JSON.parse(telMatch[1]);
            if (telInfo.naam) {
              bordInfo.makelaar = telInfo.naam;
              if (telInfo.website) bordInfo.makelaar_website = telInfo.website;
              bordInfo.makelaar_herkenning += ` (via telefoonnummer)`;
              bordInfo.makelaar_betrouwbaarheid = 'HOOG';
              if (telInfo.website) {
                const domeinNieuw = telInfo.website.replace('www.','').replace(/^https?:\/\//,'').split('/')[0];
                voegMakelaarToeAanSupabase(domeinNieuw, telInfo.naam, null, null, bordInfo.telefoon);
              }
            }
          }
        }
      } catch (e) { console.warn('Stap 1.5a fout:', e.message); }
    }

    // ── STAP 1.5b: Correcties + adres ────────────────────────────
    if (!makelaar_override) {
      const betrouwbaarheidNa15a = (bordInfo.makelaar_betrouwbaarheid || '').toUpperCase();
      if (betrouwbaarheidNa15a === 'LAAG' || bordInfo.makelaar === 'onbekend') {
        const correcties = await laadMakelaarCorrecties();
        const makelaarLower = (bordInfo.makelaar || '').toLowerCase();
        const correctieMatch = Object.keys(correcties).find(naam => naam.toLowerCase().includes(makelaarLower) || makelaarLower.includes(naam.toLowerCase()));
        if (correctieMatch) {
          bordInfo.makelaar = correctieMatch;
          bordInfo.makelaar_herkenning += ` (bevestigd via ${correcties[correctieMatch]}x correctie)`;
          bordInfo.makelaar_betrouwbaarheid = 'MIDDEL';
        }
        const betrouwbaarheidNa15b = (bordInfo.makelaar_betrouwbaarheid || '').toUpperCase();
        if (geocodeResultaat?.straat && (betrouwbaarheidNa15b === 'LAAG' || bordInfo.makelaar === 'onbekend')) {
          const gevonden = await ontdekMakelaarViaAdres(geocodeResultaat.straat, hoofdgemeente, postcode);
          if (gevonden) { bordInfo.makelaar = gevonden.naam; bordInfo.makelaar_herkenning += ` (afgeleid via adres)`; bordInfo.makelaar_betrouwbaarheid = 'MIDDEL'; }
        }
      }
    }

    // ── STAP 2: Listings ophalen ──────────────────────────────────
    let domeinMakelaar = bordInfo.makelaar_website
      ? bordInfo.makelaar_website.replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0]
      : null;
    let makelaarInDB = false;
    const allesMakelaars = await laadMakelaarsUitSupabase();

    if (domeinMakelaar) {
      const dbMatch = allesMakelaars.find(m => { const d = m.domein.replace('www.',''); return d === domeinMakelaar || d.includes(domeinMakelaar) || domeinMakelaar.includes(d); });
      if (dbMatch) makelaarInDB = true;
    }
    if (!makelaarInDB && bordInfo.makelaar) {
      const naamLow = (bordInfo.makelaar || '').toLowerCase().replace(/[-\s]+/g,' ').trim();
      let besteMatch = null, besteScore = 0;
      for (const m of allesMakelaars) {
        const siteBase = m.domein.replace(/\.(be|com|nl|immo|eu|net|org|vlaanderen)$/,'').replace('www.','').toLowerCase().replace(/[-_]/g,' ').trim();
        const dbNaam   = (m.naam || '').toLowerCase().replace(/[-\s]+/g,' ').trim();
        let score = 0;
        // Eerst: directe DB-naam matching (vangt ook makelaars met kort domein zoals jo.immo)
        if (naamLow === dbNaam)                                            score = 10;
        else if (naamLow.replace(/\s/g,'') === dbNaam.replace(/\s/g,''))  score = 9;
        else if (naamLow.includes(dbNaam) && dbNaam.length >= 4)          score = 8;
        else if (dbNaam.includes(naamLow) && naamLow.length >= 4)         score = 8;
        // Dan: domein-gebaseerde matching (sla over als domein te kort)
        if (score === 0 && siteBase.length >= 3) {
          if (naamLow === siteBase)                                    score = 10;
          else if (naamLow.replace(/\s/g,'') === siteBase.replace(/\s/g,'')) score = 9;
          else if (naamLow.includes(siteBase) && siteBase.length >= 5) score = 7;
          else if (siteBase.includes(naamLow) && naamLow.length >= 5)  score = 7;
        }
        if (score > besteScore) { besteScore = score; besteMatch = m; }
      }
      if (besteMatch && besteScore >= 7) { domeinMakelaar = besteMatch.domein.replace('www.',''); makelaarInDB = true; }
    }

    if (!makelaarInDB && domeinMakelaar) {
      console.log(`🔍 URL-ontdekking starten voor ${domeinMakelaar}...`);
      const ontdekt = await ontdekMakelaarUrls(domeinMakelaar);
      const koopUrl = ontdekt?.koopUrl || null;
      const huurUrl = ontdekt?.huurUrl || null;
      await voegMakelaarToeAanSupabase(domeinMakelaar, bordInfo.makelaar, koopUrl, huurUrl, bordInfo.telefoon || null);
      if (koopUrl || huurUrl) {
        console.log(`✅ URL ontdekt voor ${domeinMakelaar} → direct zoeken`);
        makelaarInDB = true; // URL bekend, direct doorzoeken
      }
    }

    const gpsStraat = geocodeResultaat?.straat || null;
    const gpsVolledigAdres = gpsStraat && geocodeResultaat?.huisnummer ? `${gpsStraat} ${geocodeResultaat.huisnummer}` : gpsStraat;
    let listings = [];
    let listingsBron = 'geen';

    if (makelaarInDB) {
      console.log(`🔍 SCRAPING: ${domeinMakelaar} in DB`);
      // Gebruik domeinMakelaar (reeds opgelost via naam/score-matching) als website-hint,
      // NIET bordInfo.makelaar_website (kan fout zijn — bv. Claude leest verkeerde URL van bord).
      // Zo scrapet searchMakelaar altijd de juiste makelaarsite, ook als het bord iets anders toont.
      listings = await searchMakelaar(bordInfo.makelaar, bordInfo.listing_type, hoofdgemeente, postcode, domeinMakelaar || bordInfo.makelaar_website);
      listingsBron = 'makelaar_direct';
      if (listings.length > 0) {
        listings = await verrijkListingAdressen(listings, hoofdgemeente, postcode, gpsStraat);
        // Kantooradres-detectie: als >50% van de opgehaalde adressen identiek zijn,
        // zet de makelaar waarschijnlijk zijn eigen kantooradres in de database ipv het pand-adres
        let kantooradresGedetecteerd = false;
        const adressenOpgehaald = listings.filter(l => l.address);
        if (adressenOpgehaald.length >= 3) {
          const tellingen = {};
          for (const l of adressenOpgehaald) {
            const a = (l.address || '').toLowerCase().trim();
            tellingen[a] = (tellingen[a] || 0) + 1;
          }
          const maxCount = Math.max(...Object.values(tellingen));
          if (maxCount / adressenOpgehaald.length > 0.5) {
            console.log(`⚠️ Kantooradres-patroon: ${maxCount}/${adressenOpgehaald.length} listings hetzelfde adres — straatfilter overgeslagen, alle listings naar Claude`);
            listings.forEach(l => { l.address = null; });
            kantooradresGedetecteerd = true;
          }
        }
        if (gpsStraat && !kantooradresGedetecteerd) {
          const straatLow  = gpsStraat.toLowerCase();
          const gpsNummer  = geocodeResultaat?.huisnummer || null;
          const nummerNorm = _normaliseHuisnummer(gpsNummer);
          const straatMatches = listings.filter(l => (l.address || '').toLowerCase().includes(straatLow));
          if (straatMatches.length > 0) {
            if (gpsNummer && nummerNorm) {
              const nummerMatches = straatMatches.filter(l => _normaliseHuisnummer(l.address || '').includes(nummerNorm));
              listings = nummerMatches.length > 0 ? nummerMatches : straatMatches;
            } else { listings = straatMatches; }
          } else {
            // Fallback: URL slug matching — voor JS-sites waar adresfetch faalt maar straatnaam
            // wel in de listing-URL-slug zit (bv. huysewinkel.be/...aan-de-coupure/8944715)
            const straatWoorden = straatLow.split(' ').filter(w => w.length >= 5); // "coupure", "gentsesteenweg"...
            const slugMatches = straatWoorden.length > 0
              ? listings.filter(l => straatWoorden.some(w => (l.url || '').toLowerCase().includes(w)))
              : [];
            if (slugMatches.length > 0) {
              listings = slugMatches;
              console.log(`🔗 URL slug match op "${straatWoorden.join('/')}"': ${slugMatches.length} listing(s) gevonden`);
            } else {
              listings = [];
              listingsBron = 'straat_geen_match';
            }
          }
        }
      } else { listingsBron = 'scraping_leeg'; }
    } else if (gpsStraat) {
      console.log(`🔍 WEB SEARCH: "${bordInfo.makelaar}" niet in DB`);
      listingsBron = 'web_search_direct';
    } else {
      console.log('🔍 IMMOWEB: fallback');
      listings = await searchImmoweb(bordInfo.pand_type_slug, bordInfo.listing_type, hoofdgemeente, postcode);
      listingsBron = 'immoweb_fallback';
    }

    // ── Co-makelaar: ook extra makelaar doorzoeken ────────────────
    const makelaarExtra = bordInfo.makelaar_extra || null;
    if (makelaarExtra?.naam && listings.length === 0) {
      console.log(`🏢 Co-makelaar "${makelaarExtra.naam}" ook doorzoeken...`);
      const domeinExtra = makelaarExtra.website
        ? makelaarExtra.website.replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0]
        : null;

      // Controleer of extra makelaar in DB staat; zo niet, toevoegen
      let extraInDB = false;
      if (domeinExtra) {
        const dbMatchExtra = allesMakelaars.find(m => { const d = m.domein.replace('www.',''); return d === domeinExtra || d.includes(domeinExtra) || domeinExtra.includes(d); });
        if (dbMatchExtra) extraInDB = true;
      }
      if (!extraInDB && domeinExtra) {
        await voegMakelaarToeAanSupabase(domeinExtra, makelaarExtra.naam, null, null, makelaarExtra.telefoon || null);
        ontdekMakelaarUrls(domeinExtra).catch(() => {});
      }

      const listingsExtra = await searchMakelaar(makelaarExtra.naam, bordInfo.listing_type, hoofdgemeente, postcode, makelaarExtra.website);
      if (listingsExtra.length > 0) {
        const verrijktExtra = await verrijkListingAdressen(listingsExtra, hoofdgemeente, postcode, gpsStraat);
        if (gpsStraat) {
          const straatLow = gpsStraat.toLowerCase();
          const straatMatchesExtra = verrijktExtra.filter(l => (l.address || '').toLowerCase().includes(straatLow));
          if (straatMatchesExtra.length > 0) {
            listings = straatMatchesExtra;
            listingsBron = `co_makelaar_${makelaarExtra.naam.toLowerCase().replace(/\s+/g,'_')}`;
            console.log(`🏢 Co-makelaar "${makelaarExtra.naam}": ${listings.length} listing(s) met straat "${gpsStraat}"`);
          } else {
            console.log(`🏢 Co-makelaar "${makelaarExtra.naam}": geen straat-match`);
          }
        } else {
          listings = verrijktExtra;
          listingsBron = `co_makelaar_${makelaarExtra.naam.toLowerCase().replace(/\s+/g,'_')}`;
          console.log(`🏢 Co-makelaar "${makelaarExtra.naam}": ${listings.length} listing(s)`);
        }
      } else {
        console.log(`🏢 Co-makelaar "${makelaarExtra.naam}": ook geen listings`);
      }
    }

    console.log(`✅ STAP 2 klaar: ${listings.length} listings via ${listingsBron}${makelaarExtra ? ` | Co-makelaar: ${makelaarExtra.naam}` : ''}`);

    // ── Early exit: exact 1 listing → STAP 3 overgeslagen ────────
    // Als STAP 2 exact 1 listing vindt (via directe makelaar scraping of co-makelaar),
    // weten we het antwoord al — Claude hoeft dit niet meer te kiezen.
    // We halen de details op met Puppeteer fallback zodat adres/prijs/kamers volledig zijn.
    const isEarlyExitBron = listingsBron === 'makelaar_direct' || listingsBron.startsWith('co_makelaar_');
    if (listings.length === 1 && isEarlyExitBron && listings[0].url) {
      const eenListing = listings[0];
      console.log(`\n⚡ EARLY EXIT: exact 1 listing gevonden — STAP 3 overgeslagen`);
      console.log(`   URL: ${eenListing.url}`);
      // Detail ophalen met Puppeteer fallback (slimFetchHtml — werkt ook op JS-zware sites)
      const detailEarly = await fetchDetailMetPuppeteer(eenListing.url);
      if (detailEarly.adres)       console.log(`📍 Adres listing: ${detailEarly.adres}`);
      if (detailEarly.prijs)       console.log(`💰 Prijs listing: ${detailEarly.prijs}`);
      if (detailEarly.slaapkamers) console.log(`🛏️  Slaapkamers: ${detailEarly.slaapkamers}`);
      if (detailEarly.oppervlakte) console.log(`📐 Oppervlakte: ${detailEarly.oppervlakte}m2`);
      // GPS-adres validatie: als de listing een adres heeft, check of GPS-straat daarin zit.
      // Mismatch = val terug op STAP 3 (we weten dan niet zeker genoeg dat het de juiste listing is)
      let earlyExitOk = true;
      let adresEarly = detailEarly.adres || null;
      if (gpsStraat && adresEarly) {
        const adresEarlyLow = adresEarly.toLowerCase();
        if (!adresEarlyLow.includes(gpsStraat.toLowerCase())) {
          console.log(`🔴 Adres-mismatch early exit: "${gpsStraat}" niet in "${adresEarly}" — doorgaan naar STAP 3`);
          earlyExitOk = false;
        }
      }
      if (earlyExitOk) {
        // Stel resultaat samen
        const earlyResult = {
          status: 'gevonden',
          makelaar: bordInfo.makelaar,
          makelaar_herkenning: bordInfo.makelaar_herkenning,
          makelaar_betrouwbaarheid: bordInfo.makelaar_betrouwbaarheid,
          pand_type: bordInfo.pand_type_display || 'Woning',
          listing_type: bordInfo.listing_type,
          adres: adresEarly || adresFoto || null,
          gemeente: geocodeResultaat?.gemeente || gemeente,
          prijs: detailEarly.prijs || eenListing.price || null,
          slaapkamers: detailEarly.slaapkamers || eenListing.bedrooms || null,
          oppervlakte: detailEarly.oppervlakte || eenListing.area || null,
          staat: 'Onbekend',
          extras: [],
          url: eenListing.url,
          url_alternatieven: [],
          telefoon: bordInfo.telefoon || null,
          gevonden_via: 'makelaar_direct',
          faal_categorie: null,
          notitie: 'Exact 1 listing gevonden via directe makelaar scraping.',
          visuele_match: 'niet_gecontroleerd',
          visuele_match_reden: null,
        };
        // Visuele gebouwbevestiging (zelfde als normaal pad)
        const vCheckEarly = await vergelijkGebouwen(image, mime || 'image/jpeg', earlyResult.url);
        earlyResult.visuele_match       = vCheckEarly.resultaat;
        earlyResult.visuele_match_reden = vCheckEarly.reden || null;
        if (vCheckEarly.resultaat === 'twijfel') {
          earlyResult.status = 'gedeeltelijk';
          earlyResult.faal_categorie = 'VISUELE_MISMATCH';
          earlyResult.notitie = `Visuele check: gebouw lijkt niet overeen te komen met listing-foto. ${earlyResult.notitie}`;
        }
        const zoekduurEarly = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('✅ SCAN KLAAR (early exit):', { makelaar: earlyResult.makelaar, status: earlyResult.status, adres: earlyResult.adres, url: earlyResult.url, duur: `${zoekduurEarly}s` });
        // Supabase opslaan
        let scanIdEarly = null;
        if (supabase) {
          const { data: dbData, error } = await supabase.from('scans').insert({
            makelaar: earlyResult.makelaar, makelaar_herkenning: earlyResult.makelaar_herkenning,
            makelaar_betrouwbaarheid: (earlyResult.makelaar_betrouwbaarheid || '').toLowerCase() || null,
            listing_type: earlyResult.listing_type, pand_type: earlyResult.pand_type,
            adres_foto: adresFoto, adres: earlyResult.adres || null,
            gemeente: earlyResult.gemeente, prijs: earlyResult.prijs, slaapkamers: earlyResult.slaapkamers,
            oppervlakte: earlyResult.oppervlakte, staat: earlyResult.staat, extras: earlyResult.extras || [],
            status: earlyResult.status, url: earlyResult.url, url_alternatieven: earlyResult.url_alternatieven || [],
            telefoon: earlyResult.telefoon, gevonden_via: earlyResult.gevonden_via,
            faal_categorie: earlyResult.faal_categorie, notitie: earlyResult.notitie,
            gps_beschikbaar: !!gps, gps_nauwkeurigheid_m: gps?.accuracy || null,
            zoekduur_seconden: parseFloat(zoekduurEarly)
          }).select('id').single();
          if (error) console.error('Supabase schrijffout (early exit):', JSON.stringify(error));
          else { scanIdEarly = dbData?.id; console.log('Scan opgeslagen (early exit), id:', scanIdEarly); }
        }
        return res.json({ ...earlyResult, scan_id: scanIdEarly });
      }
      // earlyExitOk = false → gewoon doorgaan naar STAP 3 hieronder
    }
    // ── Einde early exit ─────────────────────────────────────────

    // ── Context voor Claude ───────────────────────────────────────
    let listingsContext = '';
    let effectiefZoekladres = gpsVolledigAdres; // kan bijgesteld worden door plein-detectie
    const domeinHint = domeinMakelaar || (bordInfo.makelaar || '').toLowerCase().replace(/\s+/g,'') + '.be';
    const deelgemeente = geocodeResultaat?.gemeente || null;
    const heeftDeelgemeente = deelgemeente && hoofdgemeente && deelgemeente.toLowerCase() !== hoofdgemeente.toLowerCase();

    let makelaarPortal = null; // scope buiten if-blok
    let portalResultaten = [];  // scope buiten if-blok
    if (listingsBron === 'web_search_direct' || listingsBron === 'scraping_leeg' || listingsBron === 'straat_geen_match') {
      const waarom = { 'web_search_direct': 'Makelaar staat niet in onze database.', 'scraping_leeg': 'Directe scraping leverde geen listings op.', 'straat_geen_match': `Scraping vond listings, maar geen enkele had adres "${gpsStraat}".` }[listingsBron] || '';
      const refHint = bordInfo.referentienummer ? `\nReferentienummer: ${bordInfo.referentienummer} → Zoek dit EERST: "${bordInfo.referentienummer}" site:${domeinHint}` : '';
      // Overpass: nabijgelegen straten + pleinen als fallback (ook bij scraping_leeg)
      let nabijStratenHint = '';
      if ((listingsBron === 'straat_geen_match' || listingsBron === 'web_search_direct' || listingsBron === 'scraping_leeg') && gps?.lat && gps?.lon) {
        const { straten: nabijStraten, pleinen: nabijPleinen } = await straatNamenInBuurt(gps.lat, gps.lon);
        // Plein-detectie: geocoder geeft aangrenzende straat, maar we staan OP een plein
        if (nabijPleinen.length > 0 && gpsStraat && !nabijPleinen.some(p => p.toLowerCase() === gpsStraat.toLowerCase())) {
          const pleinNaam = nabijPleinen[0];
          effectiefZoekladres = pleinNaam + (postcode ? ` ${postcode}` : '');
          nabijStratenHint += `\n⚠️ GPS geocoder gaf "${gpsStraat}" maar er is een plein gedetecteerd: "${pleinNaam}". Zoek EERST op "${pleinNaam}" — geocoders pakken vaak een aangrenzende straat i.p.v. het plein zelf.\n`;
          console.log(`🟡 Plein gedetecteerd nabij GPS: "${pleinNaam}" (geocoder gaf "${gpsStraat}")`);
        }
        // Overige namen als hint voor hoekpanden
        const geprioriseerd = nabijPleinen[0] || '';
        const andereNamen = [...nabijPleinen.slice(geprioriseerd ? 1 : 0), ...nabijStraten]
          .filter(s => s.toLowerCase() !== (gpsStraat || '').toLowerCase() && s.toLowerCase() !== geprioriseerd.toLowerCase());
        if (andereNamen.length > 0) {
          nabijStratenHint += `\nNabijgelegen locaties (${andereNamen.length} binnen 120m): ${andereNamen.join(', ')}\nHoekpand mogelijk? Zoek ook op deze locaties op ${domeinHint}.\n`;
        }
      }
      const zoekAdres = effectiefZoekladres || postcode || '';
      const makelaarNaam = bordInfo.makelaar || '';

      // ── STAP 2.5: Parallel portal searches ───────────────────────
      portalResultaten = await zoekPortalenParallel(makelaarNaam, domeinHint, zoekAdres, postcode, bordInfo.referentienummer, bordInfo.pand_type_slug, bordInfo.listing_type);
      // Bouw portal-context op voor Claude (enkel wat er gevonden is)
      makelaarPortal = portalResultaten.find(r => r.domein === domeinHint);
      const aggPortalen = [
        { label: 'Immoscoop', domein: 'immoscoop.be' },
        { label: 'Immoweb',   domein: 'immoweb.be' },
        { label: 'Realo',     domein: 'realo.be' },
        { label: 'Zimmo',     domein: 'zimmo.be' },
      ];
      let portalContext = `\n\n## GEVONDEN PORTAL-URLS (parallel gezocht via Google)${nabijStratenHint}\nGPS-adres: "${zoekAdres}"\nMakelaar: ${makelaarNaam} (${domeinHint})\nReden: ${waarom}${refHint}\n\n`;

      // Makelaar eigen site — met verificatiequery
      if (makelaarPortal) {
        portalContext += `Makelaar eigen site (${domeinHint}): ${makelaarPortal.url}\n`;
        portalContext += `  → Gevonden via Google query: "${makelaarPortal.query}" — Google bevestigt dat deze URL inhoud heeft over "${zoekAdres}".\n`;
      } else {
        portalContext += `Makelaar eigen site (${domeinHint}): geen detail-URL gevonden\n`;
      }

      // Aggregators — met verificatiequery per gevonden URL
      for (const agg of aggPortalen) {
        const gevonden = portalResultaten.filter(r => r.domein === agg.domein);
        if (gevonden.length > 0) {
          for (const r of gevonden) {
            portalContext += `${agg.label}: ${r.url}\n`;
            portalContext += `  → Gevonden via Google query: "${r.query}"\n`;
          }
        } else {
          portalContext += `${agg.label}: geen detail-URL gevonden\n`;
        }
      }

      portalContext += `\nINSTRUCTIES:\n`;
      portalContext += `- Makelaar eigen site: als er een URL staat, neem die over in "url". De Google-zoekopdracht gebruikt het exacte GPS-adres als zoekterm — dat IS de verificatie. Zet status op "gevonden" als ook minstens één aggregator het adres "${zoekAdres}" bevestigt, anders "gedeeltelijk".\n`;
      portalContext += `- Aggregator URLs: controleer of de pagina-inhoud overeenkomt met "${zoekAdres}". Zimmo en Immoweb gebruiken numerieke IDs in de URL — het adres staat NIET in de URL maar wel op de pagina. Gebruik web_search om de paginainhoud te controleren als je twijfelt.\n`;
      portalContext += `- Volgorde url_alternatieven: Immoscoop → Immoweb → Realo → Zimmo.\n`;
      listingsContext = portalContext;
    } else if (listings.length > 0) {
      listingsContext = `\n\n## LISTINGS (${listings.length} resultaten via ${listingsBron})\n`;
      if (gpsVolledigAdres) listingsContext += `GPS-adres: "${gpsVolledigAdres}" -- kies de listing met dit adres.\n\n`;
      for (const l of listings.slice(0, 25)) {
        listingsContext += `- **${l.title || 'Geen titel'}**\n`;
        if (l.address)  listingsContext += `  Adres: ${l.address}\n`;
        if (l.price)    listingsContext += `  Prijs: ${l.price}\n`;
        if (l.bedrooms) listingsContext += `  Slaapkamers: ${l.bedrooms}\n`;
        if (l.area)     listingsContext += `  Oppervlakte: ${l.area} m2\n`;
        if (l.url)      listingsContext += `  URL: ${l.url}\n`;
        listingsContext += '\n';
      }
    } else {
      const refFallback = bordInfo.referentienummer ? ` OF "${bordInfo.referentienummer}" site:${domeinHint}` : '';
      listingsContext = `\n\n## GEEN LISTINGS GEVONDEN\n${gpsVolledigAdres ? `Probeer web_search: "${gpsVolledigAdres}" "${postcode}" site:${domeinHint}${refFallback}` : 'Geen GPS beschikbaar.'}\n`;
    }

    // Locatie info
    const geldigeNamen = heeftDeelgemeente ? `${postcode} (dekt: ${hoofdgemeente}, ${deelgemeente})` : `${postcode} (${hoofdgemeente})`;
    let locatieInfo = '';
    if (adresFoto) {
      locatieInfo = `Locatie: ${adresFoto}${heeftDeelgemeente ? ` (deelgemeente van ${hoofdgemeente})` : ''} -- postcode ${geldigeNamen}.\nPOSTCODEREGEL: Gebruik postcode ${postcode} als primaire locatie-identifier, niet de gemeentenaam.`;
    } else if (gps) {
      locatieInfo = `GPS: ${gps.lat}N, ${gps.lon}O (+-${gps.accuracy}m) -- postcode ${geldigeNamen}.`;
    } else {
      locatieInfo = 'Geen GPS beschikbaar.';
    }

    // ── STAP 3: Claude matcht listing ────────────────────────────
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🎯 STAP 3: Claude matcht listing uit', listings.length, 'kandidaten...');
    if (listingsContext && listingsContext.includes('PORTAL-URLS')) {
      // Toon de portal-URLs die Claude te zien krijgt
      const lines = listingsContext.split('\n').filter(l => l.trim() && !l.includes('INSTRUCTIES') && !l.includes('Nabijgelegen'));
      console.log('📤 Portal context naar Claude:');
      lines.forEach(l => { if (l.trim()) console.log('   ', l.trim()); });
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    const stap3Body = JSON.stringify({
      model: 'claude-sonnet-4-6', max_tokens: 1500,
      system: PROMPT_STAP2,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mime || 'image/jpeg', data: image } },
        { type: 'text', text: `## BORDANALYSE (stap 1)\nMakelaar: ${bordInfo.makelaar} (${bordInfo.makelaar_herkenning})\nBetrouwbaarheid: ${bordInfo.makelaar_betrouwbaarheid}\nType: ${bordInfo.listing_type}\nPand: ${bordInfo.pand_type_slug}\nReferentienummer: ${bordInfo.referentienummer || 'niet zichtbaar'}\nTelefoon: ${bordInfo.telefoon || 'niet zichtbaar'}\nMakelaar website: ${domeinMakelaar || bordInfo.makelaar_website || 'onbekend'}\n${makelaarExtra ? `Co-makelaar: ${makelaarExtra.naam} (${makelaarExtra.website || 'onbekend'})\n` : ''}\n## LOCATIE\n${locatieInfo}\n${listingsContext}\nGeef het resultaat als JSON.` }
      ]}]
    });
    const stap3Headers = { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' };
    let stap3Resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: stap3Headers, body: stap3Body });
    // Automatische retry bij transient 500/529 (Anthropic overload)
    if (!stap3Resp.ok && [500, 529].includes(stap3Resp.status)) {
      const errBody = await stap3Resp.text();
      console.warn(`⚠️ STAP 3 fout ${stap3Resp.status} — retry over 8s. Detail: ${errBody.slice(0, 200)}`);
      await new Promise(r => setTimeout(r, 8000));
      stap3Resp = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: stap3Headers, body: stap3Body });
    }
    const zoekduur = ((Date.now() - startTime) / 1000).toFixed(2);
    if (!stap3Resp.ok) {
      const errBody = await stap3Resp.text();
      console.error(`❌ STAP 3 mislukt (${stap3Resp.status}): ${errBody.slice(0, 400)}`);
      return res.status(502).json({ error: `Claude API fout stap 3 (${stap3Resp.status}).` });
    }
    const stap3Data = await stap3Resp.json();

    let rawText = '';
    for (const block of stap3Data.content) { if (block.type === 'text' && block.text.includes('{')) rawText = block.text; }
    if (!rawText) return res.status(500).json({ error: 'Matching mislukt.' });
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Matching mislukt.' });
    const result = JSON.parse(jsonMatch[0]);
    console.log(`🔍 STAP 3 ruwe output — url: ${result.url || 'null'} | alternatieven: ${JSON.stringify(result.url_alternatieven || [])} | status: ${result.status}`);

    result.makelaar             = result.makelaar             || bordInfo.makelaar;
    result.makelaar_herkenning  = result.makelaar_herkenning  || bordInfo.makelaar_herkenning;
    result.makelaar_betrouwbaarheid = result.makelaar_betrouwbaarheid || bordInfo.makelaar_betrouwbaarheid;
    result.telefoon             = result.telefoon             || bordInfo.telefoon;
    if (!Array.isArray(result.url_alternatieven)) result.url_alternatieven = [];
    // Alle aggregator-domeinen (geblokkeerd uit result.url)
    const _aggDomains = ['realo.be', 'immoscoop.be', 'spotto.be', 'zimmo.be', 'immoweb.be'];
    // Toegelaten alternatieven-domeinen (Spotto niet inbegrepen)
    const _toegelatenAltDomains = ['immoscoop.be', 'immoweb.be', 'realo.be', 'zimmo.be'];
    // Verwijder Spotto en ongeldige URLs uit url_alternatieven + dedup op domein
    {
      const geziendeDomeinen = new Set();
      result.url_alternatieven = result.url_alternatieven.filter(a => {
        if (!a?.url) return false;
        // Spotto en andere niet-toegelaten domeinen eruit
        if (!_toegelatenAltDomains.some(d => a.url.includes(d))) return false;
        const domein = _toegelatenAltDomains.find(d => a.url.includes(d)) || a.url.split('/')[2] || '';
        if (geziendeDomeinen.has(domein)) return false;
        geziendeDomeinen.add(domein);
        return true;
      });
    }
    // Aggregator-domeinen horen NIET in result.url (dat is voor de makelaar's eigen website)
    if (result.url && _aggDomains.some(d => (result.url || '').includes(d))) {
      console.log(`⚠️ Aggregator URL in result.url: ${result.url} → verplaatst naar alternatieven`);
      const isSpotto = result.url.includes('spotto.be');
      const _isDetailPage = /\/\d{5,}/.test(result.url) && !/\/search\/|\/zoeken\/|\/resultaten\//i.test(result.url);
      // Spotto nooit in url_alternatieven zetten; andere aggregators enkel als het een detail-URL is
      if (!isSpotto && _isDetailPage && !result.url_alternatieven.some(a => a.url === result.url)) {
        const _domLabel = _toegelatenAltDomains.find(d => result.url.includes(d))?.split('.')[0] || 'aggregator';
        result.url_alternatieven.push({ label: _domLabel.charAt(0).toUpperCase() + _domLabel.slice(1), url: result.url });
        console.log(`✅ URL verplaatst naar url_alternatieven: ${result.url}`);
      }
      result.url = null;
    }
    // Overzichtspagina's horen NIET in result.url — Claude geeft soms de listings-lijst als URL
    // Een detail-URL heeft een numeriek ID (bv. /4343363/) of ≥ 4 padsegmenten
    if (result.url) {
      const _pad = result.url.replace(/https?:\/\/[^/]+/, '').replace(/\?.*$/, '');
      const _segmenten = _pad.split('/').filter(Boolean).length;
      const _heeftNumId = /\/\d{4,}(\/|$)/.test(_pad);
      if (_segmenten <= 3 && !_heeftNumId) {
        console.log(`⚠️ Overzichtspagina in result.url (${_segmenten} segmenten, geen ID): ${result.url} → gewist`);
        result.url = null;
        if (result.status === 'gevonden') result.status = 'gedeeltelijk';
      }
    }
    // ── Server-side override: STAP 2.5 vond makelaar-URL maar Claude negeerde die → forceer ──
    if (!result.url && makelaarPortal && makelaarPortal.url) {
      result.url = makelaarPortal.url;
      if (!result.status || result.status === 'niet_gevonden') result.status = 'gedeeltelijk';
      console.log(`🔧 Makelaar URL geforceerd vanuit STAP 2.5: ${result.url}`);
    }
    // Normaliseer gevonden_via — Claude plaatst soms lange tekst ipv enum-waarde
    const _validGevondenVia = ['web_search', 'makelaar_direct', 'immoweb_fallback', 'niet_gevonden'];
    if (!_validGevondenVia.includes(result.gevonden_via)) {
      if (listingsBron === 'makelaar_direct')    result.gevonden_via = 'makelaar_direct';
      else if (listingsBron === 'immoweb_fallback') result.gevonden_via = 'immoweb_fallback';
      else if (result.status === 'niet_gevonden')  result.gevonden_via = 'niet_gevonden';
      else result.gevonden_via = 'web_search';
    }

    // ── Fallback: URLs uit web_search tool-results ────────────────
    if (gpsStraat || effectiefZoekladres) {
      const straatLower = (gpsStraat || '').toLowerCase();
      const effectiefLower = (effectiefZoekladres || '').toLowerCase();
      const aggregators = [{ domein: 'immoscoop.be', label: 'Immoscoop' }, { domein: 'immoweb.be', label: 'Immoweb' }, { domein: 'realo.be', label: 'Realo' }, { domein: 'zimmo.be', label: 'Zimmo' }];
      const bestaandeUrls = new Set(result.url_alternatieven.map(a => a.url));
      const gevondenDomeinen = new Set(result.url_alternatieven.map(a => aggregators.find(ag => a.url?.includes(ag.domein))?.domein).filter(Boolean));
      for (const block of stap3Data.content) {
        const blockStr = JSON.stringify(block);
        for (const agg of aggregators) {
          if (gevondenDomeinen.has(agg.domein)) continue; // al een URL voor dit domein
          const urlRegex = new RegExp(`https?://(?:www\\.)?${agg.domein.replace('.','\\.')}[^"'\\s<>]+`, 'gi');
          let m;
          while ((m = urlRegex.exec(blockStr)) !== null) {
            const gevondenUrl = m[0].replace(/\\u[0-9a-f]{4}/gi, c => String.fromCharCode(parseInt(c.slice(2),16)));
            if (bestaandeUrls.has(gevondenUrl)) continue;
            const isZoekpagina = /\/search\/|\/zoeken\/|\/resultaten\/|\?q=|\?page=/i.test(gevondenUrl);
            // Aggregator detail-URLs hebben altijd een numeriek ID of ≥4 pad-segmenten
            const padSegmenten = gevondenUrl.replace(/https?:\/\/[^/]+/, '').split('/').filter(Boolean).length;
            const heeftDetailId = /\/\d{4,}/.test(gevondenUrl) || padSegmenten >= 4;
            const urlLower = gevondenUrl.toLowerCase();
            // Straatnaam in URL (Realo) OF postcode + numeriek ID (Zimmo/Immoweb gebruiken geen straatnaam in URL)
            const straatMatch = (straatLower && urlLower.includes(straatLower.split(' ')[0])) ||
                                (effectiefLower && urlLower.includes(effectiefLower.split(' ')[0].toLowerCase())) ||
                                (heeftDetailId && postcode && gevondenUrl.includes(postcode));
            // Immoweb: enkel zoekertje/classified URLs, geen zoeken-goedkope of andere pagina's
            if (agg.domein === 'immoweb.be' && !/\/(zoekertje|classified)\//i.test(gevondenUrl)) continue;
            if (!isZoekpagina && heeftDetailId && straatMatch) {
              bestaandeUrls.add(gevondenUrl);
              gevondenDomeinen.add(agg.domein);
              result.url_alternatieven.push({ label: agg.label, url: gevondenUrl });
            }
          }
        }
      }
    }

    // ── Details van detailpagina (prijs, adres, kamers) ──────────
    // fetchDetailMetPuppeteer: MET Puppeteer fallback — voor de definitief gematchte listing.
    // Werkt ook op JS-zware sites zoals huysewinkel.be (waar directe fetch leeg teruggeeft).
    let adresListing = null;
    if (result.url && result.status !== 'niet_gevonden') {
      const detail = await fetchDetailMetPuppeteer(result.url);
      adresListing = detail.adres || null;
      if (adresListing) console.log('📍 Adres van detailpagina:', adresListing);
      if (detail.prijs)      { console.log(`💰 Prijs overschreven: "${result.prijs}" -> "${detail.prijs}"`); result.prijs = detail.prijs; }
      if (detail.slaapkamers) result.slaapkamers = detail.slaapkamers;
      if (detail.oppervlakte) result.oppervlakte = detail.oppervlakte;
    }

    // ── URL verificatie ───────────────────────────────────────────
    if (result.url) {
      const urlActief = await checkUrlActief(result.url);
      if (urlActief === false) {
        const hadAlternatieven = Array.isArray(result.url_alternatieven) && result.url_alternatieven.length > 0;
        result.url = null;
        // Downgrade naar gedeeltelijk (niet niet_gevonden) — info en alternatieven blijven bruikbaar
        if (result.status === 'gevonden') result.status = 'gedeeltelijk';
        result.faal_categorie = result.faal_categorie || 'LISTING_NIET_ONLINE';
        result.notitie = 'Directe link niet meer beschikbaar (404).' + (hadAlternatieven ? ' Zie alternatieven hieronder.' : '') + (result.notitie ? ' ' + result.notitie : '');
      } else if (urlActief === null) {
        result.notitie = (result.notitie ? result.notitie + ' ' : '') + 'Let op: de link kon niet automatisch gecontroleerd worden.';
      }
    }

    // ── Beschikbaarheidscheck ─────────────────────────────────────
    if (result.url) {
      const nietBeschikbaar = await isNietBeschikbaar(result.url);
      if (nietBeschikbaar) {
        result.url = null; result.status = 'niet_gevonden';
        result.faal_categorie = 'PAND_NIET_BESCHIKBAAR';
        result.notitie = 'Dit pand is niet meer beschikbaar. ' + (result.notitie || '');
      }
    }
    // Aggregator alternatieven (Realo, Immoscoop, Spotto) niet filteren op isNietBeschikbaar:
    // Realo is een vastgoedgeschiedenissite — "sold" staat altijd op de pagina (historische data).
    // De gebruiker kan zelf beoordelen of de aggregator-link bruikbaar is.

    // ── Gemeente + adres cleanup ──────────────────────────────────
    if (!result.gemeente && geocodeResultaat?.gemeente) result.gemeente = geocodeResultaat.gemeente;
    if (result.adres === 'Niet bepaald') result.adres = null;

    // ── GPS-straat validatie ──────────────────────────────────────
    if (gpsStraat && adresListing) {
      const adresLow   = adresListing.toLowerCase();
      // Accepteer: GPS-straat, het gecorrigeerde plein-adres, of postcode als match
      const straatOk   = adresLow.includes(gpsStraat.toLowerCase()) ||
                         (effectiefZoekladres && effectiefZoekladres !== gpsVolledigAdres &&
                          adresLow.includes(effectiefZoekladres.toLowerCase().split(' ')[0]));
      const postcodeOk = !postcode || adresListing.includes(postcode);
      if (!straatOk || !postcodeOk) {
        const referentieStraat = (effectiefZoekladres && effectiefZoekladres !== gpsVolledigAdres)
          ? `${gpsStraat} / ${effectiefZoekladres.split(' ')[0]}` : gpsStraat;
        const reden = !straatOk ? `straat "${referentieStraat}" niet in "${adresListing}"` : `postcode mismatch`;
        console.log(`🔴 Adres-mismatch (${reden}) -> URL gewist`);
        result.url = null; result.status = 'niet_gevonden';
        result.faal_categorie = result.faal_categorie || 'ADRES_MISMATCH';
        result.notitie = `Gevonden listing staat op "${adresListing}" maar GPS-locatie is "${referentieStraat}". ` + (result.notitie || '');
        adresListing = null;
      }
    }
    if (adresListing) result.adres = adresListing;
    // GPS-adres als fallback als er geen listing-adres is
    if (!result.adres && adresFoto) result.adres = adresFoto;

    // ── Gedeeltelijk → gevonden upgrade ──────────────────────────
    // Als makelaar HOOG betrouwbaar is, URL van eigen makelaarsite komt,
    // en het adres van de listing de GPS-straat bevat → zeker het juiste pand
    if (result.status === 'gedeeltelijk' && gpsStraat && result.adres && result.url && domeinMakelaar) {
      const betrouwbaar = (bordInfo.makelaar_betrouwbaarheid || '').toUpperCase() === 'HOOG';
      const urlVanMakelaar = result.url.toLowerCase().includes(domeinMakelaar.toLowerCase());
      const straatInAdres  = result.adres.toLowerCase().includes(gpsStraat.toLowerCase());
      if (betrouwbaar && urlVanMakelaar && straatInAdres) {
        result.status = 'gevonden';
        result.faal_categorie = null;
        console.log(`✅ Upgrade gedeeltelijk→gevonden: makelaar HOOG + ${domeinMakelaar} + straat "${gpsStraat}" in adres "${result.adres}"`);
      }
    }

    // ── Visuele gebouwbevestiging ─────────────────────────────────
    result.visuele_match = 'niet_gecontroleerd';
    result.visuele_match_reden = null;
    if (result.url && result.status === 'gevonden') {
      const vCheck = await vergelijkGebouwen(image, mime || 'image/jpeg', result.url);
      result.visuele_match       = vCheck.resultaat;
      result.visuele_match_reden = vCheck.reden || null;
      if (vCheck.resultaat === 'twijfel') {
        result.status = 'gedeeltelijk';
        result.faal_categorie = result.faal_categorie || 'VISUELE_MISMATCH';
        result.notitie = `Visuele check: gebouw lijkt niet overeen te komen met listing-foto. ` + (result.notitie || '');
      }
    }

    // ── Server-side: voeg STAP 2.5 portal URLs toe die Claude miste ─────────
    console.log('\n🔧 SERVER-SIDE CHECK: STAP 3 gaf url=' + (result.url||'null') + ', ' + (result.url_alternatieven||[]).length + ' alternatieven');
    // Claude is soms te conservatief — portal URLs gevonden door Google gaan er altijd in
    if (Array.isArray(portalResultaten) && portalResultaten.length > 0) {
      const toegelaten = ['immoweb.be', 'zimmo.be', 'realo.be', 'immoscoop.be'];
      const bestaand = new Set((result.url_alternatieven || []).map(a => a.url));
      const domeinenAlt = new Set((result.url_alternatieven || []).map(a => {
        const m = a.url?.match(/https?:\/\/(?:www\.)?([\w.-]+)/); return m ? m[1] : '';
      }));
      for (const r of portalResultaten) {
        if (!r.url || r.url === result.url) continue;
        // Makelaar eigen site: gaat in result.url als dat nog leeg is
        const isMakelaar = !toegelaten.some(d => r.domein.includes(d));
        if (isMakelaar && !result.url) {
          result.url = r.url;
          if (!result.status || result.status === 'niet_gevonden') result.status = 'gedeeltelijk';
          console.log(`🔧 Server-side: makelaar URL ${r.url} gezet`);
          continue;
        }
        // Aggregator: max 1 per domein, geen duplicaten
        if (!isMakelaar && toegelaten.some(d => r.domein.includes(d)) && !bestaand.has(r.url) && !domeinenAlt.has(r.domein)) {
          result.url_alternatieven = result.url_alternatieven || [];
          result.url_alternatieven.push({ label: r.label, url: r.url });
          bestaand.add(r.url);
          domeinenAlt.add(r.domein);
          console.log(`🔧 Server-side: ${r.label} URL toegevoegd: ${r.url}`);
        }
      }
    }

    // ── Laatste status-check: niet_gevonden + alternatieven → gedeeltelijk ──
    if (!result.url && Array.isArray(result.url_alternatieven) && result.url_alternatieven.length > 0 && result.status === 'niet_gevonden') {
      result.status = 'gedeeltelijk';
      console.log(`📋 Status upgrade niet_gevonden→gedeeltelijk: ${result.url_alternatieven.length} alternatief(ven) beschikbaar`);
    }

    const altLog = (result.url_alternatieven || []).map(a => `${a.label}: ${a.url}`).join(' | ') || 'geen';
    console.log('✅ SCAN KLAAR:', { makelaar: result.makelaar, status: result.status, adres: result.adres, url: result.url || 'geen', alternatieven: altLog, duur: `${zoekduur}s` });

    // ── Supabase opslaan ────────────────────────────────────────────
    let scanId = null;
    if (supabase) {
      const { data: dbData, error } = await supabase.from('scans').insert({
        makelaar: result.makelaar, makelaar_herkenning: result.makelaar_herkenning,
        makelaar_betrouwbaarheid: (result.makelaar_betrouwbaarheid || '').toLowerCase() || null,
        listing_type: result.listing_type, pand_type: result.pand_type,
        adres_foto: adresFoto, adres: adresListing || result.adres || null,
        gemeente: result.gemeente, prijs: result.prijs, slaapkamers: result.slaapkamers,
        oppervlakte: result.oppervlakte, staat: result.staat, extras: result.extras || [],
        status: result.status, url: result.url, url_alternatieven: result.url_alternatieven || [],
        telefoon: result.telefoon, gevonden_via: result.gevonden_via,
        faal_categorie: result.faal_categorie, notitie: result.notitie,
        gps_beschikbaar: !!gps, gps_nauwkeurigheid_m: gps?.accuracy || null,
        zoekduur_seconden: parseFloat(zoekduur)
      }).select('id').single();
      if (error) { console.error('Supabase schrijffout:', JSON.stringify(error)); }
      else { scanId = dbData?.id; console.log('Scan opgeslagen, id:', scanId); }
    }
    return res.json({ ...result, scan_id: scanId });

  } catch (err) {
    console.error('Server fout:', err);
    return res.status(500).json({ error: 'Server fout: ' + err.message });
  }
});

// ── /api/supabase-check ─────────────────────────────────────────────────
app.get('/api/supabase-check', async (req, res) => {
  if (!supabase) return res.json({ ok: false, reden: 'SUPABASE_ANON_KEY niet ingesteld' });
  try {
    const { data, error } = await supabase.from('scans').select('id').limit(1);
    if (error) return res.json({ ok: false, reden: 'Leestest mislukt', fout: error.message });
    const { data: ins, error: insErr } = await supabase.from('scans').insert({ makelaar: '_test_', status: 'niet_gevonden', gps_beschikbaar: false, zoekduur_seconden: 0 }).select('id').single();
    if (insErr) return res.json({ ok: false, reden: 'Test-insert mislukt', fout: insErr.message });
    await supabase.from('scans').delete().eq('id', ins.id);
    return res.json({ ok: true, bericht: 'Supabase verbinding en insert werken correct' });
  } catch (e) { return res.json({ ok: false, reden: 'Onverwachte fout', fout: e.message }); }
});

// ── /api/test-zoeken ──────────────────────────────────────────────────────
app.get('/api/test-zoeken', async (req, res) => {
  const { makelaar, type, transactie, gemeente, postcode } = req.query;
  const gem = gemeente || 'gent';
  const pc  = postcode || '9000';
  const tr  = transactie || 'Te huur';
  const [makelaarListings, immowebListings] = await Promise.all([
    searchMakelaar(makelaar || 'de fooz', tr, gem, pc),
    searchImmoweb(type || 'duplex', tr, gem, pc)
  ]);
  res.json({ makelaar_direct: { count: makelaarListings.length, listings: makelaarListings }, immoweb_fallback: { count: immowebListings.length, listings: immowebListings } });
});

// ── /api/feedback ─────────────────────────────────────────────────────
app.post('/api/feedback', async (req, res) => {
  const { scan_id, feedback_type, makelaar_correct, makelaar_naam_correct, faal_categorie, opmerking } = req.body;
  if (!supabase) return res.json({ ok: false, reden: 'Supabase niet geconfigureerd' });
  try {
    const record = {
      scan_id:               scan_id || null,
      feedback_type:         feedback_type || null,
      makelaar_correct:      makelaar_correct ?? null,
      makelaar_naam_correct: makelaar_naam_correct || null,
      faal_categorie:        faal_categorie || null,
      opmerking:             opmerking || null,
      created_at:            new Date().toISOString()
    };
    const { error } = await supabase.from('feedback').insert(record);
    if (error) { console.error('Feedback schrijffout:', error.message); return res.json({ ok: false, reden: error.message }); }
    _makelaarsCacheTs = 0;
    console.log('💬 Feedback opgeslagen:', feedback_type, scan_id ? `(scan ${scan_id})` : '');
    return res.json({ ok: true });
  } catch (e) { return res.status(500).json({ ok: false, reden: e.message }); }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', api_key: API_KEY ? 'geladen' : 'ONTBREEKT', serper: SERPER_API_KEY ? 'geladen' : 'ONTBREEKT', supabase: supabase ? 'verbonden' : 'ONTBREEKT', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => console.log(`Immo Scanner v2 listening on port ${PORT}`));

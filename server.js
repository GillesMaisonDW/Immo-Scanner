const express    = require('express');
const path       = require('path');
const { createClient } = require('@supabase/supabase-js');
const app        = express();
// ── Config ────────────────────────────────────────────────────────
const PORT           = process.env.PORT || 3000;
const API_KEY        = process.env.ANTHROPIC_API_KEY;
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
          console.log(`Adres via JSON-LD (${urlLabel}): ${adres}`);
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
        console.log(`Adres via og:title (${urlLabel}): ${adres}`);
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
          console.log(`Adres via __NEXT_DATA__ (${urlLabel}): ${adres}`);
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
  if (prijs)       console.log(`Prijs via detailpagina (${urlLabel}): ${prijs}`);
  if (slaapkamers) console.log(`Slaapkamers (${urlLabel}): ${slaapkamers}`);
  if (oppervlakte) console.log(`Oppervlakte (${urlLabel}): ${oppervlakte}m2`);
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
      if (detail.adres) return detail;
      console.log(`Geen adres via directe fetch voor ${url} -- Puppeteer proberen`);
    }
    const renderedHtml = await fetchWithPuppeteer(url, 15000);
    if (!renderedHtml) return { adres: null, prijs: null, slaapkamers: null, oppervlakte: null };
    return _extractDetailsUitHtml(renderedHtml, label + ' (Puppeteer)');
  } catch (e) {
    console.warn('fetchDetailVanListing fout:', e.message);
    return { adres: null, prijs: null, slaapkamers: null, oppervlakte: null };
  }
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
      console.log(`Visuele check (foto ${i + 1}/${fotoUrls.length}): ${resultaat} -- "${vgl.reden}"`);
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
    console.log(`Photon: straat=${straat}, huisnummer=${huisnummer}, postcode=${postcode}, gemeente=${gemeente}`);
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
    console.log(`BigDataCloud: straat=${straat}, postcode=${postcode}, gemeente=${gemeente}`);
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
  if (!resultaat) resultaat = await _geocodeViaBigDataCloud(lat, lon);
  if (!resultaat) resultaat = await _geocodeViaNominatim(lat, lon);
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
  const { data, error } = await supabase.from('makelaars').select('domein, naam, koop_url, huur_url').order('bevestigd', { ascending: false });
  if (error) { console.warn('Makelaars laden mislukt:', error.message); return []; }
  _makelaarsCache   = data || [];
  _makelaarsCacheTs = nu;
  console.log(`${_makelaarsCache.length} makelaars geladen uit Supabase`);
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
    const tekstSignalen = ['verkocht','vendu','sold','verkauft','verhuurd','loue','rented','vermietet','onder compromis','sous compromis','under offer','onder bod','onder optie','sous option','niet meer beschikbaar','plus disponible','no longer available'];
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
  try { _chromium = require('@sparticuz/chromium'); _puppeteer = require('puppeteer-core'); return true; }
  catch (e) { console.warn('Puppeteer niet beschikbaar:', e.message); return false; }
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
    await page.goto(url, { waitUntil: 'networkidle2', timeout });
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
  console.log(`Ontdekte URLs voor ${domein}: koop=${koopUrl}, huur=${huurUrl}`);
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
  console.log(`Adres ophalen voor max ${kandidaten.length} listings (${lokaal.length} lokaal${straatLw ? `, early exit op "${straatGps}"` : ''})`);
  for (const listing of kandidaten) {
    try {
      const adres = await fetchAdresVanListing(listing.url);
      if (adres) {
        listing.address = adres;
        if (straatLw && adres.toLowerCase().includes(straatLw)) { console.log(`  GPS-straat "${straatGps}" gevonden -- stop`); break; }
      }
    } catch (e) { console.warn(`  Adres ophalen mislukt voor ${listing.url}: ${e.message}`); }
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
    if (naamLower.includes(siteNorm) || siteNorm.includes(naamLower.split(' ')[0])) { match = m; break; }
    const woorden = naamLower.split(' ').filter(w => w.length > 2);
    if (woorden.length > 0 && woorden.every(w => siteNorm.includes(w))) { match = m; break; }
  }
  if (!match) { console.log(`Makelaar "${makelaarNaam}" niet in database`); return []; }
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
  console.log(`Makelaar ${domein} rechtstreeks ophalen:`, url);
  try {
    const html = await slimFetchHtml(url);
    if (!html) { console.warn(`Makelaarsite ophalen mislukt voor ${url}`); return []; }
    console.log(`${domein} HTML: ${html.length} bytes`);
    const listings = [];
    // Methode 1: __NEXT_DATA__
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const nd = JSON.parse(nextMatch[1]);
        const pp = nd?.props?.pageProps || {};
        const results = pp.properties || pp.listings || pp.results || pp.classifieds || [];
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
    const linkRegex = /href="((?:https?:\/\/[^"]*)?\/(?:te-huur|te-koop|huur|koop|detail|listing|property)[\/\-][^"]{5,120})"/gi;
    let lm;
    const seenUrls = new Set(listings.map(l => l.url));
    while ((lm = linkRegex.exec(html)) !== null) {
      let href = lm[1];
      if (!href.startsWith('http')) href = `https://${domein}${href}`;
      const hrefZonderQuery = href.split('?')[0];
      if (!seenUrls.has(hrefZonderQuery) && hrefZonderQuery.split('/').length > 3) {
        seenUrls.add(hrefZonderQuery);
        const urlSegmenten = hrefZonderQuery.split('/').filter(Boolean);
        const beschrijvend = urlSegmenten.slice(-2).find(s => !/^\d+$/.test(s)) || urlSegmenten[urlSegmenten.length-1] || 'Listing';
        listings.push({ url: hrefZonderQuery, title: beschrijvend.replace(/-/g,' '), bron: `${domein}_regex` });
      }
    }
    console.log(`${domein}: ${listings.length} listings gevonden`);
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

const PROMPT_STAP2 = `Je bent de Immo Scanner. Je analyseert een foto van een makelaarsbord en zoekt de bijhorende listing.

## ALTIJD GELDENDE REGELS
1. Geen hallucinations. Vul enkel velden in met data uit echte gevonden listings.
2. Transactie (te koop / te huur) moet kloppen met het bord.
3. Kies nooit raak. "niet_gevonden" of "gedeeltelijk" is eerlijker dan een verkeerde match.
4. Een URL van Realo of Immoscoop is BETER dan geen URL.
5. Kies een prijs van de meest betrouwbare bron. Vermeld geen prijsverschillen tussen aggregators.

## WANNEER JE WEB SEARCH GEBRUIKT
Zoek in deze volgorde:
1. "[GPS-straatnaam]" "[gemeente]" site:[makelaarsdomein]
2. "[GPS-straatnaam]" "[gemeente]" site:realo.be
3. "[GPS-straatnaam]" "[gemeente]" site:immoscoop.be
4. "[GPS-straatnaam]" "[gemeente]" site:spotto.be
5. "[Makelaar naam]" "[GPS-straatnaam]" "[gemeente]" te koop

ADRESREGEL: match ALTIJD op straatnaam.
BRONREGEL: prijs, oppervlakte en slaapkamers moeten van DEZELFDE pagina komen als de URL.

URL-REGELS:
- "url": ENKEL de URL op de website van de makelaar zelf. Null als niet gevonden.
- "url_alternatieven": directe detail-pagina URLs van aggregators.
  Gebruik NOOIT een zoekresultatenpagina (herkenbaar aan /search/, /zoeken/, ?q=, ?page=).

## WANNEER JE EEN LIJST VAN LISTINGS KRIJGT
Kies de listing die het beste overeenkomt op basis van GPS-straatnaam, pand-type en transactie.

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
    console.log(`Manueel adres: "${adres_manueel}"`);
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
    }
    const _straatMet = geocodeResultaat?.straat
      ? [geocodeResultaat.straat, geocodeResultaat.huisnummer].filter(Boolean).join(' ')
      : null;
    adresFoto = _straatMet ? `${_straatMet}, ${geocodeResultaat.gemeente || ''}`.trim().replace(/,$/, '') : null;
  }

  try {
    // ── STAP 1: Foto-analyse ──────────────────────────────────────
    console.log('STAP 1: Foto-analyse starten...');
    const stap1Resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 600, temperature: 0, system: PROMPT_STAP1, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime || 'image/jpeg', data: image } }, { type: 'text', text: 'Analyseer dit makelaarsbord. Geef de JSON.' }] }] })
    });
    if (!stap1Resp.ok) { const err = await stap1Resp.text(); return res.status(502).json({ error: `Claude API fout stap 1 (${stap1Resp.status}).` }); }
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
    console.log('STAP 1 klaar:', bordInfo.makelaar, bordInfo.makelaar_betrouwbaarheid, bordInfo.listing_type);

    const gemeente = geocodeResultaat?.gemeente || 'Gent';
    const postcode = geocodeResultaat?.postcode || '9000';
    const landcode = geocodeResultaat?.landcode || 'BE';
    const hoofdgemeenteViaPostcode = await gemeenteViaPostcode(postcode, landcode);
    const hoofdgemeente = hoofdgemeenteViaPostcode || geocodeResultaat?.hoofdgemeente || gemeente.toLowerCase();

    // ── STAP 1.5a: Telefoonnummer ─────────────────────────────────
    if (!makelaar_override && bordInfo.telefoon) {
      console.log(`Stap 1.5a: Telefoonnummer "${bordInfo.telefoon}" opzoeken...`);
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
        if (siteBase.length < 3) continue;
        let score = 0;
        if (naamLow === siteBase)                                    score = 10;
        else if (naamLow.replace(/\s/g,'') === siteBase.replace(/\s/g,'')) score = 9;
        else if (naamLow.includes(siteBase) && siteBase.length >= 5) score = 7;
        else if (siteBase.includes(naamLow) && naamLow.length >= 5)  score = 7;
        if (score > besteScore) { besteScore = score; besteMatch = m; }
      }
      if (besteMatch && besteScore >= 7) { domeinMakelaar = besteMatch.domein.replace('www.',''); makelaarInDB = true; }
    }

    if (!makelaarInDB && domeinMakelaar) {
      await voegMakelaarToeAanSupabase(domeinMakelaar, bordInfo.makelaar, null, null, bordInfo.telefoon || null);
      ontdekMakelaarUrls(domeinMakelaar).catch(e => console.warn('URL-ontdekking achtergrond fout:', e.message));
    }

    const gpsStraat = geocodeResultaat?.straat || null;
    const gpsVolledigAdres = gpsStraat && geocodeResultaat?.huisnummer ? `${gpsStraat} ${geocodeResultaat.huisnummer}` : gpsStraat;
    let listings = [];
    let listingsBron = 'geen';

    if (makelaarInDB) {
      console.log(`SCRAPING: ${domeinMakelaar} in DB`);
      listings = await searchMakelaar(bordInfo.makelaar, bordInfo.listing_type, hoofdgemeente, postcode, bordInfo.makelaar_website);
      listingsBron = 'makelaar_direct';
      if (listings.length > 0) {
        listings = await verrijkListingAdressen(listings, hoofdgemeente, postcode, gpsStraat);
        if (gpsStraat) {
          const straatLow  = gpsStraat.toLowerCase();
          const gpsNummer  = geocodeResultaat?.huisnummer || null;
          const nummerNorm = _normaliseHuisnummer(gpsNummer);
          const straatMatches = listings.filter(l => (l.address || '').toLowerCase().includes(straatLow));
          if (straatMatches.length > 0) {
            if (gpsNummer && nummerNorm) {
              const nummerMatches = straatMatches.filter(l => _normaliseHuisnummer(l.address || '').includes(nummerNorm));
              listings = nummerMatches.length > 0 ? nummerMatches : straatMatches;
            } else { listings = straatMatches; }
          } else { listings = []; listingsBron = 'straat_geen_match'; }
        }
      } else { listingsBron = 'scraping_leeg'; }
    } else if (gpsStraat) {
      console.log(`WEB SEARCH: "${bordInfo.makelaar}" niet in DB`);
      listingsBron = 'web_search_direct';
    } else {
      console.log('IMMOWEB: fallback');
      listings = await searchImmoweb(bordInfo.pand_type_slug, bordInfo.listing_type, hoofdgemeente, postcode);
      listingsBron = 'immoweb_fallback';
    }

    // ── Co-makelaar: ook extra makelaar doorzoeken ────────────────
    const makelaarExtra = bordInfo.makelaar_extra || null;
    if (makelaarExtra?.naam && listings.length === 0) {
      console.log(`Co-makelaar "${makelaarExtra.naam}" ook doorzoeken...`);
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
            console.log(`Co-makelaar "${makelaarExtra.naam}": ${listings.length} listing(s) met straat "${gpsStraat}"`);
          } else {
            console.log(`Co-makelaar "${makelaarExtra.naam}": geen straat-match`);
          }
        } else {
          listings = verrijktExtra;
          listingsBron = `co_makelaar_${makelaarExtra.naam.toLowerCase().replace(/\s+/g,'_')}`;
          console.log(`Co-makelaar "${makelaarExtra.naam}": ${listings.length} listing(s)`);
        }
      } else {
        console.log(`Co-makelaar "${makelaarExtra.naam}": ook geen listings`);
      }
    }

    console.log(`STAP 2 klaar: ${listings.length} listings via ${listingsBron}${makelaarExtra ? ` | Co-makelaar: ${makelaarExtra.naam}` : ''}`);

    // ── Context voor Claude ───────────────────────────────────────
    let listingsContext = '';
    const domeinHint = domeinMakelaar || (bordInfo.makelaar || '').toLowerCase().replace(/\s+/g,'') + '.be';
    const deelgemeente = geocodeResultaat?.gemeente || null;
    const heeftDeelgemeente = deelgemeente && hoofdgemeente && deelgemeente.toLowerCase() !== hoofdgemeente.toLowerCase();

    if (listingsBron === 'web_search_direct' || listingsBron === 'scraping_leeg' || listingsBron === 'straat_geen_match') {
      const waarom = { 'web_search_direct': 'Makelaar staat niet in onze database.', 'scraping_leeg': 'Directe scraping leverde geen listings op.', 'straat_geen_match': `Scraping vond listings, maar geen enkele had adres "${gpsStraat}".` }[listingsBron] || '';
      listingsContext = `\n\n## WEB SEARCH VEREIST\n${gpsVolledigAdres ? `GPS-adres: "${gpsVolledigAdres}"` : 'Geen GPS beschikbaar.'}\nPostcode: ${postcode}\nMakelaar: ${bordInfo.makelaar} (${domeinHint})\nReden: ${waarom}\n\nZoek: "${gpsVolledigAdres || postcode}" site:${domeinHint}\nFallback: "${gpsVolledigAdres || postcode}" "${postcode}" ${bordInfo.listing_type}\nURL-prioriteit: makelaar > Immoscoop/Realo/Spotto > Immoweb.\n`;
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
      listingsContext = `\n\n## GEEN LISTINGS GEVONDEN\n${gpsVolledigAdres ? `Probeer web_search: "${gpsVolledigAdres}" site:${domeinHint}` : 'Geen GPS beschikbaar.'}\n`;
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
    console.log('STAP 3: Claude matcht listing uit', listings.length, 'kandidaten...');
    const stap3Resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'web-search-2025-03-05' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        system: PROMPT_STAP2,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mime || 'image/jpeg', data: image } },
          { type: 'text', text: `## BORDANALYSE (stap 1)\nMakelaar: ${bordInfo.makelaar} (${bordInfo.makelaar_herkenning})\nBetrouwbaarheid: ${bordInfo.makelaar_betrouwbaarheid}\nType: ${bordInfo.listing_type}\nPand: ${bordInfo.pand_type_slug}\nReferentienummer: ${bordInfo.referentienummer || 'niet zichtbaar'}\nTelefoon: ${bordInfo.telefoon || 'niet zichtbaar'}\nMakelaar website: ${domeinMakelaar || bordInfo.makelaar_website || 'onbekend'}\n${makelaarExtra ? `Co-makelaar: ${makelaarExtra.naam} (${makelaarExtra.website || 'onbekend'})\n` : ''}\n## LOCATIE\n${locatieInfo}\n${listingsContext}\nGeef het resultaat als JSON.` }
        ]}]
      })
    });
    const zoekduur = ((Date.now() - startTime) / 1000).toFixed(2);
    if (!stap3Resp.ok) { return res.status(502).json({ error: `Claude API fout stap 3 (${stap3Resp.status}).` }); }
    const stap3Data = await stap3Resp.json();

    let rawText = '';
    for (const block of stap3Data.content) { if (block.type === 'text' && block.text.includes('{')) rawText = block.text; }
    if (!rawText) return res.status(500).json({ error: 'Matching mislukt.' });
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Matching mislukt.' });
    const result = JSON.parse(jsonMatch[0]);

    result.makelaar             = result.makelaar             || bordInfo.makelaar;
    result.makelaar_herkenning  = result.makelaar_herkenning  || bordInfo.makelaar_herkenning;
    result.makelaar_betrouwbaarheid = result.makelaar_betrouwbaarheid || bordInfo.makelaar_betrouwbaarheid;
    result.telefoon             = result.telefoon             || bordInfo.telefoon;
    if (!Array.isArray(result.url_alternatieven)) result.url_alternatieven = [];

    // ── Fallback: URLs uit web_search tool-results ────────────────
    if (result.url_alternatieven.length === 0 && gpsStraat) {
      const straatLower = gpsStraat.toLowerCase();
      const aggregators = [{ domein: 'realo.be', label: 'Realo' }, { domein: 'immoscoop.be', label: 'Immoscoop' }, { domein: 'spotto.be', label: 'Spotto' }];
      const gevondenUrls = new Set();
      for (const block of stap3Data.content) {
        const blockStr = JSON.stringify(block);
        for (const agg of aggregators) {
          const urlRegex = new RegExp(`https?://(?:www\\.)?${agg.domein.replace('.','\\.')}[^"'\\s<>]+`, 'gi');
          let m;
          while ((m = urlRegex.exec(blockStr)) !== null) {
            const gevondenUrl = m[0].replace(/\\u[0-9a-f]{4}/gi, c => String.fromCharCode(parseInt(c.slice(2),16)));
            const isZoekpagina = /\/search\/|\/zoeken\/|\/resultaten\/|\?q=|\?page=/i.test(gevondenUrl);
            if (!isZoekpagina && !gevondenUrls.has(agg.domein) && (gevondenUrl.toLowerCase().includes(straatLower.split(' ')[0]) || (postcode && gevondenUrl.includes(postcode)))) {
              gevondenUrls.add(agg.domein);
              result.url_alternatieven.push({ label: agg.label, url: gevondenUrl });
            }
          }
        }
      }
    }

    // ── Details van detailpagina (prijs, adres, kamers) ──────────
    let adresListing = null;
    if (result.url && result.status !== 'niet_gevonden') {
      const detail = await fetchDetailVanListing(result.url);
      adresListing = detail.adres || null;
      if (adresListing) console.log('Adres van detailpagina:', adresListing);
      if (detail.prijs)      { console.log(`Prijs overschreven: "${result.prijs}" -> "${detail.prijs}"`); result.prijs = detail.prijs; }
      if (detail.slaapkamers) result.slaapkamers = detail.slaapkamers;
      if (detail.oppervlakte) result.oppervlakte = detail.oppervlakte;
    }

    // ── URL verificatie ───────────────────────────────────────────
    if (result.url) {
      const urlActief = await checkUrlActief(result.url);
      if (urlActief === false) {
        result.url = null; result.status = 'niet_gevonden';
        result.faal_categorie = result.faal_categorie || 'LISTING_NIET_ONLINE';
        result.notitie = 'De listing bestaat niet meer (404). ' + (result.notitie || '');
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
    if (Array.isArray(result.url_alternatieven) && result.url_alternatieven.length > 0) {
      const beschikbaarChecks = await Promise.all(result.url_alternatieven.map(alt => isNietBeschikbaar(alt.url)));
      result.url_alternatieven = result.url_alternatieven.filter((_, i) => !beschikbaarChecks[i]);
    }

    // ── Gemeente + adres cleanup ──────────────────────────────────
    if (!result.gemeente && geocodeResultaat?.gemeente) result.gemeente = geocodeResultaat.gemeente;
    if (result.adres === 'Niet bepaald') result.adres = null;

    // ── GPS-straat validatie ──────────────────────────────────────
    if (gpsStraat && adresListing) {
      const straatLow  = gpsStraat.toLowerCase();
      const adresLow   = adresListing.toLowerCase();
      const straatOk   = adresLow.includes(straatLow);
      const postcodeOk = !postcode || adresListing.includes(postcode);
      if (!straatOk || !postcodeOk) {
        const reden = !straatOk ? `straat "${gpsStraat}" niet in "${adresListing}"` : `postcode mismatch`;
        console.log(`Adres-mismatch (${reden}) -> URL gewist`);
        result.url = null; result.status = 'niet_gevonden';
        result.faal_categorie = result.faal_categorie || 'ADRES_MISMATCH';
        result.notitie = `Gevonden listing staat op "${adresListing}" maar GPS-locatie is "${gpsStraat}". ` + (result.notitie || '');
        adresListing = null;
      }
    }
    if (adresListing) result.adres = adresListing;

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

    console.log('SCAN KLAAR:', { makelaar: result.makelaar, status: result.status, adres: result.adres, duur: `${zoekduur}s` });

    // ── Supabase opslaan ──────────────────────────────────────────
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

// ── /api/supabase-check ───────────────────────────────────────────
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

// ── /api/test-zoeken ──────────────────────────────────────────────
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

// ── /api/feedback ─────────────────────────────────────────────────
app.post('/api/feedback', async (req, res) => {
  const { scan_id, feedback_type, makelaar_correct, makelaar_naam_correct, faal_categorie_override } = req.body;
  console.log('FEEDBACK:', { scan_id, feedback_type, makelaar_correct, makelaar_naam_correct });
  if (supabase && scan_id) {
    const { error } = await supabase.from('feedback').insert({ scan_id, feedback_type, makelaar_correct: makelaar_correct ?? null, makelaar_naam_correct: makelaar_naam_correct || null, faal_categorie_override: faal_categorie_override || null });
    if (error) console.error('Supabase feedback fout:', error.message);
  }
  return res.json({ ok: true });
});

// ── Health check ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', api_key: API_KEY ? 'geladen' : 'ONTBREEKT', supabase: supabase ? 'verbonden' : 'ONTBREEKT', timestamp: new Date().toISOString() });
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Immo Scanner draait op http://localhost:${PORT}`);
  console.log(`API key: ${API_KEY ? 'geladen' : 'ONTBREEKT'}`);
});

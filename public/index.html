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
if (!supabase) console.warn('⚠️  SUPABASE_ANON_KEY niet ingesteld — scans worden niet opgeslagen.');
if (!API_KEY)   console.warn('⚠️  ANTHROPIC_API_KEY niet ingesteld als environment variable!');

// ── Middleware ────────────────────────────────────────────────────
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));


// ═══════════════════════════════════════════════════════════════════
//  HULPFUNCTIES
// ═══════════════════════════════════════════════════════════════════

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
    console.warn('URL check mislukt voor', url, '—', e.message);
    return null;
  }
}

// ── Adres ophalen van detail-pagina van een listing ───────────────
// Na matching bezoeken we de detailpagina om het exacte adres te extraheren.
// ── Diepte-zoekactie in JSON-object ──────────────────────────────
// Vindt een sleutel op elk nestniveau, ongeacht de structuur van de site.
// Werkt voor ld.address, ld.geo.address, ld.location.address, enz.
function _deepFind(obj, sleutel, maxDiepte = 8) {
  if (!obj || typeof obj !== 'object' || maxDiepte === 0) return undefined;
  if (sleutel in obj) return obj[sleutel];
  for (const waarde of Object.values(obj)) {
    const gevonden = _deepFind(waarde, sleutel, maxDiepte - 1);
    if (gevonden !== undefined) return gevonden;
  }
  return undefined;
}

function _extractAdresUitHtml(html, urlLabel) {
  // Methode 1: JSON-LD structured data — diepte-zoekactie
  // Werkt voor elke site die schema.org gebruikt, ongeacht nestniveau.
  // Meeste professionele makelaarsites doen dit voor SEO (Google vereist het).
  const jsonldRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let jm;
  while ((jm = jsonldRegex.exec(html)) !== null) {
    try {
      const ld = JSON.parse(jm[1]);
      const straat   = _deepFind(ld, 'streetAddress');
      const postcode = _deepFind(ld, 'postalCode');
      const regio    = _deepFind(ld, 'addressRegion');
      if (straat && typeof straat === 'string' && straat.length > 3) {
        // Bouw adres: "Rechtstraat 65A, 9080 Lochristi"
        const delen = [straat.trim()];
        if (postcode || regio) delen.push([postcode, regio].filter(Boolean).join(' '));
        const resultaat = delen.join(', ');
        console.log(`📍 Adres via JSON-LD (${urlLabel}): ${resultaat}`);
        return resultaat;
      }
    } catch {}
  }

  // Methode 2: meta og:title (bv. "Woning Te koop - Rechtstraat 65A, 9080 Lochristi")
  const ogTitleMatch = html.match(/<meta[^>]*(?:name|property)="og:title"[^>]*content="([^"]+)"/i)
    || html.match(/<meta[^>]*content="([^"]+)"[^>]*(?:name|property)="og:title"/i);
  if (ogTitleMatch) {
    // Patroon: "... - Straatnaam Huisnummer, Postcode Gemeente"
    const adresMatch = ogTitleMatch[1].match(/[-–]\s*([A-Z][^,]{4,50},\s*\d{4}\s+\S[^"]{2,40})/);
    if (adresMatch) {
      console.log(`📍 Adres via og:title (${urlLabel}): ${adresMatch[1].trim()}`);
      return adresMatch[1].trim();
    }
  }

  // Methode 3: __NEXT_DATA__ (Next.js SSR)
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch) {
    try {
      const nd = JSON.parse(nextMatch[1]);
      const pp   = nd?.props?.pageProps || {};
      const prop = pp.property || pp.listing || pp.classified || pp.result || {};
      const loc  = prop.location || prop.address || {};
      const straat   = loc.street || loc.streetAddress || loc.straat || null;
      const nr       = loc.number || loc.houseNumber || '';
      const gemeente = loc.locality || loc.city || loc.gemeente || '';
      if (straat) {
        const adres = [straat, nr].filter(Boolean).join(' ').trim();
        console.log(`📍 Adres via __NEXT_DATA__ (${urlLabel}): ${adres}, ${gemeente}`);
        return gemeente ? `${adres}, ${gemeente}` : adres;
      }
    } catch {}
  }

  // Methode 4: Regex patronen
  const adresPatterns = [
    /"streetAddress"\s*:\s*"([^"]{5,80})"/i,
    /"adres"\s*:\s*"([^"]{5,80})"/i,
    /"address"\s*:\s*"([^"]{5,80})"/i,
    /<[^>]*class="[^"]*(?:adres|address|location|locatie)[^"]*"[^>]*>\s*([A-Z][^<]{4,60})</i,
  ];
  for (const pattern of adresPatterns) {
    const match = html.match(pattern);
    if (match) {
      console.log(`📍 Adres via regex (${urlLabel}): ${match[1].trim()}`);
      return match[1].trim();
    }
  }

  return null;
}

async function fetchAdresVanListing(url) {
  if (!url) return null;
  try {
    // Eerste poging: directe fetch — JSON-LD is server-side rendered op de meeste sites.
    // Puppeteer is hier NIET nodig voor structuurdata; dat spaart geheugen op Render.
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
      const adres = _extractAdresUitHtml(html, url.split('/').slice(-2).join('/'));
      if (adres) return adres;
      console.log(`⚠️  Geen adres via directe fetch voor ${url} — Puppeteer proberen`);
    }

    // Tweede poging: Puppeteer (voor volledig client-side rendered detail pagina's)
    const renderedHtml = await fetchWithPuppeteer(url, 15000);
    if (!renderedHtml) return null;
    const adres = _extractAdresUitHtml(renderedHtml, url.split('/').slice(-2).join('/') + ' (Puppeteer)');
    if (!adres) console.log('⚠️ Geen adres gevonden op detailpagina:', url);
    return adres;
  } catch (e) {
    console.warn('fetchAdresVanListing fout:', e.message);
    return null;
  }
}

// ── Postcode → officiële hoofdgemeente via Nominatim ─────────────
// Werkt voor BE, NL, DE, FR, ... — geen hardcoded mapping nodig.
// Cache om herhaalde lookups te vermijden.
const _postcodeCachce = {};

async function gemeenteViaPostcode(postcode, landcode) {
  if (!postcode || !landcode) return null;
  const cacheKey = `${landcode}-${postcode}`;
  if (_postcodeCachce[cacheKey]) return _postcodeCachce[cacheKey];

  try {
    const url = `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(postcode)}&country=${landcode}&format=json&limit=1&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'ImmoScannerApp/1.0 (gilles@maisondw.be)' },
      signal: AbortSignal.timeout(5000)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || data.length === 0) return null;

    const addr = data[0].address || {};
    // Nominatim geeft de officiële hoofdgemeente terug, niet het deelgemeente
    const gemeente = addr.city || addr.town || addr.village || addr.municipality || null;
    if (gemeente) {
      _postcodeCachce[cacheKey] = gemeente.toLowerCase();
      console.log(`📮 Postcode ${postcode} (${landcode}) → hoofdgemeente: ${gemeente}`);
    }
    return gemeente ? gemeente.toLowerCase() : null;
  } catch (e) {
    console.warn('Postcode lookup fout:', e.message);
    return null;
  }
}

// ── Nominatim reverse geocoding ───────────────────────────────────
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'ImmoScannerApp/1.0 (gilles@maisondw.be)' }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const addr = data.address || {};
    // TIJDELIJKE DEBUG: log alle Nominatim-velden zodat we weten welk veld de straatnaam bevat
    console.log(`🗺️  Nominatim [${lat},${lon}] → ${JSON.stringify(addr)}`);
    const postcode  = addr.postcode || null;
    const landcode  = addr.country_code?.toUpperCase() || 'BE';
    // Gebruik city/town als primaire gemeente (= officiële hoofdgemeente)
    // village/suburb kan een deelgemeente zijn
    const deelgemeente = addr.village || addr.suburb || null;
    const hoofdstad    = addr.city || addr.town || addr.municipality || null;
    const straat = addr.road || addr.pedestrian || addr.square || addr.path || null;

    return {
      straat,
      gemeente:    deelgemeente || hoofdstad,   // voor weergave
      hoofdgemeente: hoofdstad?.toLowerCase() || deelgemeente?.toLowerCase() || null,
      postcode,
      landcode,
      volledig:    data.display_name
    };
  } catch (e) {
    console.warn('Nominatim fout:', e.message);
    return null;
  }
}

// ── Makelaar database via Supabase ────────────────────────────────
// Makelaars worden opgeslagen in Supabase (tabel: makelaars).
// URL-templates gebruiken {gemeente} en {postcode} als placeholders.

let _makelaarsCacheTs  = 0;
let _makelaarsCache    = [];
const CACHE_TTL_MS     = 5 * 60 * 1000; // 5 minuten cache

async function laadMakelaarsUitSupabase() {
  const nu = Date.now();
  if (nu - _makelaarsCacheTs < CACHE_TTL_MS && _makelaarsCache.length > 0) {
    return _makelaarsCache; // gebruik cache
  }
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('makelaars')
    .select('domein, naam, koop_url, huur_url')
    .order('bevestigd', { ascending: false });
  if (error) { console.warn('Makelaars laden mislukt:', error.message); return []; }
  _makelaarsCache   = data || [];
  _makelaarsCacheTs = nu;
  console.log(`📚 ${_makelaarsCache.length} makelaars geladen uit Supabase`);
  return _makelaarsCache;
}

// ── Beschikbaarheidscheck ─────────────────────────────────────────
// Haalt de listing-pagina op en zoekt naar signalen dat het pand
// niet meer beschikbaar is (verkocht, verhuurd, onder optie...).
// Retourneert true als het pand NIET meer beschikbaar is.
async function isNietBeschikbaar(url) {
  if (!url) return false;
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ImmoScanner/1.0)' },
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) return false;
    const html = await resp.text();
    const tekst = html.toLowerCase();

    // Zoek naar expliciete tekst-signalen (case-insensitive via .toLowerCase())
    const tekstSignalen = [
      'verkocht', 'vendu', 'sold', 'verkauft',
      'verhuurd', 'loué', 'rented', 'vermietet',
      'onder compromis', 'sous compromis', 'under offer',
      'onder bod', 'onder optie', 'sous option',
      'niet meer beschikbaar', 'plus disponible', 'no longer available',
      'reeds verkocht', 'déjà vendu', 'already sold',
      'option', // voorzichtig: enkel als ook CSS-klasse hieronder matcht
    ];

    // Zoek naar CSS-klassen en HTML-attributen die makelaars gebruiken
    const cssSignalen = [
      'class="sold"', 'class="verkocht"', 'class="vendu"',
      'class="status-sold"', 'class="badge-sold"', 'class="label-sold"',
      'class="is-sold"', 'class="tag-sold"', 'class="sold-out"',
      'status--sold', 'property-sold', 'listing-sold',
      'data-status="sold"', 'data-status="verkocht"',
      '"sold":true', '"is_sold":true', '"status":"sold"',
    ];

    // Expliciete tekst (zonder "option" — die is te breed)
    const tekstTreffer = tekstSignalen
      .filter(s => s !== 'option')
      .find(s => tekst.includes(s));
    if (tekstTreffer) {
      console.log(`🔴 Niet beschikbaar (tekst: "${tekstTreffer}"): ${url}`);
      return true;
    }

    // CSS/HTML-klassen
    const cssTreffer = cssSignalen.find(s => tekst.includes(s));
    if (cssTreffer) {
      console.log(`🔴 Niet beschikbaar (CSS: "${cssTreffer}"): ${url}`);
      return true;
    }

    return false;
  } catch (e) {
    console.log(`⚠️  Beschikbaarheidscheck mislukt voor ${url}: ${e.message}`);
    return false; // bij twijfel: toon de URL gewoon
  }
}

function vulUrlIn(template, gemeente, postcode) {
  if (!template) return null;
  return template
    .replace(/\{gemeente\}/g, (gemeente || 'gent').toLowerCase())
    .replace(/\{postcode\}/g, postcode || '9000');
}

async function voegMakelaarToeAanSupabase(domein, naam, koopUrl, huurUrl, telefoon) {
  if (!supabase || !domein) return;
  const record = {
    domein, naam: naam || domein,
    koop_url: koopUrl || null,
    huur_url: huurUrl || null,
    toegevoegd_door: 'automatisch',
    bevestigd: false,
    updated_at: new Date().toISOString()
  };
  if (telefoon) record.telefoon = telefoon;
  const { error } = await supabase.from('makelaars').upsert(record, { onConflict: 'domein', ignoreDuplicates: false });
  if (error) console.warn('Makelaar toevoegen mislukt:', error.message);
  else {
    console.log(`✅ Makelaar "${naam || domein}" (${domein}) toegevoegd/bijgewerkt in Supabase`);
    _makelaarsCacheTs = 0; // cache invalideren
  }
}

// ── Puppeteer: headless browser voor client-side rendered sites ───
// Wordt lazy geladen — alleen gestart als de gewone fetch te weinig
// HTML-tekst teruggeeft (JS-rendered site zoals immo-home.be).
//
// @sparticuz/chromium is geoptimaliseerd voor cloud/serverless:
//   - Geen extra systeempakketten nodig
//   - Werkt op Render, Lambda, etc.
//   - Blokkeert afbeeldingen/fonts → sneller laden

let _chromium  = null;
let _puppeteer = null;
let _browser   = null;
let _browserLastUsed = 0;

async function laadPuppeteer() {
  if (_chromium && _puppeteer) return true;
  try {
    _chromium  = require('@sparticuz/chromium');
    _puppeteer = require('puppeteer-core');
    console.log('🤖 Puppeteer + Chromium module geladen');
    return true;
  } catch (e) {
    console.warn('⚠️  Puppeteer niet beschikbaar:', e.message);
    return false;
  }
}

async function getPuppeteerBrowser() {
  if (_browser) {
    try { if (_browser.isConnected()) { _browserLastUsed = Date.now(); return _browser; } }
    catch (_) { /* browser gecrasht */ }
    _browser = null;
  }
  if (!(await laadPuppeteer())) return null;
  try {
    const execPath = await _chromium.executablePath();
    _browser = await _puppeteer.launch({
      args: [
        ..._chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ],
      defaultViewport: _chromium.defaultViewport,
      executablePath: execPath,
      headless: _chromium.headless,
      ignoreHTTPSErrors: true
    });
    _browserLastUsed = Date.now();
    console.log('🌐 Puppeteer browser gestart');
    return _browser;
  } catch (e) {
    console.warn('Puppeteer browser starten mislukt:', e.message);
    _browser = null;
    return null;
  }
}

// Sluit browser na 3 minuten inactiviteit om geheugen vrij te maken
setInterval(() => {
  if (_browser && Date.now() - _browserLastUsed > 3 * 60 * 1000) {
    console.log('🔒 Puppeteer browser gesloten (inactiviteit)');
    _browser.close().catch(() => {});
    _browser = null;
  }
}, 60 * 1000);

async function fetchWithPuppeteer(url, timeout = 20000) {
  const browser = await getPuppeteerBrowser();
  if (!browser) return null;
  let page = null;
  try {
    page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    );
    // Blokkeer zware resources om sneller te laden
    await page.setRequestInterception(true);
    page.on('request', req => {
      const t = req.resourceType();
      if (['image', 'font', 'media'].includes(t)) req.abort();
      else req.continue();
    });
    await page.goto(url, { waitUntil: 'networkidle2', timeout });

    // Scroll naar beneden om lazy-loaded listings te triggeren,
    // dan terug omhoog, dan opnieuw naar beneden (sommige sites
    // laden pas bij echte scroll-beweging).
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await new Promise(r => setTimeout(r, 800));
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await new Promise(r => setTimeout(r, 1200));

    const html = await page.content();
    console.log(`🤖 Puppeteer ${url.slice(0, 60)}: ${html.length} bytes`);
    return html;
  } catch (e) {
    console.warn('Puppeteer fetch fout voor', url, ':', e.message);
    // Browser kan gecrasht zijn — reset singleton
    if (_browser) { _browser.close().catch(() => {}); _browser = null; }
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

// ── Slim fetch: regulier eerst, Puppeteer als fallback ────────────
// Detectie: als de body-tekst < 800 tekens is, dan is de site
// vermoedelijk client-side rendered en sturen we Puppeteer in.
async function slimFetchHtml(url) {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) {
      console.warn(`slimFetchHtml: HTTP ${resp.status} voor ${url}`);
    } else {
      const html = await resp.text();
      // Hoeveel zichtbare tekst zit er in de body?
      const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const zichtbareTekst = (bodyMatch?.[1] || html)
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (zichtbareTekst.length >= 800) {
        console.log(`📄 Reguliere fetch OK voor ${url.slice(0, 60)}: ${zichtbareTekst.length} tekens tekst`);
        return html;
      }
      console.log(`⚠️  Slechts ${zichtbareTekst.length} tekens tekst — client-side rendered? → Puppeteer proberen`);
    }
  } catch (e) {
    console.warn(`slimFetchHtml reguliere fetch mislukt voor ${url}: ${e.message}`);
  }
  // Fallback: Puppeteer
  return await fetchWithPuppeteer(url);
}

// ── Auto-ontdekking van makelaar listing-URLs ─────────────────────
// Wanneer een nieuwe makelaar in de database staat zonder koop_url/huur_url,
// haalt deze functie de homepage op en zoekt automatisch de zoek-URLs.
// Gevonden URLs worden opgeslagen in Supabase zodat de volgende scan
// ze direct kan gebruiken — zonder manuele tussenkomst.

async function ontdekMakelaarUrls(domein) {
  console.log(`🔍 URL-ontdekking voor ${domein}...`);
  const homepage = `https://${domein.startsWith('www.') ? domein : 'www.' + domein}`;

  const html = await slimFetchHtml(homepage);
  if (!html) {
    console.warn(`URL-ontdekking: geen HTML van ${homepage}`);
    return { koopUrl: null, huurUrl: null };
  }

  // Extraheer alle links uit de navigatie
  const alleLinks = [];
  const linkRegex = /href="([^"]{5,120})"/g;
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    let href = m[1];
    // Relatieve paden aanvullen
    if (href.startsWith('/')) href = `https://${domein.startsWith('www.') ? domein : 'www.' + domein}${href}`;
    if (href.startsWith('http') && href.includes(domein.replace('www.', ''))) {
      alleLinks.push(href);
    }
  }

  // Zoek "te koop" en "te huur" kandidaten — kortste = meest generiek
  const koopKandidaten = alleLinks
    .filter(l => /te-koop|tekoop|\/koop|\/sale|\/properties|\/aanbod/i.test(l))
    .sort((a, b) => a.length - b.length);

  const huurKandidaten = alleLinks
    .filter(l => /te-huur|tehuur|\/huur|\/rent|\/location|\/verhuur/i.test(l))
    .sort((a, b) => a.length - b.length);

  // Filter kandidaten die te specifiek zijn (bv. "/te-koop/gent/9000/villa")
  const kiesBesteUrl = (kandidaten) => {
    for (const url of kandidaten) {
      const pad = url.replace(/https?:\/\/[^/]+/, '');
      const segmenten = pad.split('/').filter(Boolean).length;
      if (segmenten <= 3) return url; // max 3 niveaus diep = generiek genoeg
    }
    return kandidaten[0] || null;
  };

  const koopUrl = kiesBesteUrl(koopKandidaten);
  const huurUrl = kiesBesteUrl(huurKandidaten);

  console.log(`🔗 Ontdekte URLs voor ${domein}: koop=${koopUrl || 'niet gevonden'}, huur=${huurUrl || 'niet gevonden'}`);

  // Sla onmiddellijk op in Supabase zodat de volgende scan ze direct heeft
  if (supabase && (koopUrl || huurUrl)) {
    const { error } = await supabase.from('makelaars').update({
      koop_url:   koopUrl  || null,
      huur_url:   huurUrl  || null,
      updated_at: new Date().toISOString()
    }).eq('domein', domein);
    if (error) console.warn('Makelaar URLs opslaan mislukt:', error.message);
    else {
      console.log(`✅ URLs voor ${domein} opgeslagen in Supabase`);
      _makelaarsCacheTs = 0; // cache invalideren
    }
  }

  return { koopUrl, huurUrl };
}

// ── Adres-verrijking van kandidaat-listings ───────────────────────
// Listings van makelaarssites bevatten vaak enkel een URL — geen
// straatnaam. Zonder straatnaam kan Claude niet matchen op GPS-locatie.
// Deze functie haalt de detailpagina op van kandidaat-listings die
// in het juiste postcode-gebied liggen, en vult het adres aan.
// Zo kan Claude "Rechtstraat" koppelen aan de juiste listing.
async function verrijkListingAdressen(listings, hoofdgemeente, postcode, straatGps) {
  if (!listings || listings.length === 0) return listings;

  // Filter: enkel listings zonder adres die mogelijk in het juiste gebied liggen
  const gem = (hoofdgemeente || '').toLowerCase();
  const pc  = (postcode || '').toString();

  // Verrijk alle listings zonder adres — we beperken ons niet langer tot listings
  // waarvan gemeente/postcode in de URL staat. Sommige makelaars gebruiken
  // generieke URL-structuren (bv. /detail/7514688) zonder locatieinfo in de slug.
  // We pakken de eerste 5 listings zonder adres en halen die detail-pagina op.
  const kandidaten = listings.filter(l => {
    if (l.address) return false; // al een adres, niets te doen
    if (!l.url)    return false;
    return true; // verrijk alles wat een URL heeft maar geen adres
  }).slice(0, 10); // max 10 detail-pagina's ophalen

  if (kandidaten.length === 0) {
    console.log('📍 Geen kandidaat-listings om te verrijken (alles heeft al een adres)');
    return listings;
  }

  console.log(`📍 Adres ophalen voor ${kandidaten.length} kandidaat-listings (postcode ${pc})...`);

  // Sequentieel ophalen om geheugen te sparen (Puppeteer kan zwaar zijn)
  for (const listing of kandidaten) {
    try {
      const adres = await fetchAdresVanListing(listing.url);
      if (adres) {
        listing.address = adres;
        console.log(`  ✅ ${listing.url.split('/').slice(-2).join('/')} → ${adres}`);
      }
    } catch (e) {
      console.warn(`  ⚠️  Adres ophalen mislukt voor ${listing.url}: ${e.message}`);
    }
  }

  return listings;
}

async function searchMakelaar(makelaarNaam, listingType, gemeente, postcode, makelaarWebsite) {
  const normaliseer  = (s) => (s || '').toLowerCase().replace(/[-\s]+/g, ' ').trim();
  const naamLower    = normaliseer(makelaarNaam);
  const websiteLower = (makelaarWebsite || '').toLowerCase().replace('www.', '');

  // Laad makelaars uit Supabase (gecached)
  const makelaars = await laadMakelaarsUitSupabase();

  let match = null;

  for (const m of makelaars) {
    // Strip alle bekende TLDs incl. .immo — anders matcht "jo.immo" op het woord "immo"
    const siteNorm   = normaliseer(m.domein.replace(/\.(be|com|nl|immo|eu|net|org)$/, ''));
    const domeinClean = m.domein.replace('www.', '');

    // Match 1: website van bord = domein in database
    if (websiteLower && (websiteLower === domeinClean || websiteLower.includes(domeinClean) || domeinClean.includes(websiteLower))) {
      match = m; break;
    }
    // Match 2: naam bevat sitebase of omgekeerd
    if (naamLower.includes(siteNorm) || siteNorm.includes(naamLower.split(' ')[0])) {
      match = m; break;
    }
    // Match 3: alle woorden van naam zitten in sitebase
    const woorden = naamLower.split(' ').filter(w => w.length > 2);
    if (woorden.length > 0 && woorden.every(w => siteNorm.includes(w))) {
      match = m; break;
    }
  }

  if (!match) {
    console.log(`⚠️  Makelaar "${makelaarNaam}" (website: ${makelaarWebsite || 'onbekend'}) niet in database`);
    return [];
  }

  const domein   = match.domein;
  const isHuur   = listingType === 'Te huur';
  let urlTemplate = isHuur ? match.huur_url : match.koop_url;
  const gem      = gemeente?.toLowerCase() || 'gent';
  const pc       = postcode || '9000';

  // ── Auto-ontdekking als URL-template ontbreekt ───────────────────
  // Nieuwe makelaars worden automatisch toegevoegd maar zonder URL.
  // Hier proberen we de URL automatisch te vinden via de homepage.
  if (!urlTemplate) {
    console.log(`⚠️  Geen URL voor ${domein} → automatisch ontdekken...`);
    const ontdekt = await ontdekMakelaarUrls(domein);
    urlTemplate = isHuur ? ontdekt.huurUrl : ontdekt.koopUrl;
    if (!urlTemplate) {
      console.log(`❌ URL-ontdekking mislukt voor ${domein} — geen listings mogelijk`);
      return [];
    }
    console.log(`✅ URL automatisch ontdekt voor ${domein}: ${urlTemplate}`);
  }

  const url = vulUrlIn(urlTemplate, gem, pc);
  if (!url) {
    console.log(`⚠️  Geen geldige URL voor ${domein} (${isHuur ? 'huur' : 'koop'})`);
    return [];
  }
  console.log(`🏢 Makelaar ${domein} rechtstreeks ophalen:`, url);

  try {
    // slimFetchHtml probeert eerst regulier fetch, en valt terug op Puppeteer
    // als de pagina client-side rendered is (te weinig zichtbare tekst)
    const html = await slimFetchHtml(url);
    if (!html) {
      console.warn(`Makelaarsite ophalen volledig mislukt voor ${url}`);
      return [];
    }
    console.log(`📄 ${domein} HTML: ${html.length} bytes`);

    const listings = [];

    // ── Methode 1: __NEXT_DATA__ (Next.js) ──────────────────────
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const nd = JSON.parse(nextMatch[1]);
        const pp = nd?.props?.pageProps || {};
        const results = pp.properties || pp.listings || pp.results || pp.classifieds || [];
        if (Array.isArray(results) && results.length > 0) {
          console.log(`✅ ${domein} __NEXT_DATA__: ${results.length} resultaten`);
          for (const item of results.slice(0, 25)) {
            const loc = item.location || item.address || {};
            listings.push({
              id:      item.id || item.reference,
              title:   item.title || item.name || `${item.type || ''} ${item.subtype || ''}`.trim(),
              url:     item.url || item.link || null,
              price:   item.price?.value ? `€ ${item.price.value}` : (item.price ? `€ ${item.price}` : null),
              address: [loc.street, loc.number, loc.locality || loc.city].filter(Boolean).join(' ') || null,
              bedrooms: item.bedroomCount || item.bedrooms || null,
              area:     item.surface || item.area || null,
              bron:     `${domein}_nextdata`
            });
          }
        }
      } catch (e) { console.warn(`${domein} __NEXT_DATA__ parse fout:`, e.message); }
    }

    // ── Methode 2: JSON-LD structured data ──────────────────────
    const jsonldRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
    let jm;
    while ((jm = jsonldRegex.exec(html)) !== null) {
      try {
        const ld = JSON.parse(jm[1]);
        const items = ld['@type'] === 'ItemList' ? (ld.itemListElement || []) : [ld];
        for (const item of items) {
          const thing = item.item || item;
          if (thing.url && (thing['@type'] === 'RealEstateListing' || thing.offers)) {
            listings.push({
              title:   thing.name || 'Listing',
              url:     thing.url,
              price:   thing.offers?.price ? `€ ${thing.offers.price}` : null,
              address: thing.address?.streetAddress || null,
              bron:    `${domein}_jsonld`
            });
          }
        }
      } catch (e) { /* niet elk JSON-LD blok is relevant */ }
    }

    // ── Methode 3: Regex voor listing-links ─────────────────────
    // Vang links op die eruitzien als detail-pagina's van listings
    const linkRegex = /href="((?:https?:\/\/[^"]*)?\/(?:te-huur|te-koop|huur|koop|detail|listing|property)[\/\-][^"]{5,120})"/gi;
    let lm;
    const seenUrls = new Set(listings.map(l => l.url));
    while ((lm = linkRegex.exec(html)) !== null) {
      let href = lm[1];
      if (!href.startsWith('http')) href = `https://${domein}${href}`;
      // Strip query string voor deduplicatie, maar behoud de schone URL
      const hrefZonderQuery = href.split('?')[0];
      if (!seenUrls.has(hrefZonderQuery) && hrefZonderQuery.split('/').length > 3) {
        seenUrls.add(hrefZonderQuery);
        // Gebruik de beschrijvende slug (2e-laatste segment) als titel, niet het ID-nummer.
        // Bv. /detail/te-koop-woning-lochristi/7514688 → "te koop woning lochristi"
        const urlSegmenten = hrefZonderQuery.split('/').filter(Boolean);
        const beschrijvend = urlSegmenten.slice(-2).find(s => !/^\d+$/.test(s)) || urlSegmenten[urlSegmenten.length - 1] || 'Listing';
        listings.push({ url: hrefZonderQuery, title: beschrijvend.replace(/-/g, ' '), bron: `${domein}_regex` });
      }
    }

    console.log(`🏠 ${domein}: ${listings.length} listings gevonden`);
    return listings;

  } catch (e) {
    console.warn(`Makelaarsite fetch fout voor ${domein}:`, e.message);
    return [];
  }
}

// ── Immoweb zoeken ───────────────────────────────────────────────
// Haalt listings rechtstreeks op van Immoweb (geen Google nodig).
// Probeert meerdere extractiemethodes (Next.js data, regex, etc.)
async function searchImmoweb(pandType, listingType, gemeente, postcode) {
  // Map naar Immoweb URL-slugs
  const typeMap = {
    'appartement': 'appartement', 'duplex': 'duplex', 'studio': 'studio',
    'penthouse': 'penthouse', 'loft': 'loft', 'kot': 'kot',
    'woning': 'huis', 'huis': 'huis', 'rijwoning': 'huis',
    'villa': 'huis', 'fermette': 'huis', 'herenwoning': 'huis',
    'bel-étage': 'huis', 'bungalow': 'huis', 'chalet': 'huis',
    'grond': 'grond', 'bouwgrond': 'grond',
    'handelspand': 'handelspand', 'kantoor': 'kantoor',
    'garage': 'garage', 'parkeerplaats': 'garage'
  };
  const transactieMap = { 'Te koop': 'te-koop', 'Te huur': 'te-huur' };

  const type       = typeMap[pandType?.toLowerCase()] || 'appartement';
  const transactie = transactieMap[listingType]       || 'te-huur';
  const gem        = (gemeente || 'gent').toLowerCase().replace(/\s+/g, '-');
  const pc         = postcode || '9000';

  // Probeer ook breder zoeken: als type = duplex, zoek ook appartement
  const typesToTry = [type];
  if (type === 'duplex') typesToTry.push('appartement');
  if (type === 'huis')   typesToTry.push('woning');

  const allListings = [];

  for (const t of typesToTry) {
    const url = `https://www.immoweb.be/nl/zoeken/${t}/${transactie}/${gem}/${pc}?orderBy=relevance`;
    console.log('🔍 Immoweb ophalen:', url);

    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8'
        },
        signal: AbortSignal.timeout(10000)
      });

      if (!resp.ok) {
        console.warn('Immoweb HTTP', resp.status, 'voor', url);
        continue;
      }

      const html = await resp.text();
      console.log(`📄 Immoweb HTML ontvangen: ${html.length} bytes voor ${t}`);

      // ── Methode 1: __NEXT_DATA__ (Next.js SSR) ──────────────────
      const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (nextMatch) {
        try {
          const nextData = JSON.parse(nextMatch[1]);
          // Navigeer door de Next.js data op zoek naar resultaten
          const pageProps = nextData?.props?.pageProps || {};
          const searchData =
            pageProps.searchResults?.results ||
            pageProps.results ||
            pageProps.classifieds ||
            pageProps.searchState?.results ||
            [];

          if (Array.isArray(searchData) && searchData.length > 0) {
            console.log(`✅ __NEXT_DATA__ bevat ${searchData.length} resultaten`);
            for (const item of searchData.slice(0, 20)) {
              const prop = item.property || item;
              const loc  = prop.location || {};
              const price = item.price || item.transaction?.sale?.price || item.transaction?.rental?.monthlyRentalPrice || {};
              allListings.push({
                id:        item.id || item.classified?.id || null,
                title:     item.title || item.cluster?.title || `${prop.type} ${prop.subtype || ''}`.trim(),
                url:       item.id ? `https://www.immoweb.be/nl/zoekertje/${t}/${transactie}/${gem}/${pc}/${item.id}` : null,
                price:     price.mainValue ? `€ ${price.mainValue.toLocaleString('nl-BE')}` : (price.value ? `€ ${price.value}` : null),
                type:      `${prop.type || ''} ${prop.subtype || ''}`.trim(),
                address:   [loc.street, loc.number, loc.locality].filter(Boolean).join(' ') || null,
                postcode:  loc.postalCode || null,
                bedrooms:  prop.bedroomCount || null,
                area:      prop.netHabitableSurface || prop.surface || null,
                agency:    item.customerName || null,
                bron:      'immoweb_nextdata'
              });
            }
          } else {
            console.log('⚠️ __NEXT_DATA__ gevonden maar geen resultaten-array');
            // Log de keys zodat we de structuur kunnen achterhalen
            console.log('   pageProps keys:', Object.keys(pageProps).join(', '));
          }
        } catch (e) {
          console.warn('__NEXT_DATA__ parse fout:', e.message);
        }
      }

      // ── Methode 2: iw-search JSON data ──────────────────────────
      const iwMatch = html.match(/window\.__INITIAL_SEARCH_RESULTS__\s*=\s*(\{[\s\S]*?\});/);
      if (iwMatch) {
        try {
          const iwData = JSON.parse(iwMatch[1]);
          const results = iwData.results || iwData.classifieds || [];
          console.log(`✅ __INITIAL_SEARCH_RESULTS__ bevat ${results.length} resultaten`);
          for (const item of results.slice(0, 20)) {
            allListings.push({
              id:      item.id,
              title:   item.title || `Listing ${item.id}`,
              url:     `https://www.immoweb.be/nl/zoekertje/${t}/${transactie}/${gem}/${pc}/${item.id}`,
              price:   item.price ? `€ ${item.price}` : null,
              address: item.address || item.street || null,
              bron:    'immoweb_initial_search'
            });
          }
        } catch (e) {
          console.warn('__INITIAL_SEARCH_RESULTS__ parse fout:', e.message);
        }
      }

      // ── Methode 3: Regex voor listing-URLs in de HTML ───────────
      // Vang URLs op als: /nl/zoekertje/duplex/te-huur/gent/9000/21480312
      const urlRegex = /href="(\/nl\/zoekertje\/[^"]+\/(\d{5,}))/g;
      let urlMatch;
      const seenIds = new Set(allListings.map(l => String(l.id)));
      while ((urlMatch = urlRegex.exec(html)) !== null) {
        const listingId = urlMatch[2];
        if (!seenIds.has(listingId)) {
          seenIds.add(listingId);
          // Probeer de titel te vinden nabij deze URL
          const titleRegex = new RegExp(`${listingId}[\\s\\S]{0,500}?<h2[^>]*>([^<]+)</h2>`, 'i');
          const titleMatch = html.match(titleRegex);
          allListings.push({
            id:    listingId,
            title: titleMatch?.[1]?.trim() || `Listing ${listingId}`,
            url:   `https://www.immoweb.be${urlMatch[1]}`,
            bron:  'immoweb_regex'
          });
        }
      }

      // ── Methode 4: JSON-LD structured data ──────────────────────
      const jsonldRegex = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
      let jsonldMatch;
      while ((jsonldMatch = jsonldRegex.exec(html)) !== null) {
        try {
          const ld = JSON.parse(jsonldMatch[1]);
          if (ld['@type'] === 'ItemList' && ld.itemListElement) {
            console.log(`✅ JSON-LD ItemList met ${ld.itemListElement.length} items`);
            for (const item of ld.itemListElement) {
              const thing = item.item || item;
              if (thing.url && !seenIds.has(thing.url)) {
                allListings.push({
                  title:   thing.name || thing.description || 'Listing',
                  url:     thing.url,
                  price:   thing.offers?.price ? `€ ${thing.offers.price}` : null,
                  address: thing.address?.streetAddress || null,
                  bron:    'immoweb_jsonld'
                });
              }
            }
          }
        } catch (e) { /* niet elk LD+JSON blok is relevant */ }
      }

    } catch (e) {
      console.warn('Immoweb fetch fout voor', t, ':', e.message);
    }
  }

  // Dedupliceer op ID
  const unique = [];
  const seen = new Set();
  for (const l of allListings) {
    const key = l.id || l.url;
    if (key && !seen.has(key)) { seen.add(key); unique.push(l); }
  }

  console.log(`🏠 Immoweb totaal: ${unique.length} unieke listings gevonden`);
  return unique;
}


// ── Makelaar afleiden via Immoweb op adres ───────────────────────
// Gebruikt wanneer visuele herkenning onzeker is (betrouwbaarheid LAAG).
// Zoekt Immoweb op het GPS-adres en extraheert de makelaar uit de listing.
async function ontdekMakelaarViaAdres(straat, gemeente, postcode) {
  if (!straat || !gemeente) return null;
  const gem = gemeente.toLowerCase().replace(/\s+/g, '-');
  const pc  = postcode || '9000';
  // Zoek breed: alle types te koop én te huur, sorteer op relevantie
  const urls = [
    `https://www.immoweb.be/nl/zoeken/appartement/te-koop/${gem}/${pc}?orderBy=relevance`,
    `https://www.immoweb.be/nl/zoeken/huis/te-koop/${gem}/${pc}?orderBy=relevance`,
    `https://www.immoweb.be/nl/zoeken/appartement/te-huur/${gem}/${pc}?orderBy=relevance`,
  ];
  const straatNorm = straat.toLowerCase().replace(/\s+/g, ' ').trim();

  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'nl-BE,nl;q=0.9'
        },
        signal: AbortSignal.timeout(10000)
      });
      if (!resp.ok) continue;
      const html = await resp.text();

      // Zoek __NEXT_DATA__ voor listing-data inclusief agency/makelaar
      const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!nextMatch) continue;
      const nd = JSON.parse(nextMatch[1]);
      const results = nd?.props?.pageProps?.searchResults?.results ||
                      nd?.props?.pageProps?.classifieds || [];

      for (const item of results) {
        const loc = item.property?.location || item.location || {};
        const itemStraat = (loc.street || loc.streetAddress || '').toLowerCase();
        // Controleer of straat overeenkomt
        if (itemStraat && straatNorm && itemStraat.includes(straatNorm.split(' ')[0])) {
          const agency = item.customers?.[0] || item.agency || item.customer || {};
          const naam = agency.name || agency.agencyName || null;
          if (naam) {
            console.log(`🔍 Stap 1.5: Makelaar gevonden via Immoweb-adres: "${naam}" (straat match: ${itemStraat})`);
            return { naam, via: 'immoweb_adres_match' };
          }
        }
      }
    } catch (e) {
      console.warn('ontdekMakelaarViaAdres fout:', e.message);
    }
  }
  console.log('⚠️ Stap 1.5: Geen makelaar gevonden via Immoweb-adres voor', straat, gemeente);
  return null;
}

// ── Correcties laden uit Supabase feedback-tabel ─────────────────
// Bouwt een dynamische map van "fout herkende naam" → "juiste naam"
// op basis van eerdere gebruikerscorrecties.
async function laadMakelaarCorrecties() {
  if (!supabase) return {};
  try {
    const { data, error } = await supabase
      .from('feedback')
      .select('makelaar_naam_correct')
      .not('makelaar_naam_correct', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error || !data) return {};
    // Tel hoe vaak elke naam voorkomt — meest voorkomende zijn betrouwbaarst
    const tellingen = {};
    for (const row of data) {
      const naam = row.makelaar_naam_correct.trim();
      tellingen[naam] = (tellingen[naam] || 0) + 1;
    }
    console.log(`📚 ${Object.keys(tellingen).length} gecorrigeerde makelaars geladen:`, Object.keys(tellingen));
    return tellingen;
  } catch (e) {
    console.warn('laadMakelaarCorrecties fout:', e.message);
    return {};
  }
}


// ═══════════════════════════════════════════════════════════════════
//  SYSTEM PROMPTS
// ═══════════════════════════════════════════════════════════════════

// Stap 1: Snelle foto-analyse (geen tools, geen web_search)
const PROMPT_STAP1 = `Analyseer dit makelaarsbord. Geef ENKEL deze JSON terug, niets anders:
{
  "makelaar": "naam van de makelaar",
  "makelaar_website": "domeinnaam als zichtbaar op bord (bv. janssen.be), anders null",
  "makelaar_herkenning": "hoe herkend (kleur + logo + tekst)",
  "makelaar_betrouwbaarheid": "HOOG" | "MIDDEL" | "LAAG",
  "listing_type": "Te koop" | "Te huur",
  "pand_type_slug": "duplex" | "appartement" | "huis" | "studio" | "penthouse" | "grond" | "handelspand" | "kantoor" | "garage",
  "pand_type_display": "🏠 Woning" | "🏢 Appartement" | "🏗️ Nieuwbouw" | "🏭 Commercieel" | "🌳 Grond",
  "referentienummer": "als zichtbaar op het bord, anders null",
  "telefoon": "als zichtbaar op het bord, anders null",
  "tekst_op_bord": "alle leesbare tekst op het bord letterlijk overgetypt, ook gedeeltelijk",
  "gebouw_naam": "naam van de residentie of het gebouw als zichtbaar op de gevel of het bord (bv. 'De Noordzee', 'Residentie Antwerpen'), anders null"
}

## STAP 1: LEES EERST ALLE TEKST OP HET BORD ÉN HET GEBOUW
Dit is je belangrijkste taak. Lees ALLE zichtbare tekst, ook als het bord scheef staat, gedeeltelijk zichtbaar is, of de letters klein zijn:
- De naam van de makelaar staat bijna ALTIJD op het bord in letters — lees ze letterlijk over
- Website-URL: zoek naar .be, .com, .nl, .immo achteraan een woord → dat is de website van de makelaar
- Telefoonnummer: Belgische nummers beginnen met 09xx (vast) of 04xx (mobiel)
- Referentienummer: bv. "Ref: 12345" of een code op het bord
- Gebouwnaam: kijk ook op de gevel van het gebouw zelf — residentienamen staan vaak in steen gebeiteld of op een naambord (bv. "De Noordzee", "Residentie Park"). Dit is CRUCIAAL voor het terugvinden van de listing.

## STAP 2: HERKENN VIA LOGO + KLEUR + TEKST GECOMBINEERD
Gebruik de tekst uit stap 1 als primaire bron, kleur/logo als bevestiging:

BEKENDE MAKELAARS (kleur → naam → website):
- ERA: rood + wit, "ERA" vetgedrukt blokschrift → era.be
- Trevi: rood + wit, "Trevi" cursief → trevi.be
- DeWaele: rood + wit, "Dewaele" schreefloos → dewaele.com
- Heylen: donkerblauw + wit, H-logo → heylenvastgoed.be
- Hillewaere: ORANJE + wit, H-logo → hillewaere-vastgoed.be
- Century 21: geel + zwart → century21.be
- Crevits: donkergroen + wit/goud → crevits.be
- Huysewinkel: wit + bruin H-logo → huysewinkel.be
- de Fooz: donkerblauw + goud/oranje → defooz.com
- Quares: zwart + wit → quares.be
- Engel & Völkers: groen + goud → engelvoelkers.com/be
- Sotheby's: navy + goud → sothebysrealty.be
- Carlo Eggermont: marineblauw + wit → carloeggermont.be

Onderscheid bij rood: ERA = vetgedrukt blokschrift. Trevi = cursief. DeWaele = schreefloos.
Onderscheid bij H-logo: Heylen = BLAUW. Hillewaere = ORANJE.

## STAP 3: BETROUWBAARHEID BEPALEN
- HOOG: naam letterlijk gelezen op het bord OF logo + kleur 100% duidelijk
- MIDDEL: logo/kleur herkend maar naam niet volledig leesbaar
- LAAG: onzeker, bord gedeeltelijk zichtbaar, of onbekende makelaar

Als de makelaar onbekend is maar de naam leesbaar: gebruik die naam en zet betrouwbaarheid op MIDDEL.
Zet "onbekend" ALLEEN als er werkelijk niets leesbaar is.

Geef ENKEL de JSON terug.`;

// Stap 3: Zoek en match de listing
// Twee scenario's — welk van toepassing staat bovenaan de user-message.
const PROMPT_STAP2 = `Je bent de Immo Scanner. Je analyseert een foto van een makelaarsbord en zoekt de bijhorende listing.

## ALTIJD GELDENDE REGELS
1. Geen hallucinations. Vul enkel velden in met data uit echte gevonden listings.
2. Transactie (te koop / te huur) moet kloppen met het bord.
3. Kies nooit raak. "niet_gevonden" of "gedeeltelijk" is eerlijker dan een verkeerde match.
4. Een URL van Realo of Immoscoop is BETER dan geen URL — geef die terug als je de makelaar-URL niet vindt.
5. Als het adres duidelijk overeenkomt met de GPS-locatie: wees ZEKER. Kies één prijs (meest recente/betrouwbare bron) en rapporteer die. Vermeld geen prijsverschillen tussen aggregators in de notitie — aggregators zijn soms verouderd, dat is normaal. De notitie is voor de gebruiker, geen technisch debugrapport.

## WANNEER JE WEB SEARCH GEBRUIKT (staat bovenaan je user-message)
Je hebt: Makelaar naam, makelaar website, GPS-straatnaam, gemeente en postcode.
Zoek in deze volgorde — stop zodra je een directe listing-URL hebt (niet een zoekresultatenpagina):

1. "[GPS-straatnaam]" "[gemeente]" site:[makelaarsdomein]
2. "[GPS-straatnaam]" "[gemeente]" site:realo.be
3. "[GPS-straatnaam]" "[gemeente]" site:immoscoop.be
4. "[GPS-straatnaam]" "[gemeente]" site:spotto.be
5. "[Makelaar naam]" "[GPS-straatnaam]" "[gemeente]" te koop

REDEN: aggregators zoals Realo, Immoscoop en Spotto indexeren listings van ALLE makelaars — ook kleine, slecht geïndexeerde makelaarsites. Zoek daarom altijd op meerdere aggregators als de makelaarsite niets oplevert.

ADRESREGEL: match ALTIJD op straatnaam — nooit op prijs of oppervlakte alleen.
Als een gevonden listing een ander straatadres heeft dan de GPS-straatnaam → verwerp die URL, zoek verder.

BRONREGEL — KRITIEK: prijs, oppervlakte en slaapkamers moeten van DEZELFDE pagina komen als de URL.
Voorbeeld: je vindt Rechtstraat 65A op Realo → neem prijs en kenmerken van die Realo-pagina.
Neem NOOIT een prijs van een andere zoekresultaat-pagina dan de gevonden listing-URL.

URL-REGELS:
- "url": ENKEL de URL op de website van de makelaar zelf (bv. immo-home.be, jo.immo...). Null als niet gevonden.
- "url_alternatieven": VERPLICHT — kopieer LETTERLIJK de volledige URL van de DETAIL-PAGINA van het pand op elke aggregator.
  Formaat: [{"label": "Realo", "url": "https://www.realo.be/nl/gent/rechtstraat/65a/..."}, ...]
  BELANGRIJK: gebruik NOOIT een zoekresultatenpagina als URL (herkenbaar aan /search/, /zoeken/, /resultaten/, ?q=, ?page=).
  Een geldige URL gaat naar één specifiek pand — niet naar een lijst van panden.
  Als je enkel een zoekpagina hebt en geen directe listing-URL, zet die dan NIET in url_alternatieven.
  KRITIEK: als je in de notitie een site vermeldt (Realo, Immoscoop, Spotto...) dan MOET die directe listing-URL ook in url_alternatieven staan.
  Lege array [] ENKEL als het pand werkelijk op GEEN ENKELE website als aparte listing gevonden werd.

## WANNEER JE EEN LIJST VAN LISTINGS KRIJGT
Kies de listing die het beste overeenkomt met het bord op basis van:
- GPS-straatnaam (indien vermeld bovenaan) — dit is de sterkste aanwijzing
- Pand-type en transactie (koop/huur)
- Locatie (gemeente, postcode)
- Info van het bord (referentienummer, visuele kenmerken)

Als de lijst leeg is of niets bruikbaar bevat: gebruik web_search (zie boven).

## OUTPUT — gebruik EXACT dit JSON-formaat:
{
  "status": "gevonden" | "niet_gevonden" | "gedeeltelijk",
  "makelaar": "naam",
  "makelaar_herkenning": "hoe herkend",
  "makelaar_betrouwbaarheid": "HOOG" | "MIDDEL" | "LAAG",
  "pand_type": "🏠 Woning" | "🏢 Appartement" | "🏗️ Nieuwbouw" | "🏭 Commercieel" | "🌳 Grond",
  "listing_type": "Te koop" | "Te huur",
  "adres": "adres UIT DE GEVONDEN LISTING, of null",
  "gemeente": "gemeente",
  "prijs": "€ bedrag of 'Op aanvraag' of null",
  "slaapkamers": "aantal of null",
  "oppervlakte": "m² of null",
  "staat": "Instapklaar" | "Op te frissen" | "Te renoveren" | "Nieuwbouw" | "Onbekend",
  "extras": ["garage", "tuin", "terras"],
  "url": "directe URL op de website van de makelaar zelf, of null als niet gevonden",
  "url_alternatieven": [
    {"label": "Immoscoop", "url": "https://..."},
    {"label": "Realo", "url": "https://..."}
  ],
  "telefoon": "telefoonnummer of null",
  "gevonden_via": "web_search" | "makelaar_direct" | "immoweb_fallback" | "niet_gevonden",
  "faal_categorie": null | "MAKELAAR_NIET_HERKEND" | "LISTING_NIET_ONLINE" | "ADRES_NIET_BEPAALBAAR" | "FALLBACK_OOK_LEEG" | "FOTO_ONLEESBAAR",
  "notitie": "korte uitleg voor de gebruiker — max 2 zinnen. Niet technisch. Geen prijsverschillen tussen aggregators vermelden. Alleen vermelden als iets echt ontbreekt of onzeker is."
}

Geef ENKEL de JSON terug, geen extra tekst.`;


// ═══════════════════════════════════════════════════════════════════
//  API ENDPOINTS
// ═══════════════════════════════════════════════════════════════════

// ── /api/scan ─────────────────────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  const { image, mime, gps, makelaar_override } = req.body;

  if (!image) return res.status(400).json({ error: 'Geen foto meegestuurd.' });
  if (!API_KEY) return res.status(500).json({ error: 'API key niet geconfigureerd.' });

  const startTime = Date.now();

  // ── GPS → straatnaam via Nominatim ───────────────────────────
  let geocodeResultaat = null;
  if (gps) {
    const geocodeLat = gps.property_lat || gps.lat;
    const geocodeLon = gps.property_lon || gps.lon;
    geocodeResultaat = await reverseGeocode(geocodeLat, geocodeLon);
  }

  const adresFoto = geocodeResultaat?.straat
    ? `${geocodeResultaat.straat}, ${geocodeResultaat.gemeente || ''}`.trim().replace(/,$/, '')
    : null;

  try {
    // ══════════════════════════════════════════════════════════════
    // STAP 1 — Snelle foto-analyse: wie is de makelaar + type?
    // ══════════════════════════════════════════════════════════════
    console.log('📸 STAP 1: Foto-analyse starten...');

    const stap1Resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:       'claude-sonnet-4-6',
        max_tokens:  500,
        temperature: 0,
        system:      PROMPT_STAP1,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime || 'image/jpeg', data: image } },
            { type: 'text', text: 'Analyseer dit makelaarsbord. Geef de JSON.' }
          ]
        }]
      })
    });

    if (!stap1Resp.ok) {
      const err = await stap1Resp.text();
      console.error('Stap 1 API fout:', stap1Resp.status, err);
      return res.status(502).json({ error: `Claude API fout stap 1 (${stap1Resp.status}).` });
    }

    const stap1Data = await stap1Resp.json();
    const stap1Text = stap1Data.content?.find(b => b.type === 'text')?.text || '';
    const stap1Match = stap1Text.match(/\{[\s\S]*\}/);
    if (!stap1Match) {
      console.error('Stap 1: geen JSON in response:', stap1Text);
      return res.status(500).json({ error: 'Foto-analyse mislukt. Probeer opnieuw.' });
    }

    const bordInfo = JSON.parse(stap1Match[0]);

    // Makelaar override: gebruiker heeft zelf de juiste naam opgegeven
    if (makelaar_override) {
      console.log(`🔄 Makelaar override door gebruiker: "${makelaar_override}" (was: "${bordInfo.makelaar}")`);
      bordInfo.makelaar = makelaar_override;
      bordInfo.makelaar_herkenning = `Gecorrigeerd door gebruiker naar: ${makelaar_override}`;
      bordInfo.makelaar_betrouwbaarheid = 'HOOG';
    }

    console.log('✅ STAP 1 klaar:', {
      makelaar: bordInfo.makelaar,
      betrouwbaarheid: bordInfo.makelaar_betrouwbaarheid,
      tekst: bordInfo.tekst_op_bord,
      type: bordInfo.listing_type,
      pand: bordInfo.pand_type_slug
    });

    const gemeente = geocodeResultaat?.gemeente   || 'Gent';
    const postcode = geocodeResultaat?.postcode   || '9000';
    const landcode = geocodeResultaat?.landcode   || 'BE';

    // Gebruik postcode om de officiële hoofdgemeente op te zoeken
    // Dit lost deelgemeente-problemen op voor BE, NL, DE, FR, ...
    const hoofdgemeenteViaPostcode = await gemeenteViaPostcode(postcode, landcode);
    const hoofdgemeente = hoofdgemeenteViaPostcode || geocodeResultaat?.hoofdgemeente || gemeente.toLowerCase();
    console.log(`📍 Gemeente: ${gemeente} | Postcode: ${postcode} (${landcode}) → zoekgemeente: ${hoofdgemeente}`);

    // ══════════════════════════════════════════════════════════════
    // STAP 1.5 — Extra verificatie: telefoon, correcties, adres
    // ══════════════════════════════════════════════════════════════
    const betrouwbaarheid = (bordInfo.makelaar_betrouwbaarheid || '').toUpperCase();
    const makelaarOnzeker = betrouwbaarheid === 'LAAG' || bordInfo.makelaar === 'onbekend';

    if (!makelaar_override) {

      // 1.5a: Telefoonnummer ALTIJD opzoeken als het zichtbaar is op het bord
      // — telefoonnummer is betrouwbaarder dan visuele herkenning
      const telefoon = bordInfo.telefoon;
      if (telefoon) {
        console.log(`📞 Stap 1.5a: Telefoonnummer "${telefoon}" ALTIJD opzoeken als verificatie...`);
        try {
          const telResp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type':      'application/json',
              'x-api-key':         API_KEY,
              'anthropic-version': '2023-06-01',
              'anthropic-beta':    'web-search-2025-03-05'
            },
            body: JSON.stringify({
              model:      'claude-sonnet-4-6',
              max_tokens: 1024,
              tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }],
              system: `Je bent een assistent die Belgische vastgoedmakelaars identificeert via hun telefoonnummer.
Zoek het telefoonnummer op via web search. Kijk welk bedrijf erbij hoort.
Aan het einde van je antwoord geef je ALTIJD deze JSON op een aparte lijn:
RESULTAAT: {"naam": "bedrijfsnaam", "website": "domein.be"}
Als je het niet kan vinden: RESULTAAT: {"naam": null, "website": null}`,
              messages: [{
                role: 'user',
                content: `Zoek op welke Belgische vastgoedmakelaar dit telefoonnummer heeft: ${telefoon}`
              }]
            })
          });
          if (telResp.ok) {
            const telData = await telResp.json();
            // Zoek het tekstblok op — kan na tool_use blokken staan
            const telText = telData.content?.filter(b => b.type === 'text').map(b => b.text).join('\n') || '';
            console.log(`📞 Telefoonnummer lookup response: ${telText.substring(0, 200)}`);
            // Zoek "RESULTAAT: {...}" patroon
            const telMatch = telText.match(/RESULTAAT:\s*(\{[\s\S]*?\})/);
            if (telMatch) {
              const telInfo = JSON.parse(telMatch[1]);
              if (telInfo.naam) {
                console.log(`✅ Stap 1.5a: Makelaar gevonden via telefoonnummer: "${telInfo.naam}"`);
                bordInfo.makelaar = telInfo.naam;
                if (telInfo.website) bordInfo.makelaar_website = telInfo.website;
                bordInfo.makelaar_herkenning += ` (gevonden via telefoonnummer ${telefoon})`;
                bordInfo.makelaar_betrouwbaarheid = 'HOOG';
                // Automatisch toevoegen aan Supabase als nog niet bekend
                if (telInfo.website) {
                  const domeinNieuw = telInfo.website.replace('www.', '').replace(/^https?:\/\//, '').split('/')[0];
                  voegMakelaarToeAanSupabase(domeinNieuw, telInfo.naam, null, null, telefoon);
                }
              } else {
                console.log('⚠️ Stap 1.5a: Telefoonnummer niet herkend als makelaar');
              }
            } else {
              // Fallback: zoek gewoon naar een JSON object in de tekst
              const jsonMatch = telText.match(/\{[^{}]*"naam"[^{}]*\}/);
              if (jsonMatch) {
                try {
                  const telInfo = JSON.parse(jsonMatch[0]);
                  if (telInfo.naam) {
                    console.log(`✅ Stap 1.5a (fallback): "${telInfo.naam}"`);
                    bordInfo.makelaar = telInfo.naam;
                    if (telInfo.website) bordInfo.makelaar_website = telInfo.website;
                    bordInfo.makelaar_herkenning += ` (gevonden via telefoonnummer ${telefoon})`;
                    bordInfo.makelaar_betrouwbaarheid = 'HOOG';
                    if (telInfo.website) {
                      const domeinNieuw = telInfo.website.replace('www.', '').replace(/^https?:\/\//, '').split('/')[0];
                      voegMakelaarToeAanSupabase(domeinNieuw, telInfo.naam, null, null, telefoon);
                    }
                  }
                } catch {}
              }
              console.log('⚠️ Stap 1.5b: Geen RESULTAAT-patroon gevonden in response');
            }
          } else {
            console.warn(`Stap 1.5b API fout: ${telResp.status}`);
          }
        } catch (e) {
          console.warn('Stap 1.5b telefoonnummer lookup fout:', e.message);
        }
      }

      // 1.5b: Als nog steeds onzeker — correcties uit Supabase + adres-lookup
      const betrouwbaarheidNa15a = (bordInfo.makelaar_betrouwbaarheid || '').toUpperCase();
      if (betrouwbaarheidNa15a === 'LAAG' || bordInfo.makelaar === 'onbekend') {
        console.log('🔎 Stap 1.5b: Makelaar nog steeds onzeker — correcties + adres proberen...');

        // Correcties uit Supabase
        const correcties = await laadMakelaarCorrecties();
        const makelaarLower = (bordInfo.makelaar || '').toLowerCase();
        const correctieMatch = Object.keys(correcties).find(naam =>
          naam.toLowerCase().includes(makelaarLower) || makelaarLower.includes(naam.toLowerCase())
        );
        if (correctieMatch) {
          console.log(`✅ Stap 1.5b: Eerder gecorrigeerd — gebruik "${correctieMatch}"`);
          bordInfo.makelaar = correctieMatch;
          bordInfo.makelaar_herkenning += ` (bevestigd via ${correcties[correctieMatch]}x gebruikerscorrectie)`;
          bordInfo.makelaar_betrouwbaarheid = 'MIDDEL';
        }

        // GPS adres-lookup via Immoweb
        const betrouwbaarheidNa15b = (bordInfo.makelaar_betrouwbaarheid || '').toUpperCase();
        if (geocodeResultaat?.straat && (betrouwbaarheidNa15b === 'LAAG' || bordInfo.makelaar === 'onbekend')) {
          console.log('🔎 Stap 1.5b-adres: Makelaar afleiden via Immoweb-adres...');
          const gevonden = await ontdekMakelaarViaAdres(
            geocodeResultaat.straat, hoofdgemeente, postcode
          );
          if (gevonden) {
            bordInfo.makelaar = gevonden.naam;
            bordInfo.makelaar_herkenning += ` (afgeleid via ${gevonden.via})`;
            bordInfo.makelaar_betrouwbaarheid = 'MIDDEL';
            console.log(`✅ Stap 1.5b-adres: Makelaar bijgewerkt naar "${gevonden.naam}"`);
          }
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // STAP 2 — Scenario bepalen en listings ophalen
    // ══════════════════════════════════════════════════════════════

    // ── Domein + DB-check ──────────────────────────────────────────
    // Eerst domein bepalen vanuit bordInfo, daarna opzoeken in Supabase.
    // makelaarInDB = true als we een URL-template hebben → scraping is betrouwbaarder
    // dan Google (kleine makelaars zijn slecht geïndexeerd).
    let domeinMakelaar = bordInfo.makelaar_website
      ? bordInfo.makelaar_website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
      : null;
    let makelaarInDB = false;

    const allesMakelaars = await laadMakelaarsUitSupabase();

    // Check of het bord-domein in onze DB staat
    if (domeinMakelaar) {
      const dbMatch = allesMakelaars.find(m => {
        const d = m.domein.replace('www.', '');
        return d === domeinMakelaar || d.includes(domeinMakelaar) || domeinMakelaar.includes(d);
      });
      if (dbMatch) makelaarInDB = true;
    }

    // Geen domein op bord → zoek via herkende naam
    if (!makelaarInDB && bordInfo.makelaar) {
      const naamLow = (bordInfo.makelaar || '').toLowerCase().replace(/[-\s]+/g, ' ').trim();
      const gevondenM = allesMakelaars.find(m => {
        const siteBase = m.domein.replace(/\.(be|com|nl)$/, '').replace('www.', '').toLowerCase();
        return naamLow.includes(siteBase) || siteBase.includes(naamLow.split(' ')[0]);
      });
      if (gevondenM) {
        domeinMakelaar = gevondenM.domein.replace('www.', '');
        makelaarInDB = true;
        console.log(`🔗 Domein-fallback: "${bordInfo.makelaar}" → ${domeinMakelaar} (uit Supabase)`);
      }
    }

    // ── Nieuwe makelaar automatisch opslaan ───────────────────────
    // Als de website van de makelaar bekend is (van het bord of via stap 1.5a)
    // maar nog niet in de DB staat → opslaan + koop/huur-URLs ontdekken.
    // Zo is de makelaar klaar voor de VOLGENDE scan, ook al helpt het deze scan niet.
    if (!makelaarInDB && domeinMakelaar) {
      console.log(`💾 Nieuwe makelaar ontdekt: "${bordInfo.makelaar}" (${domeinMakelaar}) — opslaan in Supabase`);
      await voegMakelaarToeAanSupabase(domeinMakelaar, bordInfo.makelaar, null, null, bordInfo.telefoon || null);
      // URL-ontdekking in de achtergrond — non-blocking, resultaat voor volgende scan
      ontdekMakelaarUrls(domeinMakelaar)
        .then(({ koopUrl, huurUrl }) => {
          if (koopUrl || huurUrl) console.log(`✅ URLs ontdekt voor ${domeinMakelaar}: koop=${koopUrl}, huur=${huurUrl}`);
        })
        .catch(e => console.warn(`URL-ontdekking achtergrond fout voor ${domeinMakelaar}:`, e.message));
    }

    // ── Scenario bepalen ───────────────────────────────────────────
    // 1. Makelaar in DB  → altijd scrapen + verrijken, GPS helpt bij matching
    // 2. Niet in DB + GPS → web_search (Claude Sonnet zoekt zelf)
    // 3. Niet in DB + geen GPS → Immoweb fallback
    const gpsStraat = geocodeResultaat?.straat || null;
    let listings = [];
    let listingsBron = 'geen';

    if (makelaarInDB) {
      // Scraping is betrouwbaarder dan Google voor kleine makelaars
      console.log(`🏢 SCRAPING: ${domeinMakelaar} in DB → scrapen${gpsStraat ? ` (GPS: "${gpsStraat}")` : ''}`);
      listings = await searchMakelaar(
        bordInfo.makelaar,
        bordInfo.listing_type,
        hoofdgemeente,
        postcode,
        bordInfo.makelaar_website
      );
      listingsBron = 'makelaar_direct';

      if (listings.length > 0) {
        // Verrijk: haal straatnamen op van detail-pagina's zodat Claude kan matchen
        listings = await verrijkListingAdressen(listings, hoofdgemeente, postcode, gpsStraat);

        // Straat-filter: als GPS een straatnaam geeft maar geen enkele listing die straat
        // heeft na verrijking → gooi de listings weg. Zo wordt Begoniastraat nooit
        // teruggegeven als de gebruiker aan de Rechtstraat staat.
        // Claude wordt dan gedwongen web_search te gebruiken (ook op aggregators).
        if (gpsStraat) {
          const straatLow = gpsStraat.toLowerCase();
          const straatMatches = listings.filter(l =>
            (l.address || '').toLowerCase().includes(straatLow)
          );
          if (straatMatches.length > 0) {
            console.log(`✅ ${straatMatches.length} listing(s) matchen GPS-straat "${gpsStraat}" → alleen die doorgeven`);
            listings = straatMatches;
          } else {
            console.log(`⚠️  Geen listing met straat "${gpsStraat}" na verrijking → listings leeggemaakt, web_search in stap 3`);
            listings = [];
            listingsBron = 'straat_geen_match';
          }
        }
      } else {
        // Scraping mislukt → Claude gebruikt web_search als noodplan in stap 3
        listingsBron = 'scraping_leeg';
        console.log('⚠️  Scraping leverde niets op → Claude gebruikt web_search in stap 3');
      }
    } else if (gpsStraat) {
      // Makelaar niet in DB maar GPS beschikbaar → Claude zoekt via web_search
      console.log(`🔍 WEB SEARCH: "${bordInfo.makelaar}" niet in DB, GPS="${gpsStraat}" → stap 3 zoekt`);
      listingsBron = 'web_search_direct';
    } else {
      // Geen DB-makelaar, geen GPS → Immoweb als fallback
      console.log('📋 IMMOWEB: geen DB-makelaar en geen GPS → Immoweb fallback');
      listings = await searchImmoweb(
        bordInfo.pand_type_slug,
        bordInfo.listing_type,
        hoofdgemeente,
        postcode
      );
      listingsBron = 'immoweb_fallback';
    }

    console.log(`✅ STAP 2 klaar: ${listings.length} listings via ${listingsBron}${makelaarInDB ? ' (makelaar in DB)' : ''}`);

    // Bouw context voor Claude op basis van scenario
    let listingsContext = '';
    const domeinHint = domeinMakelaar || (bordInfo.makelaar || '').toLowerCase().replace(/\s+/g, '') + '.be';

    // Deelgemeente-info — hier gedeclareerd zodat zowel listingsContext als locatieInfo het kunnen gebruiken
    const deelgemeente = geocodeResultaat?.gemeente || null;
    const heeftDeelgemeente = deelgemeente && hoofdgemeente &&
      deelgemeente.toLowerCase() !== hoofdgemeente.toLowerCase();

    if (listingsBron === 'web_search_direct' || listingsBron === 'scraping_leeg' || listingsBron === 'straat_geen_match') {
      // Geen bruikbare listings — Claude moet zelf zoeken via web_search
      const waarom = {
        'web_search_direct':  'Makelaar staat niet in onze database.',
        'scraping_leeg':      'Directe scraping van de makelaarssite leverde geen listings op.',
        'straat_geen_match':  `Scraping vond listings, maar geen enkele had adres "${gpsStraat}". Listing staat mogelijk niet op de overzichtspagina.`
      }[listingsBron] || '';
      listingsContext = `\n\n## WEB SEARCH VEREIST
${gpsStraat ? `GPS-straatnaam: "${gpsStraat}"` : 'Geen GPS beschikbaar.'}
Postcode: ${postcode} (dekt ${hoofdgemeente}${heeftDeelgemeente ? ` + ${deelgemeente}` : ''} en deelgemeentes)
Makelaar: ${bordInfo.makelaar} (${domeinHint})
Reden: ${waarom}

Zoek via web_search — gebruik het STRAATNAAM + POSTCODE als primaire zoekopdracht:
1. web_search: "${gpsStraat || postcode}" site:${domeinHint}
2. Niets op makelaarssite? web_search: "${gpsStraat || postcode}" "${postcode}" ${bordInfo.listing_type}
3. Controleer ALTIJD: het adres in de gevonden listing moet "${gpsStraat || postcode}" bevatten.
   Komt het adres niet overeen → gooi die URL weg en zoek verder.

URL-prioriteit: makelaar-URL (${domeinHint}) > Immoscoop/Realo/Spotto > Immoweb.
Aggregator-URL is beter dan geen URL — maar enkel als het adres klopt met de GPS-straat.\n`;
    } else if (listings.length > 0) {
      // Listings beschikbaar via scraping of Immoweb
      listingsContext = `\n\n## LISTINGS (${listings.length} resultaten — bron: ${listingsBron})\n`;
      if (gpsStraat) {
        listingsContext += `GPS-straatnaam: "${gpsStraat}" — kies de listing met dit adres.\n\n`;
      } else {
        listingsContext += '\n';
      }
      for (const l of listings.slice(0, 25)) {
        listingsContext += `- **${l.title || 'Geen titel'}**\n`;
        if (l.address)  listingsContext += `  Adres: ${l.address}\n`;
        if (l.price)    listingsContext += `  Prijs: ${l.price}\n`;
        if (l.bedrooms) listingsContext += `  Slaapkamers: ${l.bedrooms}\n`;
        if (l.area)     listingsContext += `  Oppervlakte: ${l.area} m²\n`;
        if (l.agency)   listingsContext += `  Makelaar/agency: ${l.agency}\n`;
        if (l.url)      listingsContext += `  URL: ${l.url}\n`;
        listingsContext += '\n';
      }
      if (listingsBron === 'immoweb_fallback') {
        listingsContext += `\n⚠️ IMMOWEB-FALLBACK: listings zijn van andere makelaars op Immoweb. Gebruik enkel als beste beschikbare optie.\n`;
      }
    } else {
      // Geen listings gevonden via welk pad dan ook
      listingsContext = `\n\n## GEEN LISTINGS GEVONDEN
Scraping én Immoweb leverden niets op.
${gpsStraat ? `Probeer alsnog web_search: "${gpsStraat}" site:${domeinHint}` : 'Geen GPS beschikbaar.'}
Als web_search ook niets oplevert: status "niet_gevonden", faal_categorie "SCRAPING_MISLUKT".\n`;
    }

    // Locatie info
    let locatieInfo = '';

    // Bouw een duidelijke lijst van alle geldige gemeentenamen voor deze postcode.
    // Dit voorkomt dat Claude "lochristi" vs "zaffelare" als tegenstrijdig ziet.
    const geldigeNamen = heeftDeelgemeente
      ? `${postcode} (dekt: ${hoofdgemeente}, ${deelgemeente}, en andere deelgemeentes)`
      : `${postcode} (${hoofdgemeente})`;

    if (adresFoto) {
      locatieInfo = `Locatie: ${adresFoto}${heeftDeelgemeente ? ` (deelgemeente van ${hoofdgemeente})` : ''} — postcode ${geldigeNamen}.
POSTCODEREGEL: Gebruik postcode ${postcode} als primaire locatie-identifier, niet de gemeentenaam.
Een listing met "${hoofdgemeente}" in de URL is even geldig als een listing met "${deelgemeente || hoofdgemeente}" — ze vallen allebei onder postcode ${postcode}.
Kies op basis van STRAATNAAM, niet op basis van welke gemeente-naam toevallig in de URL staat.`;
    } else if (gps) {
      locatieInfo = `GPS: ${gps.lat}°N, ${gps.lon}°O (±${gps.accuracy}m) — postcode ${geldigeNamen}.`;
    } else {
      locatieInfo = 'Geen GPS beschikbaar.';
    }

    // ══════════════════════════════════════════════════════════════
    // STAP 3 — Claude matcht de juiste listing
    // ══════════════════════════════════════════════════════════════
    console.log('🎯 STAP 3: Claude matcht listing uit', listings.length, 'kandidaten...');

    const stap3Resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 4000,
        tools: [{
          type:     'web_search_20250305',
          name:     'web_search',
          max_uses: 5    // fallback als Immoweb niets opleverde
        }],
        system: PROMPT_STAP2,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime || 'image/jpeg', data: image } },
            {
              type: 'text',
              text: `## BORDANALYSE (stap 1)
Makelaar: ${bordInfo.makelaar} (${bordInfo.makelaar_herkenning})
Betrouwbaarheid: ${bordInfo.makelaar_betrouwbaarheid}
Type: ${bordInfo.listing_type}
Pand: ${bordInfo.pand_type_slug}
Referentienummer: ${bordInfo.referentienummer || 'niet zichtbaar'}
Telefoon: ${bordInfo.telefoon || 'niet zichtbaar'}
Makelaar website: ${domeinMakelaar || bordInfo.makelaar_website || 'onbekend'}

## LOCATIE
${locatieInfo}
${listingsContext}
Geef het resultaat als JSON.`
            }
          ]
        }]
      })
    });

    const zoekduur = ((Date.now() - startTime) / 1000).toFixed(2);

    if (!stap3Resp.ok) {
      const err = await stap3Resp.text();
      console.error('Stap 3 API fout:', stap3Resp.status, err);
      return res.status(502).json({ error: `Claude API fout stap 3 (${stap3Resp.status}).` });
    }

    const stap3Data = await stap3Resp.json();

    // Zoek het laatste text-block met JSON
    let rawText = '';
    for (const block of stap3Data.content) {
      if (block.type === 'text' && block.text.includes('{')) rawText = block.text;
    }

    if (!rawText) {
      console.error('Stap 3: geen JSON in response:', JSON.stringify(stap3Data.content));
      return res.status(500).json({ error: 'Matching mislukt. Probeer opnieuw.' });
    }

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Stap 3: geen JSON-object:', rawText);
      return res.status(500).json({ error: 'Matching mislukt. Probeer opnieuw.' });
    }

    const result = JSON.parse(jsonMatch[0]);

    // ── Debug: log wat Claude exact teruggeeft voor url-velden ────
    console.log('🔍 Claude raw url:', result.url);
    console.log('🔍 Claude raw url_alternatieven:', JSON.stringify(result.url_alternatieven));
    console.log('🔍 Claude status:', result.status);

    // Vul ontbrekende velden aan vanuit stap 1
    result.makelaar              = result.makelaar || bordInfo.makelaar;
    result.makelaar_herkenning   = result.makelaar_herkenning || bordInfo.makelaar_herkenning;
    result.makelaar_betrouwbaarheid = result.makelaar_betrouwbaarheid || bordInfo.makelaar_betrouwbaarheid;
    result.telefoon              = result.telefoon || bordInfo.telefoon;

    // Normaliseer url_alternatieven: zorg dat het altijd een array is
    if (!Array.isArray(result.url_alternatieven)) result.url_alternatieven = [];

    // ── Fallback: extraheer URLs uit Claude's web_search tool resultaten ─
    // Als Claude url_alternatieven leeg liet maar wél web_search gebruikte,
    // kunnen we de gevonden URLs rechtstreeks uit de tool-results halen.
    if (result.url_alternatieven.length === 0 && gpsStraat) {
      const straatLower = gpsStraat.toLowerCase();
      const aggregatorDomeinen = [
        { domein: 'realo.be',       label: 'Realo'      },
        { domein: 'immoscoop.be',   label: 'Immoscoop'  },
        { domein: 'spotto.be',      label: 'Spotto'     },
        { domein: 'immomaps.be',    label: 'Immomaps'   },
        { domein: 'logic-immo.be',  label: 'Logic-immo' },
      ];
      const gevondenUrls = new Set();

      for (const block of stap3Data.content) {
        // Zoek in tool_result content (web_search geeft resultaten terug als JSON)
        const blockStr = JSON.stringify(block);
        for (const agg of aggregatorDomeinen) {
          // Zoek naar URLs van dit domein in de block-tekst
          const urlRegex = new RegExp(`https?://(?:www\\.)?${agg.domein.replace('.', '\\.')}[^"'\\s<>]+`, 'gi');
          let m;
          while ((m = urlRegex.exec(blockStr)) !== null) {
            const gevondenUrl = m[0].replace(/\\u[0-9a-f]{4}/gi, c =>
              String.fromCharCode(parseInt(c.slice(2), 16)));
            // Zoekpagina's uitsluiten — enkel directe listing-URLs
            const isZoekpagina = /\/search\/|\/zoeken\/|\/resultaten\/|\?q=|\?page=|\/buurt-|\/neighborhood/i.test(gevondenUrl);
            // Controleer of de URL straatnaam bevat (ruw check)
            if (!isZoekpagina && (gevondenUrl.toLowerCase().includes(straatLower.split(' ')[0]) ||
                (postcode && gevondenUrl.includes(postcode)))) {
              if (!gevondenUrls.has(agg.domein)) {
                gevondenUrls.add(agg.domein);
                result.url_alternatieven.push({ label: agg.label, url: gevondenUrl });
                console.log(`🔗 URL uit tool-result gehaald (${agg.label}): ${gevondenUrl}`);
              }
            }
          }
        }
      }
      if (result.url_alternatieven.length > 0) {
        console.log(`✅ ${result.url_alternatieven.length} alternatieve URL(s) uit web_search tool-results gerecupereerd`);
      }
    }

    // ── Adres ophalen van de listing detailpagina ────────────────
    let adresListing = null;
    if (result.url && result.status !== 'niet_gevonden') {
      adresListing = await fetchAdresVanListing(result.url);
      if (adresListing) console.log('📍 Adres van detailpagina:', adresListing);
    }

    // ── URL verificatie ──────────────────────────────────────────
    if (result.url) {
      const urlActief = await checkUrlActief(result.url);
      if (urlActief === false) {
        console.log('🚫 URL dood (404):', result.url);
        result.url = null;
        result.status = 'niet_gevonden';
        result.faal_categorie = result.faal_categorie || 'LISTING_NIET_ONLINE';
        result.notitie = 'De listing bestaat niet meer (404). Waarschijnlijk al verhuurd/verkocht. ' + (result.notitie || '');
      } else if (urlActief === null) {
        result.notitie = (result.notitie ? result.notitie + ' ' : '') +
          'Let op: de link kon niet automatisch gecontroleerd worden.';
      }
    }

    // ── Beschikbaarheidscheck ─────────────────────────────────────
    // Controleer of het pand nog beschikbaar is (niet verkocht/verhuurd/optie).
    // Doe dit ook voor url_alternatieven zodat we geen dode links tonen.
    if (result.url) {
      const nietBeschikbaar = await isNietBeschikbaar(result.url);
      if (nietBeschikbaar) {
        console.log(`🔴 Pand niet meer beschikbaar op ${result.url} — URL gewist`);
        result.url = null;
        result.status = 'niet_gevonden';
        result.faal_categorie = 'PAND_NIET_BESCHIKBAAR';
        result.notitie = 'Dit pand is niet meer beschikbaar (verkocht, verhuurd of onder optie). ' + (result.notitie || '');
      }
    }

    // Alternatieve URLs ook filteren op beschikbaarheid
    if (Array.isArray(result.url_alternatieven) && result.url_alternatieven.length > 0) {
      const beschikbaarChecks = await Promise.all(
        result.url_alternatieven.map(alt => isNietBeschikbaar(alt.url))
      );
      result.url_alternatieven = result.url_alternatieven.filter((_, i) => !beschikbaarChecks[i]);
      if (result.url_alternatieven.length === 0 && result.status === 'niet_gevonden') {
        result.notitie = result.notitie || 'Alle gevonden links wijzen op een niet meer beschikbaar pand.';
      }
    }

    // Gemeente fallback
    if (!result.gemeente && geocodeResultaat?.gemeente) result.gemeente = geocodeResultaat.gemeente;
    if (result.adres === 'Niet bepaald') result.adres = null;

    // ── GPS-straat validatie ──────────────────────────────────────
    // Als we GPS hebben en het adres van de detailpagina klopt niet →
    // URL wissen. Voorkomt dat een listing in Wachtebeke wordt getoond
    // als de gebruiker aan de Rechtstraat in Lochristi staat.
    if (gpsStraat && adresListing) {
      const straatLow  = gpsStraat.toLowerCase();
      const adresLow   = adresListing.toLowerCase();
      const straatOk   = adresLow.includes(straatLow);
      // Postcode check: als we een GPS-postcode hebben, moet die ook in het adres zitten.
      // Zo wordt b.v. "Rechtstraat 233, 9160 Eksaarde" afgewezen als GPS-postcode 9080 is.
      const postcodeOk = !postcode || adresListing.includes(postcode);
      if (!straatOk || !postcodeOk) {
        const reden = !straatOk
          ? `straat "${gpsStraat}" niet gevonden in "${adresListing}"`
          : `postcode ${postcode} komt niet overeen met "${adresListing}"`;
        console.log(`⚠️  Adres-mismatch (${reden}) → URL gewist`);
        result.url    = null;
        result.status = 'niet_gevonden';
        result.faal_categorie = result.faal_categorie || 'ADRES_MISMATCH';
        result.notitie = `Gevonden URL leidt naar "${adresListing}" maar GPS-locatie is "${gpsStraat}${postcode ? ' / ' + postcode : ''}". Mogelijk een verkeerd pand gevonden. ` + (result.notitie || '');
        adresListing = null;
      }
    }

    // ── Adres van detailpagina ook naar frontend sturen ──────────
    if (adresListing) result.adres = adresListing;

    console.log('📊 SCAN KLAAR:', {
      ts:        new Date().toISOString(),
      makelaar:  result.makelaar,
      status:    result.status,
      adres:     result.adres,
      adresFoto: adresFoto,
      listings:  `${listings.length} via ${listingsBron}`,
      faal:      result.faal_categorie,
      duur:      `${zoekduur}s`
    });

    // ── Supabase opslaan ──────────────────────────────────────────
    let scanId = null;
    if (supabase) {
      const { data: dbData, error } = await supabase.from('scans').insert({
        makelaar:                result.makelaar,
        makelaar_herkenning:     result.makelaar_herkenning,
        makelaar_betrouwbaarheid:(result.makelaar_betrouwbaarheid || '').toLowerCase() || null,
        listing_type:            result.listing_type,
        pand_type:               result.pand_type,
        adres_foto:              adresFoto,
        adres:                   adresListing || result.adres || null,
        gemeente:                result.gemeente,
        prijs:                   result.prijs,
        slaapkamers:             result.slaapkamers,
        oppervlakte:             result.oppervlakte,
        staat:                   result.staat,
        extras:                  result.extras || [],
        status:                  result.status,
        url:                     result.url,
        url_alternatieven:       result.url_alternatieven || [],
        telefoon:                result.telefoon,
        gevonden_via:            result.gevonden_via,
        faal_categorie:          result.faal_categorie,
        notitie:                 result.notitie,
        gps_beschikbaar:         !!gps,
        gps_nauwkeurigheid_m:    gps?.accuracy || null,
        zoekduur_seconden:       parseFloat(zoekduur)
      }).select('id').single();

      if (error) console.error('Supabase schrijffout:', error.message);
      else scanId = dbData?.id;
    }

    return res.json({ ...result, scan_id: scanId });

  } catch (err) {
    console.error('Server fout:', err);
    return res.status(500).json({ error: 'Server fout: ' + err.message });
  }
});

// ── /api/test-zoeken ──────────────────────────────────────────────
// Test endpoint: bekijk wat de zoekfuncties teruggeven zonder volledige scan
// Gebruik: /api/test-zoeken?makelaar=de+fooz&type=duplex&transactie=Te+huur&gemeente=gent&postcode=9000
app.get('/api/test-zoeken', async (req, res) => {
  const { makelaar, type, transactie, gemeente, postcode } = req.query;
  const gem = gemeente || 'gent';
  const pc  = postcode || '9000';
  const tr  = transactie || 'Te huur';

  const [makelaarListings, immowebListings] = await Promise.all([
    searchMakelaar(makelaar || 'de fooz', tr, gem, pc),
    searchImmoweb(type || 'duplex', tr, gem, pc)
  ]);

  res.json({
    makelaar_direct: { count: makelaarListings.length, listings: makelaarListings },
    immoweb_fallback: { count: immowebListings.length, listings: immowebListings }
  });
});

// ── /api/feedback ─────────────────────────────────────────────────
app.post('/api/feedback', async (req, res) => {
  const { scan_id, feedback_type, makelaar_correct, makelaar_naam_correct, faal_categorie_override } = req.body;
  console.log('💬 FEEDBACK:', { scan_id, feedback_type, makelaar_correct, makelaar_naam_correct });
  if (supabase && scan_id) {
    const { error } = await supabase.from('feedback').insert({
      scan_id, feedback_type,
      makelaar_correct:        makelaar_correct ?? null,
      makelaar_naam_correct:   makelaar_naam_correct || null,
      faal_categorie_override: faal_categorie_override || null
    });
    if (error) console.error('Supabase feedback fout:', error.message);
  }
  return res.json({ ok: true });
});

// ── Health check ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    api_key:   API_KEY  ? 'geladen ✅' : 'ONTBREEKT ❌',
    supabase:  supabase ? 'verbonden ✅' : 'ONTBREEKT ❌',
    timestamp: new Date().toISOString()
  });
});

// ── Start ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🏠 Immo Scanner draait op http://localhost:${PORT}`);
  console.log(`🔑 API key: ${API_KEY ? 'geladen ✅' : 'ONTBREEKT ❌'}`);
});

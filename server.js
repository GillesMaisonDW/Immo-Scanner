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
async function fetchAdresVanListing(url) {
  if (!url) return null;
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'nl-BE,nl;q=0.9,en;q=0.8'
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) return null;
    const html = await resp.text();

    // Methode 1: JSON-LD structured data (meest betrouwbaar)
    const jsonldRegex = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let jm;
    while ((jm = jsonldRegex.exec(html)) !== null) {
      try {
        const ld = JSON.parse(jm[1]);
        const addr = ld.address || ld.location?.address;
        if (addr && addr.streetAddress) {
          const straat = addr.streetAddress.trim();
          const gemeente = addr.addressLocality ? addr.addressLocality.trim() : '';
          console.log(`📍 Adres via JSON-LD: ${straat}, ${gemeente}`);
          return gemeente ? `${straat}, ${gemeente}` : straat;
        }
      } catch {}
    }

    // Methode 2: __NEXT_DATA__ (Next.js SSR)
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const nd = JSON.parse(nextMatch[1]);
        const pp = nd?.props?.pageProps || {};
        const prop = pp.property || pp.listing || pp.classified || pp.result || {};
        const loc = prop.location || prop.address || {};
        const straat = loc.street || loc.streetAddress || loc.straat || null;
        const nr = loc.number || loc.houseNumber || '';
        const gemeente = loc.locality || loc.city || loc.gemeente || '';
        if (straat) {
          const adres = [straat, nr].filter(Boolean).join(' ').trim();
          console.log(`📍 Adres via __NEXT_DATA__: ${adres}, ${gemeente}`);
          return gemeente ? `${adres}, ${gemeente}` : adres;
        }
      } catch {}
    }

    // Methode 3: Regex patronen voor veelgebruikte immo-sites
    const adresPatterns = [
      // defooz.com: "streetAddress":"Okkernootsteeg 1"
      /"streetAddress"\s*:\s*"([^"]{5,80})"/i,
      // Algemeen JSON patroon
      /"adres"\s*:\s*"([^"]{5,80})"/i,
      /"address"\s*:\s*"([^"]{5,80})"/i,
      // HTML class patronen
      /<[^>]*class="[^"]*(?:adres|address|location|locatie)[^"]*"[^>]*>\s*([A-Z][^<]{4,60})</i,
    ];
    for (const pattern of adresPatterns) {
      const match = html.match(pattern);
      if (match) {
        const adres = match[1].trim();
        console.log(`📍 Adres via regex: ${adres}`);
        return adres;
      }
    }

    console.log('⚠️ Geen adres gevonden op detailpagina:', url);
    return null;
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
    const postcode  = addr.postcode || null;
    const landcode  = addr.country_code?.toUpperCase() || 'BE';
    // Gebruik city/town als primaire gemeente (= officiële hoofdgemeente)
    // village/suburb kan een deelgemeente zijn
    const deelgemeente = addr.village || addr.suburb || null;
    const hoofdstad    = addr.city || addr.town || addr.municipality || null;

    return {
      straat:      addr.road || addr.pedestrian || addr.path || null,
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

function vulUrlIn(template, gemeente, postcode) {
  if (!template) return null;
  return template
    .replace(/\{gemeente\}/g, (gemeente || 'gent').toLowerCase())
    .replace(/\{postcode\}/g, postcode || '9000');
}

async function voegMakelaarToeAanSupabase(domein, naam, koopUrl, huurUrl) {
  if (!supabase || !domein) return;
  const { error } = await supabase.from('makelaars').upsert({
    domein, naam: naam || domein,
    koop_url: koopUrl || null,
    huur_url: huurUrl || null,
    toegevoegd_door: 'automatisch',
    bevestigd: false,
    updated_at: new Date().toISOString()
  }, { onConflict: 'domein', ignoreDuplicates: false });
  if (error) console.warn('Makelaar toevoegen mislukt:', error.message);
  else {
    console.log(`✅ Makelaar "${naam || domein}" toegevoegd/bijgewerkt in Supabase`);
    _makelaarsCacheTs = 0; // cache invalideren
  }
}

async function searchMakelaar(makelaarNaam, listingType, gemeente, postcode, makelaarWebsite) {
  const normaliseer  = (s) => (s || '').toLowerCase().replace(/[-\s]+/g, ' ').trim();
  const naamLower    = normaliseer(makelaarNaam);
  const websiteLower = (makelaarWebsite || '').toLowerCase().replace('www.', '');

  // Laad makelaars uit Supabase (gecached)
  const makelaars = await laadMakelaarsUitSupabase();

  let match = null;

  for (const m of makelaars) {
    const siteNorm   = normaliseer(m.domein.replace(/\.(be|com|nl)$/, ''));
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
  const urlTemplate = isHuur ? match.huur_url : match.koop_url;
  const gem      = gemeente?.toLowerCase() || 'gent';
  const pc       = postcode || '9000';

  const url = vulUrlIn(urlTemplate, gem, pc);
  if (!url) {
    console.log(`⚠️  Geen URL-template voor ${domein} (${isHuur ? 'huur' : 'koop'})`);
    return [];
  }
  console.log(`🏢 Makelaar ${domein} rechtstreeks ophalen:`, url);

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
      console.warn(`Makelaarsite HTTP ${resp.status} voor ${url}`);
      return [];
    }

    const html = await resp.text();
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
      if (!seenUrls.has(href) && !href.includes('?') && href.split('/').length > 4) {
        seenUrls.add(href);
        listings.push({ url: href, title: href.split('/').pop()?.replace(/-/g, ' ') || 'Listing', bron: `${domein}_regex` });
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
  "tekst_op_bord": "alle leesbare tekst op het bord letterlijk overgetypt, ook gedeeltelijk"
}

## STAP 1: LEES EERST ALLE TEKST OP HET BORD
Dit is je belangrijkste taak. Lees ALLE zichtbare tekst, ook als het bord scheef staat, gedeeltelijk zichtbaar is, of de letters klein zijn:
- De naam van de makelaar staat bijna ALTIJD op het bord in letters — lees ze letterlijk over
- Website-URL: zoek naar .be, .com, .nl achteraan een woord → dat is de website van de makelaar
- Telefoonnummer: Belgische nummers beginnen met 09xx (vast) of 04xx (mobiel)
- Referentienummer: bv. "Ref: 12345" of een code op het bord

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

// Stap 2: Match listing uit Immoweb-resultaten + web_search fallback
const PROMPT_STAP2 = `Je bent de Immo Scanner. Je hebt zojuist een makelaarsbord geanalyseerd en je krijgt nu een lijst met vastgoedlistings. Kies de listing die het best overeenkomt.

## ABSOLUTE REGELS — NOOIT OVERTREDEN
1. **GEEN hallucinations.** Vul ENKEL velden in met data die letterlijk in een gevonden listing staan.
2. **adres = ALLEEN van de gematchte listing.** Als geen listing gevonden is, is adres altijd null. Vul NOOIT het adres van een andere listing in als gok of benadering.
3. **url = ALLEEN een URL die effectief bestaat en naar de juiste listing verwijst.** Geen verzonnen URLs.
4. **"Niet gevonden" is een correct antwoord.** Wees eerlijk — een foute match is slechter dan geen match.
5. **Locatie**: het GPS-adres is waar de gebruiker stond. Het pand kan op diezelfde straat staan, of op een hoek/zijstraat. Gebruik het als zoekfilter, niet als absoluut adres.
6. **Type**: te koop vs te huur moet kloppen.
7. **Adres-match is vereist**: als een listing een ander adres heeft dan de GPS-locatie aangeeft, en er is geen duidelijke verklaring (hoek, zijstraat), kies dan liever "niet_gevonden" dan een foutieve match.

## HOE TE ZOEKEN
- Kijk eerst in de meegeleverde lijst of een listing overeenkomt met GPS-locatie + type + makelaar.
- Geen match in de lijst? Gebruik dan je web_search tool (zoek op makelaar + adres + gemeente).
- Nog steeds niets? Gebruik faal_categorie "LISTING_NIET_ONLINE" en laat adres/prijs/url op null.

## OUTPUT — gebruik EXACT dit JSON-formaat:
{
  "status": "gevonden" | "niet_gevonden" | "gedeeltelijk",
  "makelaar": "naam",
  "makelaar_herkenning": "hoe herkend",
  "makelaar_betrouwbaarheid": "HOOG" | "MIDDEL" | "LAAG",
  "pand_type": "🏠 Woning" | "🏢 Appartement" | "🏗️ Nieuwbouw" | "🏭 Commercieel" | "🌳 Grond",
  "listing_type": "Te koop" | "Te huur",
  "adres": "adres UIT DE GEVONDEN LISTING, of null als niet gevonden",
  "gemeente": "gemeente",
  "prijs": "€ bedrag of 'Op aanvraag' of null",
  "slaapkamers": "aantal of null",
  "oppervlakte": "m² of null",
  "staat": "Instapklaar" | "Op te frissen" | "Te renoveren" | "Nieuwbouw" | "Onbekend",
  "extras": ["garage", "tuin", "terras"],
  "url": "directe URL van de gevonden listing, of null",
  "telefoon": "telefoonnummer of null",
  "gevonden_via": "makelaar_direct" | "immoweb_fallback" | "web_search" | "niet_gevonden",
  "faal_categorie": null | "MAKELAAR_NIET_HERKEND" | "LISTING_NIET_ONLINE" | "ADRES_NIET_BEPAALBAAR" | "FALLBACK_OOK_LEEG" | "FOTO_ONLEESBAAR",
  "notitie": "eerlijke uitleg: wat gevonden, wat niet, en waarom"
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
        model:      'claude-sonnet-4-6',
        max_tokens: 500,
        system:     PROMPT_STAP1,
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
                  const domeinNieuw = telInfo.website.replace('www.', '').replace(/^https?:\/\//, '');
                  voegMakelaarToeAanSupabase(domeinNieuw, telInfo.naam, null, null);
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
                      const domeinNieuw = telInfo.website.replace('www.', '').replace(/^https?:\/\//, '');
                      voegMakelaarToeAanSupabase(domeinNieuw, telInfo.naam, null, null);
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
    // STAP 2 — Zoeken: makelaarsite eerst, dan Immoweb als fallback
    // ══════════════════════════════════════════════════════════════

    // 2a. Probeer eerst de makelaarsite rechtstreeks
    console.log('🏢 STAP 2a: Makelaarsite rechtstreeks doorzoeken...');
    let listings = await searchMakelaar(
      bordInfo.makelaar,
      bordInfo.listing_type,
      hoofdgemeente,
      postcode,
      bordInfo.makelaar_website
    );
    let listingsBron = 'makelaar_direct';

    // 2b. Fallback: Immoweb als makelaarsite niets opleverde
    if (listings.length === 0) {
      console.log('⚠️  Makelaarsite leeg — Immoweb als fallback...');
      listings = await searchImmoweb(
        bordInfo.pand_type_slug,
        bordInfo.listing_type,
        hoofdgemeente,
        postcode
      );
      listingsBron = 'immoweb_fallback';
    }

    console.log(`✅ STAP 2 klaar: ${listings.length} listings via ${listingsBron}`);

    // Bouw context voor Claude
    let listingsContext = '';
    if (listings.length > 0) {
      listingsContext = `\n\n## LISTINGS GEVONDEN VIA ${listingsBron.toUpperCase()} (${listings.length} resultaten)\n\n`;
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
    } else {
      listingsContext = '\n\n## GEEN LISTINGS gevonden via makelaarsite of Immoweb. Gebruik je web_search tool als laatste redmiddel.\n';
    }

    // Locatie info
    let locatieInfo = '';
    if (adresFoto) {
      locatieInfo = `Gebruiker stond bij: ${adresFoto} (GPS). Zoekgemeente: ${hoofdgemeente} (postcode ${postcode}). Let op: het pand kan op een zijstraat of hoek staan.`;
    } else if (gps) {
      locatieInfo = `GPS: ${gps.lat}°N, ${gps.lon}°O (±${gps.accuracy}m). Zoekgemeente: ${hoofdgemeente} (postcode ${postcode}).`;
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

## LOCATIE
${locatieInfo}
${listingsContext}
Kies de beste match uit de Immoweb-lijst. Als geen enkele listing past, gebruik dan web_search als fallback. Geef het resultaat als JSON.`
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

    // Vul ontbrekende velden aan vanuit stap 1
    result.makelaar              = result.makelaar || bordInfo.makelaar;
    result.makelaar_herkenning   = result.makelaar_herkenning || bordInfo.makelaar_herkenning;
    result.makelaar_betrouwbaarheid = result.makelaar_betrouwbaarheid || bordInfo.makelaar_betrouwbaarheid;
    result.telefoon              = result.telefoon || bordInfo.telefoon;

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

    // Gemeente fallback
    if (!result.gemeente && geocodeResultaat?.gemeente) result.gemeente = geocodeResultaat.gemeente;
    if (result.adres === 'Niet bepaald') result.adres = null;

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
        makelaar_betrouwbaarheid:result.makelaar_betrouwbaarheid,
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

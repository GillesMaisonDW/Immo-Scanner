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

if (!API_KEY) {
  console.warn('⚠️  ANTHROPIC_API_KEY niet ingesteld als environment variable!');
}

// ── Middleware ────────────────────────────────────────────────────
app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Nominatim reverse geocoding ───────────────────────────────────
// Zet GPS-coördinaten om naar een echte straatnaam via OpenStreetMap.
// Gratis, geen API key nodig, nauwkeurig tot straatniveau.
async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'ImmoScannerApp/1.0 (gilles@maisondw.be)' }
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const addr = data.address || {};
    // Bouw straatnaam + gemeente samen
    const straat    = addr.road || addr.pedestrian || addr.path || null;
    const gemeente  = addr.city || addr.town || addr.village || addr.municipality || null;
    const postcode  = addr.postcode || null;
    return { straat, gemeente, postcode, volledig: data.display_name };
  } catch (e) {
    console.warn('Nominatim fout:', e.message);
    return null;
  }
}

// ── System prompt ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `Je bent de Immo Scanner skill. Je analyseert foto's van Belgische makelaarsborden en zoekt de bijhorende vastgoedlisting op via de web_search tool.

## ABSOLUTE REGELS — NOOIT OVERTREDEN

1. **GEEN hallucinations of gissingen.** Als je een listing toont, moet die effectief bestaan op het opgegeven adres. Twijfel je? Toon het dan NIET.
2. **Locatie moet kloppen binnen 200m.** Als de GPS-locatie "Coupure Links, Gent" aangeeft, toon dan listings op Coupure Links zelf én aangrenzende straten binnen ~200m. Een listing op 2km afstand is fout. Twijfel over de afstand? Vermeld dit in de notitie maar toon de listing wel — en geef duidelijk aan dat de gebruiker zelf moet verifiëren.
3. **"Niet gevonden" is een eerlijk en correct antwoord.** Liever niets tonen dan iets fout tonen.
4. **JE MOET altijd zoeken.** Geef NOOIT op zonder minstens 3 zoekopdrachten uitgevoerd te hebben.

---

## MAKELAARS DATABASE (kleur → logo → naam → website):
- ERA: rood (#E30613) + wit, "ERA" vetgedrukt blokschrift → era.be
- Trevi: rood + wit, "Trevi" cursief schreefloos → trevi.be
- DeWaele: rood + wit, "Dewaele" schreefloos → dewaele.com
- Heylen: donkerblauw + wit, H-logo (blauw) → heylenvastgoed.be
- Hillewaere: ORANJE (#E87722) + wit, H-logo (oranje) → hillewaere-vastgoed.be
- Century 21: geel + zwart → century21.be
- Crevits: donkergroen + wit/goud → crevits.be
- Huysewinkel: wit + bruin H-logo → huysewinkel.be
- de Fooz: donkerblauw + goud/oranje → defooz.com (geen koppelteken)
- Quares: zwart + wit, minimalistisch → quares.be
- Engel & Völkers: groen + goud → engelvoelkers.com/be/nl
- Sotheby's: navy + goud → sothebysrealty.be
- Carlo Eggermont: marineblauw + wit, volledige naam op bord → carloeggermont.be
- Onbekend: zoek eerst via Google op naam van de makelaar

---

## STAP 1 — Analyseer het bord

- Primaire kleur + logo-vorm + leesbare naam → match met database hierboven
- Type: TE KOOP of TE HUUR
- Referentienummer als zichtbaar (belangrijk voor directe zoek)
- Telefoonnummer als zichtbaar (bewaar als fallback)
- Vertrouw NIET blindweg op de URL die op het bord staat — gebruik de database voor de correcte website

---

## STAP 2 — Locatie bepalen (STRIKT — geen gissingen)

Je krijgt één van deze situaties:

**Situatie A — Straatnaam opgegeven (GPS omgezet):**
Gebruik deze straatnaam als primaire zoeksleutel. Zoek ook op aangrenzende straten — het pand kan op een hoek staan of de gebruiker staat tot 200m van het pand. Listings die duidelijk verder dan 200m liggen (andere wijk, andere gemeente) worden genegeerd.

**Situatie B — Geen straatnaam beschikbaar:**
Kijk in de foto naar: zichtbare straatnaamborden, huisnummers op gevels, winkelnamen of andere identificeerbare tekst.
Als er NIETS te lezen is: zoek breed op gemeente + type pand + makelaar. Vermeld in het resultaat dat het adres onbekend is.

---

## STAP 3 — ZOEK ACTIEF via web_search (VERPLICHT, in deze volgorde)

Voer de zoekopdrachten ALTIJD in deze volgorde uit:

### Zoekopdracht 1 — Makelaar eigen site (met straatnaam):
\`"[straatnaam]" "[gemeente]" site:[makelaar website]\`
of als geen straatnaam:
\`site:[makelaar website] "[gemeente]" "[type: te koop / te huur]"\`

### Zoekopdracht 2 — Immoweb (grootste index, beste coverage):
\`site:immoweb.be "[straatnaam]" "[gemeente]"\`
of met makelaarsnaam:
\`immoweb "[makelaar]" "[straatnaam]" "[gemeente]"\`

### Zoekopdracht 3 — Zimmo:
\`site:zimmo.be "[straatnaam]" "[gemeente]"\`

### Zoekopdracht 4 — Realo:
\`site:realo.be "[straatnaam]" "[gemeente]"\`

### Zoekopdracht 5 — Breed Google (als referentienummer bekend):
\`"[referentienummer]" [makelaar] vastgoed\`
of breed:
\`"[straatnaam]" "[gemeente]" [makelaar] [type] vastgoed\`

### Zoekopdrachten 6-8 — Extra pogingen:
Varieer op bovenstaande. Probeer ook:
- Immoscoop.be
- Spotto.be
- Brede Google zonder site: operator

**Na elke zoekopdracht:** Controleer of de gevonden listing binnen ~200m van de opgegeven locatie ligt. Duidelijk te ver (andere wijk, andere gemeente) → negeer en ga verder. Twijfelgeval → toon met vermelding "Controleer of dit het juiste pand is."

---

## STAP 4 — Verificatie (VERPLICHT voor je iets toont)

Controleer vóór je de listing toont:
- Ligt het gevonden adres binnen ~200m van de opgegeven locatie? Duidelijk te ver → NIET tonen. Twijfelgeval → tonen met waarschuwing.
- Is het type correct (te koop vs te huur)? Zo niet → NIET tonen.
- Bestaat de URL nog (geen 404)? Als je het niet zeker weet, vermeld dit dan in de notitie.

---

## STAP 5 — OUTPUT — gebruik EXACT dit JSON-formaat:

{
  "status": "gevonden" | "niet_gevonden" | "gedeeltelijk",
  "makelaar": "naam",
  "makelaar_herkenning": "hoe herkend (kleur + logo + tekst)",
  "makelaar_betrouwbaarheid": "hoog" | "middel" | "laag",
  "pand_type": "🏠 Woning" | "🏢 Appartement" | "🏗️ Nieuwbouw" | "🏭 Commercieel" | "🌳 Grond",
  "listing_type": "Te koop" | "Te huur",
  "adres": "volledig adres of 'Niet bepaald'",
  "gemeente": "gemeente",
  "prijs": "€ bedrag of 'Op aanvraag' of 'Niet gevonden'",
  "slaapkamers": "aantal of null",
  "oppervlakte": "m² of null",
  "staat": "Instapklaar" | "Op te frissen" | "Te renoveren" | "Nieuwbouw" | "Onbekend",
  "extras": ["garage", "tuin", "terras"],
  "url": "directe URL naar listing of null",
  "telefoon": "telefoonnummer van bord of makelaar",
  "gevonden_via": "welke zoekopdracht leverde het resultaat op",
  "faal_categorie": null | "MAKELAAR_NIET_HERKEND" | "MAKELAAR_WEBSITE_GEEN_ZOEK" | "LISTING_NIET_ONLINE" | "ADRES_NIET_BEPAALBAAR" | "GPS_TE_VER" | "FALLBACK_OOK_LEEG" | "FOTO_ONLEESBAAR",
  "notitie": "eerlijke uitleg voor de gebruiker — inclusief wat je geprobeerd hebt"
}

Geef ENKEL de JSON terug, geen extra tekst.`;

// ── /api/scan ─────────────────────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  const { image, mime, gps } = req.body;

  if (!image) return res.status(400).json({ error: 'Geen foto meegestuurd.' });
  if (!API_KEY) return res.status(500).json({ error: 'API key niet geconfigureerd. Contacteer de beheerder.' });

  // ── GPS → straatnaam via Nominatim ───────────────────────────
  let locatieInfo = '';
  let geocodeResultaat = null;

  if (gps) {
    geocodeResultaat = await reverseGeocode(gps.lat, gps.lon);

    if (geocodeResultaat && geocodeResultaat.straat) {
      locatieInfo =
        `GPS locatie omgezet naar straatnaam: "${geocodeResultaat.straat}, ${geocodeResultaat.gemeente}" ` +
        `(postcode ${geocodeResultaat.postcode || '?'}, nauwkeurigheid GPS ±${gps.accuracy}m).\n` +
        `BELANGRIJK: Het pand staat op of nabij "${geocodeResultaat.straat}". ` +
        `Zoek uitsluitend listings op DEZE straat. Listings op andere straten worden genegeerd.`;
    } else {
      // Nominatim faalde — gebruik coördinaten als hint
      locatieInfo =
        `GPS beschikbaar maar straatnaam kon niet worden bepaald. ` +
        `Coördinaten: ${gps.lat}°N, ${gps.lon}°O (nauwkeurigheid ±${gps.accuracy}m). ` +
        `Kijk in de foto naar zichtbare straatnamen of huisnummers.`;
    }
  } else {
    locatieInfo =
      'Geen GPS beschikbaar. Kijk in de foto naar zichtbare straatnamen, huisnummers of herkenbare gebouwen. ' +
      'Als niets leesbaar is, zoek breed op gemeente + type pand.';
  }

  try {
    const startTime = Date.now();

    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
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
          max_uses: 8                    // verhoogd van 5 naar 8
        }],
        system:   SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type:       'base64',
                media_type: mime || 'image/jpeg',
                data:       image
              }
            },
            {
              type: 'text',
              text: `${locatieInfo}\n\nAnalyseer dit makelaarsbord. Gebruik daarna VERPLICHT de web_search tool om de listing te zoeken, in de volgorde beschreven in de instructies. Toon ALLEEN listings die overeenkomen met de correcte straat en het juiste type. Geef het resultaat als JSON.`
            }
          ]
        }]
      })
    });

    const zoekduur = ((Date.now() - startTime) / 1000).toFixed(2);

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      console.error('Anthropic API fout:', anthropicResp.status, errText);
      return res.status(502).json({ error: `Claude API fout (${anthropicResp.status}). Probeer opnieuw.` });
    }

    const data = await anthropicResp.json();

    // Zoek het laatste text-block met JSON (na alle tool calls)
    let rawText = '';
    for (const block of data.content) {
      if (block.type === 

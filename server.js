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

// ── URL verificatie ───────────────────────────────────────────────
// Controleer of een listing-URL nog actief is vóór we die tonen.
// Geeft true (actief), false (404/dood), of null (onzeker/timeout).
async function checkUrlActief(url) {
  if (!url) return null;
  try {
    const resp = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ImmoScanner/1.0)' },
      signal: AbortSignal.timeout(6000)
    });
    // 404, 410 = zeker dood | 200-399 = actief
    if (resp.status === 404 || resp.status === 410) return false;
    if (resp.status >= 200 && resp.status < 400) return true;
    return null; // andere statuscodes: onzeker
  } catch (e) {
    console.warn('URL check mislukt voor', url, '—', e.message);
    return null; // timeout of geblokkeerd: onzeker, niet uitsluiten
  }
}

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

1. **GEEN hallucinations of gissingen.** Als je een listing toont, moet die effectief bestaan. Twijfel je? Toon het dan NIET.
2. **Controleer of de listing nog actief is.** Kijk in het Google-zoekresultaat naar woorden als "verkocht", "verhuurd", "niet meer beschikbaar", "sold", "loué", "this property is no longer available". Staat dat er? → URL niet meegeven, status = niet_gevonden, faal_categorie = LISTING_NIET_ONLINE.
3. **Locatie moet kloppen binnen 200m.** Als de GPS-locatie "Coupure Links, Gent" aangeeft, toon dan listings op Coupure Links zelf én aangrenzende straten binnen ~200m. Een listing op 2km afstand is fout. Twijfel over de afstand? Vermeld dit in de notitie maar toon de listing wel — en geef duidelijk aan dat de gebruiker zelf moet verifiëren.
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
Deze straatnaam is waar de GEBRUIKER staat, niet noodzakelijk het adres van het pand. Gebruik de straatnaam NIET als zoekfilter — een hoekpand staat geregistreerd op de zijstraat. Gebruik de straatnaam alleen achteraf om uit gevonden kandidaten de meest nabije te kiezen. Zoek eerst breed op makelaar + type + gemeente (zie Stap 3).

**Situatie B — Geen straatnaam beschikbaar:**
Kijk in de foto naar: zichtbare straatnaamborden, huisnummers op gevels, winkelnamen of andere identificeerbare tekst.
Als er NIETS te lezen is: zoek breed op gemeente + type pand + makelaar. Vermeld in het resultaat dat het adres onbekend is.

---

## STAP 3 — ZOEK ACTIEF via web_search (VERPLICHT, in deze volgorde)

**KRITIEKE REGEL: Zoek NOOIT op straatnaam in de eerste zoekopdrachten.**
Een pand op een hoek staat geregistreerd op de ZIJSTRAAT, niet op de straat waar jij staat. De straatnaam gebruik je alleen achteraf om kandidaten te vergelijken, nooit als zoekfilter.

Voer zoekopdrachten uit in deze volgorde:

### Zoekopdracht 1 — Makelaar eigen site, breed (GEEN straatnaam):
\`site:[makelaar website] [gemeente] [type: "te huur" of "te koop"]\`
Voorbeeld: \`site:defooz.com gent "te huur"\`
→ Dit geeft alle actuele listings van die makelaar in die stad.

### Zoekopdracht 2 — Immoweb met makelaar en type (GEEN straatnaam):
\`site:immoweb.be [makelaar] [gemeente] [type]\`
Voorbeeld: \`site:immoweb.be "de fooz" gent "te huur"\`
of: \`immoweb [makelaar] [gemeente] [type] [pand_type]\`
Voorbeeld: \`immoweb "de fooz" gent duplex huur\`

### Zoekopdracht 3 — Zimmo breed:
\`site:zimmo.be [gemeente] [type] [pand_type]\`

### Zoekopdracht 4 — Realo breed:
\`site:realo.be [gemeente] [makelaar] [type]\`

### Zoekopdracht 5 — Referentienummer (als zichtbaar op het bord):
\`"[referentienummer]" [makelaar]\`
→ Een referentienummer is uniek en vindt direct de juiste listing.

### Zoekopdrachten 6-8 — Variaties:
- Immoscoop.be, Spotto.be
- Brede Google: \`[makelaar] [gemeente] [type] [pand_type] vastgoed\`
- Met straatnaam als EXTRA filter op al gevonden kandidaten

**Na elke zoekopdracht: selecteer kandidaten op basis van GPS-afstand, NIET op straatnaam.**
In historische stadscentra (zoals Gent) liggen Veldstraat, Lange Veldstraat en Okkernootsteeg letterlijk naast elkaar maar hebben totaal verschillende namen. Straatnaam-overeenkomst zegt niets over nabijheid.
Gebruik uitsluitend de GPS-coördinaten of de gemeente als filter:
→ Zelfde gemeente + plausibel type + zelfde makelaar = geldige kandidaat
→ Meerdere kandidaten? Toon ze allemaal, gesorteerd op waarschijnlijkheid.
→ Geen enkele kandidaat in de gemeente? Ga verder met de volgende zoekopdracht.

---

## STAP 4 — Kies de beste match uit de kandidaten

Na het zoeken heb je mogelijk meerdere listings. Kies op basis van:
1. **Afstand tot GPS-locatie**: welke listing ligt het dichtst bij de opgegeven straat/locatie? (ook zijstraten tellen mee — hoekpanden staan op de zijstraat)
2. **Type overeenkomst**: te koop vs te huur correct?
3. **Visuele architectuur**: als de foto het gebouw toont, klopt de gevel/bouwstijl met de listing-foto's?

Toon de beste match. Als meerdere even waarschijnlijk zijn, toon ze allebei met een korte omschrijving zodat de gebruiker zelf kan kiezen.

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
    // Gebruik pand-GPS als de frontend die berekend heeft (GPS + kompasrichting),
    // anders val terug op de gebruiker-GPS
    const geocodeLat = gps.property_lat || gps.lat;
    const geocodeLon = gps.property_lon || gps.lon;
    geocodeResultaat = await reverseGeocode(geocodeLat, geocodeLon);

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
      if (block.type === 'text' && block.text.includes('{')) {
        rawText = block.text;
      }
    }

    if (!rawText) {
      console.error('Geen JSON gevonden in Claude response:', JSON.stringify(data.content));
      return res.status(500).json({ error: 'Onverwachte respons van Claude. Probeer opnieuw.' });
    }

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Geen JSON-object in tekst:', rawText);
      return res.status(500).json({ error: 'Onverwachte respons van Claude. Probeer opnieuw.' });
    }

    const result = JSON.parse(jsonMatch[0]);

    // ── URL verificatie ──────────────────────────────────────────
    // Controleer of de gevonden listing-URL nog bestaat vóór we die tonen.
    if (result.url) {
      const urlActief = await checkUrlActief(result.url);
      if (urlActief === false) {
        console.log('🚫 URL dood (404):', result.url);
        result.url = null;
        result.status = 'niet_gevonden';
        result.faal_categorie = result.faal_categorie || 'LISTING_NIET_ONLINE';
        result.notitie = 'De listing werd gevonden in Google maar bestaat niet meer op de website (404). ' +
          'Het pand is waarschijnlijk al verhuurd of verkocht. ' + (result.notitie || '');
      } else if (urlActief === null) {
        // Onzeker (timeout of geblokkeerd) — toon wel maar met waarschuwing
        result.notitie = (result.notitie ? result.notitie + ' ' : '') +
          'Let op: de link kon niet automatisch gecontroleerd worden — verifieer zelf of de listing nog actief is.';
      }
      // urlActief === true → alles ok, niets aanpassen
    }

    // ── Adres foto (locatie gebruiker) ───────────────────────────
    // Dit is NIET het adres van het pand, maar waar de gebruiker stond.
    // Komt altijd uit Nominatim (GPS-locatie van de gebruiker/camera).
    const adresFoto = geocodeResultaat?.straat
      ? `${geocodeResultaat.straat}, ${geocodeResultaat.gemeente || ''}`.trim().replace(/,$/, '')
      : null;

    // Gemeente fallback: als Claude geen gemeente teruggeeft, gebruik Nominatim
    if (!result.gemeente && geocodeResultaat?.gemeente) {
      result.gemeente = geocodeResultaat.gemeente;
    }

    // adres in result = het effectieve pandadres uit de listing (gevonden via zoekfunctie)
    // Dat laten we leeg als Claude het niet gevonden heeft — adres_foto is de fallback voor de gebruiker
    if (result.adres === 'Niet bepaald') result.adres = null;

    console.log('📊 SCAN:', {
      ts:        new Date().toISOString(),
      makelaar:  result.makelaar,
      status:    result.status,
      adres:     result.adres,
      straat:    geocodeResultaat?.straat || 'n/a',
      bearing:   gps?.bearing != null ? `${Math.round(gps.bearing)}°` : 'n/a',
      pand_gps:  gps?.property_lat ? `${gps.property_lat},${gps.property_lon}` : 'n/a',
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
        adres:                   result.adres || null,
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

// ── /api/feedback ─────────────────────────────────────────────────
app.post('/api/feedback', async (req, res) => {
  const { scan_id, feedback_type, makelaar_correct, faal_categorie_override } = req.body;

  console.log('💬 FEEDBACK:', { scan_id, feedback_type, makelaar_correct });

  if (supabase && scan_id) {
    const { error } = await supabase.from('feedback').insert({
      scan_id,
      feedback_type,
      makelaar_correct:        makelaar_correct ?? null,
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

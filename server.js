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

// ── System prompt ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `Je bent de Immo Scanner skill. Je analyseert foto's van Belgische makelaarsborden en zoekt de bijhorende vastgoedlisting op via de web_search tool.

## KRITIEKE REGEL: JE MOET ALTIJD ZOEKEN
Je hebt toegang tot de web_search tool. Je MOET deze gebruiken om de listing te vinden. Geef NOOIT op zonder minstens 2 zoekopdrachten uitgevoerd te hebben. "Niet gevonden" is enkel toegestaan als je effectief hebt gezocht en niets passends terugkwam.

## MAKELAARS DATABASE (kleur → logo → naam → website):
- ERA: rood (#E30613) + wit, "ERA" vetgedrukt → era.be
- Trevi: rood + wit, "Trevi" cursief → trevi.be
- DeWaele: rood + wit, "Dewaele" schreefloos → dewaele.com
- Heylen: donkerblauw + wit, H-logo → heylenvastgoed.be
- Hillewaere: ORANJE (#E87722) + wit, H-logo → hillewaere-vastgoed.be
- Century 21: geel + zwart → century21.be
- Crevits: donkergroen + wit/goud → crevits.be
- Engel & Völkers: groen + goud, premium → engelvoelkers.com/be
- de Fooz: donkerblauw + oranje/goud accenten → defooz.com (GEEN koppelteken)
- Quares: zwart + wit, minimalistisch → quares.be
- Sotheby's: navy + goud → sothebysrealty.be
- Onbekend: zoek eerst via Google op naam

## STAP 1 — Analyseer het bord:
- Primaire kleur + logo-vorm + leesbare naam
- Type: TE KOOP of TE HUUR
- Telefoonnummer of referentienummer als zichtbaar
- Gebruik de MAKELAARS DATABASE om de website te bepalen — vertrouw NIET op wat je op het bord leest voor de URL (borden bevatten soms www. met koppeltekens of typfouten)

## STAP 2 — Locatie bepalen:
- GPS = locatie GEBRUIKER, niet pand. Het pand staat tot 200m verderop.
- Gebruik GPS-coördinaten DIRECT in je zoekopdracht, verzin GEEN buurt- of straatnamen.
- Kijk ook naar zichtbare straatnamen, huisnummers of omgeving in de foto zelf.

## STAP 3 — ZOEK ACTIEF via web_search (VERPLICHT):
Voer de zoekopdrachten in deze volgorde uit:

1. Zoek op de makelaarwebsite + gemeente:
   → "[makelaar] te huur Gent" of "site:[website] te huur Gent"

2. Als GPS beschikbaar: zoek op coördinaten of nabijgelegen straten:
   → "[makelaar] te huur [straat zichtbaar in foto] Gent"

3. Als nog niet gevonden: zoek breder via Google:
   → "[makelaar] [type] [gemeente] te huur listing"

4. Fallback: zoek op Immoweb, Zimmo of Immoscoop:
   → "immoweb.be [makelaar] [gemeente] te huur"

Analyseer de zoekresultaten en identificeer de listing die overeenkomt met de locatie en het type pand op de foto.

## STAP 4 — Visuele verificatie (als foto beschikbaar in resultaten):
Als de makelaarwebsite een foto van de gevel toont in de zoekresultaten, vergelijk dit visueel met de foto van het bord. Een overeenkomende gevel = sterke bevestiging.

## OUTPUT — gebruik EXACT dit JSON-formaat:
{
  "status": "gevonden" | "niet_gevonden" | "gedeeltelijk",
  "makelaar": "naam",
  "makelaar_herkenning": "hoe herkend",
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
  "telefoon": "telefoonnummer of null",
  "gevonden_via": "beschrijf welke zoekopdracht het resultaat opleverde",
  "faal_categorie": null | "MAKELAAR_NIET_HERKEND" | "MAKELAAR_WEBSITE_GEEN_ZOEK" | "LISTING_NIET_ONLINE" | "ADRES_NIET_BEPAALBAAR" | "GPS_TE_VER" | "FALLBACK_OOK_LEEG" | "FOTO_ONLEESBAAR",
  "notitie": "korte uitleg voor de gebruiker"
}
Geef ENKEL de JSON terug, geen extra tekst.`;

// ── /api/scan ─────────────────────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  const { image, mime, gps } = req.body;

  if (!image) return res.status(400).json({ error: 'Geen foto meegestuurd.' });
  if (!API_KEY) return res.status(500).json({ error: 'API key niet geconfigureerd. Contacteer de beheerder.' });

  const gpsInfo = gps
    ? `GPS locatie gebruiker: ${gps.lat}°N, ${gps.lon}°O (nauwkeurigheid ±${gps.accuracy}m). Dit is de locatie van de GEBRUIKER. Het gescande pand staat ergens in een straal van 100–200m hieromheen. Gebruik deze coördinaten letterlijk in je zoekopdrachten, verzin geen buurt- of straatnamen.`
    : 'Geen GPS beschikbaar. Werk met visuele analyse: zoek naar zichtbare straatnamen, huisnummers of herkenbare gebouwen in de foto.';

  try {
    const startTime = Date.now();

    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'web-search-2025-03-05'   // ← web search ingeschakeld
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 3000,                              // meer ruimte voor tool calls
        tools: [{
          type:     'web_search_20250305',
          name:     'web_search',
          max_uses: 5                                  // max 5 zoekopdrachten per scan
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
              text: `${gpsInfo}\n\nAnalyseer dit makelaarsbord. Gebruik daarna VERPLICHT de web_search tool om de listing te zoeken op de website van de makelaar. Geef het resultaat als JSON.`
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

    console.log('📊 SCAN:', {
      ts:       new Date().toISOString(),
      makelaar: result.makelaar,
      status:   result.status,
      adres:    result.adres,
      faal:     result.faal_categorie,
      duur:     `${zoekduur}s`
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
        adres:                   result.adres,
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

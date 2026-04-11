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
app.use(express.json({ limit: '25mb' }));          // grote foto's toestaan
app.use(express.static(path.join(__dirname, 'public')));

// ── System prompt voor de Immo Scanner skill ──────────────────────
const SYSTEM_PROMPT = `Je bent de Immo Scanner skill. Je analyseert foto's van Belgische makelaarsborden en zoekt de bijhorende vastgoedlisting op.

## MAKELAARS DATABASE (gebruik kleur → logo → naam):
- ERA: rood (#E30613) + wit, "ERA" in vetgedrukt blokschrift → site:era.be
- Trevi: rood + wit, "Trevi" cursief → site:trevi.be
- DeWaele: rood + wit, "Dewaele" schreefloos → site:dewaele.com
- Axel Lenaerts: rood + wit, klassiek serif lettertype → site:axellenaerts.be
- Heylen: donkerblauw + wit, H-logo of "Heylen" → site:heylenvastgoed.be (BLAUW = Heylen)
- Hillewaere: ORANJE (#E87722) + wit, H-logo → site:hillewaere-vastgoed.be (ORANJE = Hillewaere)
- Century 21: geel + zwart → site:century21.be
- Crevits: donkergroen + wit/goud → site:crevits.be
- Engel & Völkers: groen + wit/goud, premium → site:engelvoelkers.com/be
- Huysewinkel: wit bord + bruin/terracotta geometrische H → site:huysewinkel.be
- Carlo Eggermont: marineblauw + wit, volledige naam → site:carloeggermont.be
- de Fooz: donker + goud, klassiek serif → site:defooz.com
- Quares: zwart + wit, minimalistisch → site:quares.be
- Sotheby's: zwart/navy + goud, "S" embleem → site:sothebysrealty.be
- Onbekende makelaar: zoek eerst via Google op naam, daarna fallback Immoweb

## GEDRAGSREGELS:
1. Werk MAXIMAAL zelfstandig — stel NOOIT vragen
2. GPS = locatie GEBRUIKER, niet pand. Zoek in straal van 100m eromheen
3. Kanaal of brede straat ertussen → vergroot straal naar 200m
4. Toon NOOIT een URL zonder te vermelden dat je ze gevonden hebt via websearch
5. Meld altijd via welke zoekmethode je iets gevonden hebt

## STAP 1 — Analyseer het bord:
- Primaire kleur van het bord
- Logo-vorm en lettertype
- Naam van de makelaar als leesbaar
- Type listing: TE KOOP of TE HUUR
- Referentienummer als zichtbaar
- Telefoonnummer als zichtbaar

## STAP 2 — Locatie bepalen:
- Gebruik GPS als middelpunt van zoekstraal (100–200m)
- Kijk naar zichtbare straatnamen in de foto
- Adres op het bord zelf

## STAP 3 — Zoek de listing:
Gebruik Google site:-zoekopdrachten. Formuleer de logica en geef het beste resultaat op basis van je kennis.

## OUTPUT — gebruik EXACT dit JSON-formaat:
{
  "status": "gevonden" | "niet_gevonden" | "gedeeltelijk",
  "makelaar": "naam",
  "makelaar_herkenning": "hoe herkend (kleur/logo/naam)",
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
  "gevonden_via": "makelaar website / Immoweb / etc.",
  "faal_categorie": null | "MAKELAAR_NIET_HERKEND" | "MAKELAAR_WEBSITE_GEEN_ZOEK" | "LISTING_NIET_ONLINE" | "ADRES_NIET_BEPAALBAAR" | "GPS_TE_VER" | "FALLBACK_OOK_LEEG" | "FOTO_ONLEESBAAR",
  "notitie": "korte uitleg voor de gebruiker"
}
Geef ENKEL de JSON terug, geen extra tekst.`;

// ── /api/scan — hoofdendpoint ─────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  const { image, mime, gps } = req.body;

  if (!image) {
    return res.status(400).json({ error: 'Geen foto meegestuurd.' });
  }
  if (!API_KEY) {
    return res.status(500).json({ error: 'API key niet geconfigureerd op de server. Contacteer de beheerder.' });
  }

  const gpsInfo = gps
    ? `GPS locatie gebruiker: ${gps.lat}°N, ${gps.lon}°O (nauwkeurigheid ±${gps.accuracy}m). Gebruik dit als MIDDELPUNT van een zoekstraal van 100m — niet als exact adres van het pand.`
    : 'Geen GPS beschikbaar. Werk met visuele analyse en eventuele straatnamen in de foto.';

  try {
    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1200,
        system:     SYSTEM_PROMPT,
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
              text: `${gpsInfo}\n\nAnalyseer dit makelaarsbord en zoek de listing op.`
            }
          ]
        }]
      })
    });

    if (!anthropicResp.ok) {
      const errText = await anthropicResp.text();
      console.error('Anthropic API fout:', anthropicResp.status, errText);
      return res.status(502).json({ error: `Claude API fout (${anthropicResp.status}). Probeer opnieuw.` });
    }

    const data    = await anthropicResp.json();
    const rawText = data.content[0].text;

    // Parse JSON uit de respons
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Geen JSON in Claude response:', rawText);
      return res.status(500).json({ error: 'Onverwachte respons van Claude. Probeer opnieuw.' });
    }

    const result = JSON.parse(jsonMatch[0]);

    // Log naar console
    console.log('📊 SCAN:', {
      ts:       new Date().toISOString(),
      makelaar: result.makelaar,
      status:   result.status,
      gemeente: result.gemeente,
      faal:     result.faal_categorie
    });

    // ── Opslaan in Supabase ──────────────────────────────────────
    let scanId = null;
    if (supabase) {
      const { data, error } = await supabase.from('scans').insert({
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
        gps_nauwkeurigheid_m:    gps?.accuracy || null
      }).select('id').single();

      if (error) console.error('Supabase schrijffout:', error.message);
      else scanId = data?.id;
    }

    return res.json({ ...result, scan_id: scanId });

  } catch (err) {
    console.error('Server fout:', err);
    return res.status(500).json({ error: 'Server fout: ' + err.message });
  }
});

// ── /api/feedback — feedback opslaan ─────────────────────────────
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

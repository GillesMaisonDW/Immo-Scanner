# Immo Scanner — Deployen op Render.com

Volg deze stappen om de app live te zetten met een echte URL.
Duurt ±15 minuten. Geen technische kennis nodig.

---

## Wat je nodig hebt

- Een GitHub account (gratis) → github.com
- Een Render account (gratis) → render.com
- Je Claude API key → console.anthropic.com

---

## STAP 1 — Maak een GitHub repository aan

1. Ga naar **github.com** en log in (of maak een gratis account)
2. Klik rechtsboven op **"+"** → **"New repository"**
3. Geef het een naam: `immo-scanner`
4. Zet op **Private** (alleen jij kan het zien)
5. Klik **"Create repository"**

---

## STAP 2 — Upload de bestanden

Op de pagina van je nieuwe repository:

1. Klik op **"uploading an existing file"**
2. Sleep deze 3 bestanden/mappen naar het venster:
   - `server.js`
   - `package.json`
   - De map `public/` (met `index.html` erin)
3. Klik **"Commit changes"**

---

## STAP 3 — Maak een Render account aan

1. Ga naar **render.com**
2. Klik **"Get Started for Free"**
3. Kies **"Continue with GitHub"** → geef toegang
4. Bevestig je e-mailadres als gevraagd

---

## STAP 4 — Maak een nieuwe Web Service aan

1. Klik in Render op **"New +"** → **"Web Service"**
2. Kies **"Connect a repository"**
3. Selecteer je `immo-scanner` repository
4. Vul in:
   - **Name:** `immo-scanner`
   - **Region:** Frankfurt (EU) — dichtstbijzijnd
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
5. **Instance Type:** kies **Free**
6. Klik nog NIET op Deploy — ga eerst naar stap 5

---

## STAP 5 — Voeg je sleutels toe (geheim!)

Scroll naar beneden op dezelfde pagina naar **"Environment Variables"**.
Voeg deze 2 variabelen toe (klik telkens op "Add Environment Variable"):

| Key | Value |
|-----|-------|
| `ANTHROPIC_API_KEY` | jouw Claude API key (begint met `sk-ant-...`) |
| `SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVzbnBlZWd1bGhiY3lqbnZzemFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5MDkyODUsImV4cCI6MjA5MTQ4NTI4NX0.yavKssUHJClTjyfWPfxETHBe2-89maJcZxq6rcdna2A` |

De SUPABASE_URL staat al ingebakken in de code — die hoef je niet apart in te vullen.

---

## STAP 6 — Deploy!

1. Klik **"Create Web Service"**
2. Render installeert alles automatisch (duurt 2-3 minuten)
3. Je ziet logs verschijnen — wacht op: `🏠 Immo Scanner draait op poort ...`
4. Bovenaan zie je jouw URL: `https://immo-scanner-xxxx.onrender.com`

**Die URL deel je met je testers. Geen installatie, geen API key — gewoon openen en scannen.**

---

## Controleren of het werkt

Ga naar: `https://jouw-url.onrender.com/health`

Je moet dit zien:
```json
{
  "status": "ok",
  "api_key": "geladen ✅",
  "timestamp": "2026-04-11T..."
}
```

Als `api_key` ❌ toont: ga naar Render → je service → Environment → controleer de variabele.

---

## Belangrijke noot: gratis tier

Op het gratis plan van Render slaapt de server na 15 minuten inactiviteit.
De eerste scan na een lange pauze duurt dan 30-60 seconden (wake-up time).
Voor een betaald plan ($7/maand) blijft de server altijd wakker.
Voor prototype-testen is gratis prima.

---

## Updates uitrollen

Heb je een aanpassing gemaakt aan de bestanden?
1. Upload de gewijzigde bestanden opnieuw op GitHub (zelfde stap 2)
2. Render detecteert dit automatisch en herstart de server

---

## Vragen?

Contacteer Gilles of open een nieuwe sessie met Claude voor hulp.

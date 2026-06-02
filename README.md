# PM-MILAP

**PM Mission for Integrated Livelihood, Aspiration & Placement Portal**

A LinkedIn-style professional networking and AI skill-matching portal for beneficiaries of India's **PM VIKAS** skilling scheme. PM-MILAP turns every government training record into a verified professional profile, then uses an LLM-backed matching engine to connect certified trainees with employers, recruiters, training institutes and overseas placement agents.

Built to run entirely on **localhost** with Node.js, Express and the built-in SQLite engine — no native compilation, no external database, no build step.

---

## Quick start

```bash
# 1. Install dependencies (pure-JS only: express, jsonwebtoken, bcryptjs, sql.js)
npm install

# 2. Start the server (auto-creates + seeds the SQLite database on first run)
npm start

# 3. Open the portal
#    http://localhost:3000
```

That's it. The first launch creates `data/pm-milap.sqlite`, seeds every role with realistic demo data, runs an initial matching pass, and starts a background matching scheduler.

### Other commands

```bash
npm run seed            # (re)seed without wiping — idempotent, skips if data exists
node src/seed.js --reset    # wipe and rebuild the database from scratch
node src/seed.js --reset --llm   # rebuild and use the live LLM for resumes/bios (if reachable)
npm run dev             # start with --watch for auto-restart during development
```

---

## Demo logins

All accounts use the password **`demo1234`**.

| Role | Email | What you'll see |
|------|-------|-----------------|
| **Beneficiary / Trainee** | `ramesh.yadav@pmvikas.demo` | Auto-generated profile, AI resume, verified certificate, job & overseas matches, upskilling nudges |
| Beneficiary (alt) | `mohammed.arif@pmvikas.demo` | A second trainee with a different trade & match set |
| **Employer** | `hr@bharatfab.com` | Talent-pool search, post vacancies, per-vacancy candidate matches |
| **Recruiter** | `feed@nationaljobsfeed.in` | Same tools as an employer, postings tagged as a recruiter feed |
| **Overseas Agent** | `gulf@skybridge-overseas.com` | Overseas opportunities + candidates open to working abroad |
| **Training Institute** | `rajasthan.iti@pmmilap.gov.in` | Alumni outcomes table, placement & match stats |
| Institute (alt) | `kerala.academy@pmmilap.gov.in` | A second institute's cohort |
| **Govt. Admin** | `admin@pmmilap.gov.in` | Scheme-wide analytics, data ingestion, stakeholder moderation, certificate management |

The login screen has one-tap demo buttons for each role, so you don't need to type these.

### Public pages (no login required)
- **Certificate verification** — `http://localhost:3000/#/verify` (try ID `PMV-WLD-2025-RAXZG5`)
- **Shareable profile** — `http://localhost:3000/#/profile/1`

---

## What's inside

### Core features
- **AI Assistant (floating chatbot)** — the saffron bubble at the bottom-right opens a streaming assistant that is *grounded in the logged-in user's real data*. It answers questions ("what are my best matches?", "top skill gaps?"), and can take in-app actions (navigate, search the talent pool, run the matching engine). Each reply shows whether it came from the live **AI model** or the **deterministic fallback**, and a "Show the prompt" toggle reveals the exact system+user messages sent to the model — useful for teaching how LLM integration actually works (context-grounding + streaming + tool/actions + graceful fallback).
- **Automatic profile generation** — a simulated government training-DB feed (`data/mock_training_records.json`) is ingested into full beneficiary profiles, each with an AI-written headline, bio and Markdown resume.
- **Verified certificates** — every trainee gets a tamper-evident certificate with a unique verification ID (format `PMV-{TRADE}-{YEAR}-{6CHAR}`) and a public lookup page.
- **AI matching engine** — a heuristic scorer pre-filters candidate↔opportunity pairs, then the LLM refines the strongest ones with a natural-language reason. Runs on post, on ingest, and on a background timer.
- **Real-time nudges** — in-app notification centre with an unread bell badge; architecture is extensible to SMS / email / WhatsApp.
- **Talent pool** — searchable, filterable directory (trade, state, skill, availability, overseas-willing, relocate).
- **Admin analytics** — placements-over-time, match-to-placement funnel, demand-vs-supply skill gaps, and regional availability, all rendered with Chart.js.
- **Mobile-first, multilingual-ready UI** — responsive layout (sidebar → bottom tab bar), English / हिंदी toggle wired throughout.

### Tech stack
- **Runtime:** Node.js (works on **Node 18, 20 and 22+**) + Express
- **Database:** SQLite with **zero native compilation** — on Node 22.5+ it uses the fast built-in `node:sqlite`; on older Node it transparently falls back to `sql.js` (SQLite compiled to WebAssembly, pure JS). Same `.sqlite` file either way; nothing for you to configure.
- **Auth:** JWT (in `localStorage`) + bcrypt password hashing
- **Frontend:** vanilla-JS single-page app (hash router), Chart.js + Lucide icons via CDN — no bundler
- **Design:** a "civic-modern" system — trust-navy, energy-saffron, verified-green, warm paper, with a tricolor ribbon and Devanagari-capable typography

### Project structure
```
pm-milap/
├── server.js                 # entry point: schema init, seed, static + API, match scheduler
├── package.json
├── .env.example              # copy to .env to override defaults
├── data/
│   ├── mock_training_records.json   # simulated govt training feed
│   └── pm-milap.sqlite              # created at runtime
├── src/
│   ├── db.js                 # SQLite connection, schema, query helpers
│   ├── llm.js                # LLM service layer + deterministic fallbacks
│   ├── auth.js               # JWT + bcrypt + route guards
│   ├── matching.js           # heuristic + LLM matching, nudges, upskilling
│   ├── ingest.js             # training record → profile + certificate
│   ├── seed.js               # idempotent demo-data seeder
│   └── routes/api.js         # all REST endpoints
└── public/
    ├── index.html
    ├── css/styles.css        # full civic-modern design system
    └── js/
        ├── api.js            # fetch wrapper + auth/token store
        ├── ui.js             # DOM helpers, toast, formatters, i18n
        └── app.js            # hash router + every role view
```

---

## LLM configuration

The matching engine, resume writer and bio generator all call an **OpenAI-compatible** chat-completions endpoint. Configuration lives in the environment (defaults are baked in):

```
LLM_API_KEY   = sk-class-2026
LLM_BASE_URL  = http://10.10.202.212:8000/v1
LLM_MODEL     = openai/gpt-oss-20b
```

To point at a different provider/model, copy `.env.example` to `.env` and edit the `LLM_*` values, then restart. The LLM is abstracted behind `src/llm.js`, so the rest of the app is unaffected by the swap.

### Important: graceful offline fallback (by design)

**The portal is fully functional with no LLM available.** Every LLM-backed function — bio, resume, and match scoring — degrades to a deterministic local generator if the endpoint is unreachable or returns an error. When that happens:

- resumes/bios are produced from a high-quality template using the trainee's real data,
- match scores come from the heuristic scorer (skill overlap, trade fit, location, certification, availability),
- the admin analytics page shows an **"LLM offline · deterministic fallback"** pill so the behavior is transparent.

This means the configured endpoint above (a private class network address) does **not** need to be reachable for the demo to work — and in most environments it won't be. Everything you see is real, computed data; only the *phrasing* of resumes and match reasons changes when a live LLM is connected. To see live generation, connect a reachable OpenAI-compatible server and either reseed with `--llm` or click **"Regenerate with AI"** on a beneficiary profile.

---

## Notes

- Demo data covers 14 trainees across 11 trades and multiple states, 6 employers/recruiters/agents, 12 institutes, 11 vacancies, 5 overseas opportunities and ~46 historical placements — enough for the analytics and funnel to tell a real story (including a deliberate **CNC Programming skill gap** with demand but no certified supply).
- The background matching scheduler runs a few seconds after boot and then every couple of minutes; new postings also trigger matching immediately.
- Data resets are safe: `node src/seed.js --reset` rebuilds everything deterministically.

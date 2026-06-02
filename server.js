// server.js — application entry point
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

// Load .env if present (tiny parser, no dependency)
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Safety net: log unexpected async errors instead of letting one crash the whole
// portal. Individual requests still fail gracefully; the server stays up.
process.on('unhandledRejection', (reason) => {
  console.error('[warn] unhandled rejection:', reason?.message || reason);
});

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { initSchema } = await import('./src/db.js');
const { seed } = await import('./src/seed.js');
const { attachUser } = await import('./src/auth.js');
const { runMatching } = await import('./src/matching.js');
const apiRouter = (await import('./src/routes/api.js')).default;
const { llmStatus, probe } = await import('./src/llm.js');

initSchema();
await seed({ reset: false, useLLM: false }); // idempotent — seeds only when empty

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(attachUser);

app.use('/api', apiRouter);

// Serve the SPA
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(PUBLIC, 'index.html'));
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, async () => {
  const s = llmStatus();
  console.log('\n  PM-MILAP portal running');
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  LLM: ${s.model} @ ${s.baseURL} (enabled=${s.enabled})`);
  console.log('  Demo logins (password: demo1234):');
  console.log('    admin@pmmilap.gov.in · ramesh.yadav@pmvikas.demo · hr@bharatfab.com');
  console.log('    gulf@skybridge-overseas.com · rajasthan.iti@pmmilap.gov.in\n');
  if (s.enabled) {
    process.stdout.write('  Checking LLM connectivity… ');
    try {
      const r = await probe();
      if (r.online) console.log(`connected ✓  (model replied: "${String(r.sample || '').slice(0, 24)}")`);
      else console.log(`offline ✗  (${r.lastError}) — using deterministic fallback`);
    } catch (e) {
      console.log(`offline ✗  (${e.message}) — using deterministic fallback`);
    }
  }
});

// ── Background matching scheduler ──
const INTERVAL = Number(process.env.MATCH_INTERVAL_MS || 120000);
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    const summary = await runMatching({ useLLM: true });
    if (summary.created || summary.updated) {
      console.log(`[scheduler] matching pass: +${summary.created} new, ${summary.updated} updated, ${summary.llmUsed} via LLM`);
    }
  } catch (e) {
    console.error('[scheduler] error', e.message);
  } finally {
    running = false;
  }
}
setTimeout(tick, 8000);          // first refinement pass shortly after boot
setInterval(tick, INTERVAL);     // then periodically

// src/routes/api.js — all REST endpoints, grouped by concern.
import express from 'express';
import { all, get, run } from '../db.js';
import { signToken, checkPassword, hashPassword, requireAuth, requireRole } from '../auth.js';
import { generateBio, generateResume, llmStatus, probe, streamChat, complete, assistantFallback } from '../llm.js';
import { runMatching, upskillSuggestions } from '../matching.js';
import { ingestRecord } from '../ingest.js';

const router = express.Router();
const J = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };
const hydrate = (p) => p && ({ ...p, skills: J(p.skills), languages: J(p.languages),
  skills_required: p.skills_required !== undefined ? J(p.skills_required) : undefined });

// ════════════════════════════ AUTH ════════════════════════════
router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = get('SELECT * FROM users WHERE email = ?', (email || '').trim().toLowerCase());
  if (!u || !checkPassword(password || '', u.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (u.status === 'suspended') return res.status(403).json({ error: 'Account suspended by administrator' });
  const token = signToken(u);
  res.json({ token, user: { id: u.id, role: u.role, name: u.name, email: u.email } });
});

// Self-registration for employers / institutes / agents / recruiters (not beneficiaries).
router.post('/auth/register', async (req, res) => {
  const { email, password, name, role, org } = req.body || {};
  const allowed = ['employer', 'institute', 'agent', 'recruiter'];
  if (!allowed.includes(role)) return res.status(400).json({ error: 'Invalid role for self-registration' });
  if (!email || !password || !name) return res.status(400).json({ error: 'Missing fields' });
  if (get('SELECT id FROM users WHERE email=?', email.toLowerCase())) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  const r = run('INSERT INTO users (role, email, password_hash, name, status, profile_json) VALUES (?,?,?,?,?,?)',
    role, email.toLowerCase(), hashPassword(password), name, 'active', JSON.stringify(org || {}));
  if (role === 'institute') {
    run('INSERT INTO training_institutes (user_id, name, location_state, location_city, accreditation_id) VALUES (?,?,?,?,?)',
      r.lastInsertRowid, org?.company_name || name, org?.state, org?.city, org?.accreditation_id || ('TI-NEW-' + r.lastInsertRowid));
  }
  const u = get('SELECT * FROM users WHERE id=?', r.lastInsertRowid);
  res.json({ token: signToken(u), user: { id: u.id, role: u.role, name: u.name, email: u.email } });
});

router.get('/auth/me', requireAuth, (req, res) => {
  const u = get('SELECT id, role, email, name, status, profile_json FROM users WHERE id=?', req.user.id);
  res.json({ user: { ...u, profile: J(u.profile_json) } });
});

// ════════════════════════════ PUBLIC ════════════════════════════
// Public beneficiary profile (the auto-generated, shareable page).
router.get('/profiles/:id', (req, res) => {
  const p = get('SELECT * FROM beneficiary_profiles WHERE id=?', req.params.id);
  if (!p) return res.status(404).json({ error: 'Profile not found' });
  const cert = get('SELECT * FROM certificates WHERE beneficiary_id=?', p.id);
  res.json({ profile: hydrate(p), certificate: cert });
});

// Public certificate verification lookup.
router.get('/verify/:vid', (req, res) => {
  const cert = get('SELECT * FROM certificates WHERE verification_id=?', req.params.vid.trim().toUpperCase());
  if (!cert) return res.status(404).json({ verified: false, error: 'No certificate found for this ID' });
  const p = get('SELECT id, full_name, trade, training_institute, completion_date, location_state, location_city FROM beneficiary_profiles WHERE id=?', cert.beneficiary_id);
  res.json({ verified: !!cert.verified, certificate: cert, holder: p });
});

// Public lists of open opportunities (used on landing + dashboards).
router.get('/vacancies', (req, res) => {
  const { trade, state, q } = req.query;
  let sql = "SELECT v.*, u.name AS employer_name FROM vacancies v JOIN users u ON u.id=v.employer_user_id WHERE v.status='open'";
  const args = [];
  if (trade) { sql += ' AND v.trade=?'; args.push(trade); }
  if (state) { sql += ' AND v.location_state=?'; args.push(state); }
  if (q) { sql += ' AND (v.title LIKE ? OR v.description LIKE ?)'; args.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY v.created_at DESC';
  res.json({ vacancies: all(sql, ...args).map(hydrate) });
});

router.get('/overseas', (req, res) => {
  const rows = all("SELECT o.*, u.name AS agent_name FROM overseas_opportunities o JOIN users u ON u.id=o.agent_user_id WHERE o.status='open' ORDER BY o.created_at DESC");
  res.json({ overseas: rows.map(hydrate) });
});

// ════════════════════════════ BENEFICIARY ════════════════════════════
function myProfile(userId) {
  return hydrate(get('SELECT * FROM beneficiary_profiles WHERE user_id=?', userId));
}

router.get('/me/dashboard', requireAuth, requireRole('beneficiary'), (req, res) => {
  const profile = myProfile(req.user.id);
  if (!profile) return res.status(404).json({ error: 'No beneficiary profile' });
  const cert = get('SELECT * FROM certificates WHERE beneficiary_id=?', profile.id);
  const matches = all(`SELECT m.*, 
      CASE WHEN m.target_type='vacancy' THEN v.title ELSE o.title END AS title,
      CASE WHEN m.target_type='vacancy' THEN v.location_city ELSE o.country END AS place,
      CASE WHEN m.target_type='vacancy' THEN v.wage_min ELSE o.monthly_wage END AS wage,
      CASE WHEN m.target_type='vacancy' THEN '₹' ELSE o.currency END AS cur,
      CASE WHEN m.target_type='vacancy' THEN eu.name ELSE au.name END AS poster
    FROM matches m
    LEFT JOIN vacancies v ON m.target_type='vacancy' AND v.id=m.target_id
    LEFT JOIN users eu ON eu.id=v.employer_user_id
    LEFT JOIN overseas_opportunities o ON m.target_type='overseas' AND o.id=m.target_id
    LEFT JOIN users au ON au.id=o.agent_user_id
    WHERE m.beneficiary_id=? ORDER BY m.score DESC LIMIT 20`, profile.id);
  const upskill = upskillSuggestions(profile, 3);
  const stats = {
    matches: get("SELECT COUNT(*) n FROM matches WHERE beneficiary_id=?", profile.id).n,
    strong: get("SELECT COUNT(*) n FROM matches WHERE beneficiary_id=? AND score>=75", profile.id).n,
    unread: get("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0", req.user.id).n,
  };
  res.json({ profile, certificate: cert, matches, upskill, stats });
});

router.patch('/me/profile', requireAuth, requireRole('beneficiary'), (req, res) => {
  const p = myProfile(req.user.id);
  if (!p) return res.status(404).json({ error: 'No profile' });
  const { availability, willing_relocate, willing_overseas, phone } = req.body || {};
  run('UPDATE beneficiary_profiles SET availability=COALESCE(?,availability), willing_relocate=COALESCE(?,willing_relocate), willing_overseas=COALESCE(?,willing_overseas), phone=COALESCE(?,phone) WHERE id=?',
    availability ?? null, willing_relocate ?? null, willing_overseas ?? null, phone ?? null, p.id);
  res.json({ profile: myProfile(req.user.id) });
});

// Regenerate bio + resume live via the LLM (falls back to deterministic copy).
router.post('/profiles/:id/regenerate-ai', requireAuth, async (req, res) => {
  const p = get('SELECT * FROM beneficiary_profiles WHERE id=?', req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (req.user.role !== 'admin' && p.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
  const seed = hydrate(p);
  const bio = await generateBio(seed);
  const resume = await generateResume(seed);
  const ai = (bio.ai && resume.ai) ? 1 : 0;
  run('UPDATE beneficiary_profiles SET headline=?, bio=?, resume_md=?, ai_generated=? WHERE id=?',
    bio.headline, bio.bio, resume.resume, ai, p.id);
  res.json({ headline: bio.headline, bio: bio.bio, resume_md: resume.resume, ai_generated: ai, source: ai ? 'llm' : 'fallback' });
});

router.post('/matches/:id/apply', requireAuth, requireRole('beneficiary'), (req, res) => {
  const p = myProfile(req.user.id);
  const m = get('SELECT * FROM matches WHERE id=? AND beneficiary_id=?', req.params.id, p.id);
  if (!m) return res.status(404).json({ error: 'Match not found' });
  run("UPDATE matches SET status='applied' WHERE id=?", m.id);
  res.json({ ok: true, status: 'applied' });
});

// ════════════════════════════ EMPLOYER / RECRUITER / AGENT — talent pool ════════════════════════════
router.get('/talent', requireAuth, requireRole('employer', 'recruiter', 'agent', 'admin'), (req, res) => {
  const { trade, state, skill, availability, overseas, relocate, q } = req.query;
  let sql = 'SELECT * FROM beneficiary_profiles WHERE 1=1';
  const args = [];
  if (trade) { sql += ' AND trade=?'; args.push(trade); }
  if (state) { sql += ' AND location_state=?'; args.push(state); }
  if (availability) { sql += ' AND availability=?'; args.push(availability); }
  if (overseas === '1') sql += ' AND willing_overseas=1';
  if (relocate === '1') sql += ' AND willing_relocate=1';
  if (q) { sql += ' AND (full_name LIKE ? OR trade LIKE ? OR skills LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY assessment_score DESC LIMIT 100';
  let rows = all(sql, ...args).map(hydrate);
  if (skill) rows = rows.filter((r) => r.skills.some((s) => s.toLowerCase().includes(skill.toLowerCase())));
  // attach certificate verification id
  rows = rows.map((r) => ({ ...r, verification_id: get('SELECT verification_id FROM certificates WHERE beneficiary_id=?', r.id)?.verification_id }));
  res.json({ candidates: rows, total: rows.length, facets: facets() });
});

function facets() {
  return {
    trades: all('SELECT DISTINCT trade FROM beneficiary_profiles ORDER BY trade').map((r) => r.trade),
    states: all('SELECT DISTINCT location_state FROM beneficiary_profiles ORDER BY location_state').map((r) => r.location_state),
  };
}

// Candidates matched to a specific vacancy (employer view).
router.get('/vacancies/:id/matches', requireAuth, requireRole('employer', 'recruiter', 'admin'), (req, res) => {
  const rows = all(`SELECT m.*, b.full_name, b.trade, b.location_city, b.location_state, b.assessment_score, b.skills
    FROM matches m JOIN beneficiary_profiles b ON b.id=m.beneficiary_id
    WHERE m.target_type='vacancy' AND m.target_id=? ORDER BY m.score DESC`, req.params.id);
  res.json({ matches: rows.map(hydrate) });
});

router.post('/vacancies', requireAuth, requireRole('employer', 'recruiter'), (req, res) => {
  const b = req.body || {};
  const r = run(`INSERT INTO vacancies (employer_user_id, source, title, trade, skills_required, location_state, location_city, wage_min, wage_max, positions, certification_required, description)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    req.user.id, req.user.role === 'recruiter' ? 'recruiter' : 'employer', b.title, b.trade,
    JSON.stringify(b.skills_required || []), b.location_state, b.location_city,
    b.wage_min || null, b.wage_max || null, b.positions || 1, b.certification_required || null, b.description || '');
  res.json({ id: r.lastInsertRowid, ok: true });
});

router.get('/my/vacancies', requireAuth, requireRole('employer', 'recruiter'), (req, res) => {
  const rows = all('SELECT * FROM vacancies WHERE employer_user_id=? ORDER BY created_at DESC', req.user.id).map(hydrate);
  const withCounts = rows.map((v) => ({ ...v, match_count: get("SELECT COUNT(*) n FROM matches WHERE target_type='vacancy' AND target_id=? AND score>=55", v.id).n }));
  res.json({ vacancies: withCounts });
});

// Agent: post + view candidates open to overseas
router.post('/overseas', requireAuth, requireRole('agent'), (req, res) => {
  const b = req.body || {};
  const r = run(`INSERT INTO overseas_opportunities (agent_user_id, title, trade, country, visa_type, monthly_wage, currency, skills_required, positions, description)
    VALUES (?,?,?,?,?,?,?,?,?,?)`,
    req.user.id, b.title, b.trade, b.country, b.visa_type, b.monthly_wage || null, b.currency || 'USD',
    JSON.stringify(b.skills_required || []), b.positions || 1, b.description || '');
  res.json({ id: r.lastInsertRowid, ok: true });
});

router.get('/my/overseas', requireAuth, requireRole('agent'), (req, res) => {
  const rows = all('SELECT * FROM overseas_opportunities WHERE agent_user_id=? ORDER BY created_at DESC', req.user.id).map(hydrate);
  const withCounts = rows.map((o) => ({ ...o, match_count: get("SELECT COUNT(*) n FROM matches WHERE target_type='overseas' AND target_id=? AND score>=55", o.id).n }));
  res.json({ overseas: withCounts });
});

// ════════════════════════════ INSTITUTE ════════════════════════════
router.get('/institute/alumni', requireAuth, requireRole('institute'), (req, res) => {
  const inst = get('SELECT * FROM training_institutes WHERE user_id=?', req.user.id);
  if (!inst) return res.status(404).json({ error: 'Institute record not found' });
  const alumni = all('SELECT * FROM beneficiary_profiles WHERE institute_id=? ORDER BY assessment_score DESC', inst.id).map(hydrate);
  const enriched = alumni.map((a) => ({
    ...a,
    matches: get('SELECT COUNT(*) n FROM matches WHERE beneficiary_id=? AND score>=55', a.id).n,
    placed: a.availability === 'employed',
  }));
  const stats = {
    total: alumni.length,
    placed: enriched.filter((a) => a.placed).length,
    matched: enriched.filter((a) => a.matches > 0).length,
    avg_score: Math.round(alumni.reduce((s, a) => s + (a.assessment_score || 0), 0) / (alumni.length || 1)),
  };
  res.json({ institute: inst, alumni: enriched, stats });
});

// ════════════════════════════ NOTIFICATIONS ════════════════════════════
router.get('/notifications', requireAuth, (req, res) => {
  const rows = all('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50', req.user.id);
  const unread = get('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', req.user.id).n;
  res.json({ notifications: rows, unread });
});
router.post('/notifications/:id/read', requireAuth, (req, res) => {
  run('UPDATE notifications SET read=1 WHERE id=? AND user_id=?', req.params.id, req.user.id);
  res.json({ ok: true });
});
router.post('/notifications/read-all', requireAuth, (req, res) => {
  run('UPDATE notifications SET read=1 WHERE user_id=?', req.user.id);
  res.json({ ok: true });
});

// ════════════════════════════ ADMIN ════════════════════════════
router.get('/admin/analytics', requireAuth, requireRole('admin'), (req, res) => {
  // Placements over time (last 8 months)
  const series = all(`SELECT strftime('%Y-%m', placed_at) ym, COUNT(*) n FROM placements GROUP BY ym ORDER BY ym`);
  // Top skill gaps: demand (open vacancies) vs supply (available beneficiaries)
  const demand = {}, supply = {};
  for (const v of all("SELECT skills_required FROM vacancies WHERE status='open'")) for (const s of J(v.skills_required)) demand[s] = (demand[s] || 0) + 1;
  for (const o of all("SELECT skills_required FROM overseas_opportunities WHERE status='open'")) for (const s of J(o.skills_required)) demand[s] = (demand[s] || 0) + 1;
  for (const b of all("SELECT skills FROM beneficiary_profiles WHERE availability='available'")) for (const s of J(b.skills)) supply[s] = (supply[s] || 0) + 1;
  const gaps = Object.keys(demand).map((s) => ({ skill: s, demand: demand[s], supply: supply[s] || 0, gap: demand[s] - (supply[s] || 0) }))
    .sort((a, b) => b.gap - a.gap).slice(0, 8);
  // Regional skill availability
  const regional = all("SELECT location_state state, COUNT(*) trainees, ROUND(AVG(assessment_score)) avg_score FROM beneficiary_profiles GROUP BY location_state ORDER BY trainees DESC");
  // Funnel
  const funnel = {
    trainees: get('SELECT COUNT(*) n FROM beneficiary_profiles').n,
    matched: get('SELECT COUNT(DISTINCT beneficiary_id) n FROM matches WHERE score>=55').n,
    applied: get("SELECT COUNT(DISTINCT beneficiary_id) n FROM matches WHERE status='applied'").n,
    placed: get("SELECT COUNT(*) n FROM beneficiary_profiles WHERE availability='employed'").n,
  };
  const totals = {
    trainees: funnel.trainees,
    active: get("SELECT COUNT(*) n FROM beneficiary_profiles WHERE availability='available'").n,
    employers: get("SELECT COUNT(*) n FROM users WHERE role IN ('employer','recruiter')").n,
    agents: get("SELECT COUNT(*) n FROM users WHERE role='agent'").n,
    institutes: get("SELECT COUNT(*) n FROM training_institutes").n,
    vacancies: get("SELECT COUNT(*) n FROM vacancies WHERE status='open'").n,
    overseas: get("SELECT COUNT(*) n FROM overseas_opportunities WHERE status='open'").n,
    matches: get('SELECT COUNT(*) n FROM matches WHERE score>=55').n,
    match_rate: Math.round(funnel.matched / (funnel.trainees || 1) * 100),
  };
  // trade-wise placement breakdown
  const byTrade = all('SELECT trade, COUNT(*) n FROM placements GROUP BY trade ORDER BY n DESC');
  res.json({ totals, series, gaps, regional, funnel, byTrade, llm: llmStatus() });
});

router.get('/admin/stakeholders', requireAuth, requireRole('admin'), (req, res) => {
  const users = all("SELECT id, role, name, email, status, created_at FROM users WHERE role!='beneficiary' ORDER BY role, name");
  res.json({ users });
});
router.post('/admin/stakeholders/:id/status', requireAuth, requireRole('admin'), (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'suspended', 'pending'].includes(status)) return res.status(400).json({ error: 'bad status' });
  run('UPDATE users SET status=? WHERE id=?', status, req.params.id);
  res.json({ ok: true });
});

// Mock data ingestion endpoint — simulate the government training DB feed.
router.post('/admin/ingest', requireAuth, requireRole('admin'), async (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records : (req.body?.record ? [req.body.record] : []);
  if (!records.length) return res.status(400).json({ error: 'Provide records[] or record{}' });
  const results = [];
  for (const rec of records) results.push(await ingestRecord(rec, { useLLM: req.body?.useLLM !== false }));
  res.json({ ingested: results.filter((r) => r.created).length, results });
});

router.post('/admin/run-matching', requireAuth, requireRole('admin'), async (req, res) => {
  const summary = await runMatching({ useLLM: req.body?.useLLM !== false, verbose: true });
  res.json({ ok: true, summary });
});

router.get('/admin/certificates', requireAuth, requireRole('admin'), (req, res) => {
  const rows = all(`SELECT c.*, b.full_name FROM certificates c JOIN beneficiary_profiles b ON b.id=c.beneficiary_id ORDER BY c.id DESC`);
  res.json({ certificates: rows });
});
router.post('/admin/certificates/:id/verify', requireAuth, requireRole('admin'), (req, res) => {
  run('UPDATE certificates SET verified=? WHERE id=?', req.body?.verified ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

router.get('/system/status', (req, res) => res.json({ llm: llmStatus(), time: new Date().toISOString() }));

// ════════════════════════ AI ASSISTANT (demo centerpiece) ════════════════════════
// Builds a prompt grounded in the logged-in user's REAL data, streams the reply
// token-by-token, and lets the model propose an in-app action. This is the piece
// that demonstrates LLM integration: context-grounding + streaming + tool/actions
// + graceful offline fallback.

const PAGES = {
  beneficiary: ['#/dashboard', '#/matches', '#/profile', '#/upskill', '#/certificate'],
  employer: ['#/talent', '#/vacancies', '#/post-vacancy'],
  recruiter: ['#/talent', '#/vacancies', '#/post-vacancy'],
  agent: ['#/overseas', '#/candidates', '#/post-overseas'],
  institute: ['#/alumni'],
  admin: ['#/analytics', '#/ingestion', '#/stakeholders', '#/certificates', '#/verify'],
};

function buildAssistantContext(user) {
  const role = user.role;
  const facts = {};
  let contextText = '';
  try {
    if (role === 'beneficiary') {
      const p = get('SELECT * FROM beneficiary_profiles WHERE user_id=?', user.id);
      if (p) {
        const mc = get('SELECT COUNT(*) n FROM matches WHERE beneficiary_id=?', p.id).n;
        const strong = get('SELECT COUNT(*) n FROM matches WHERE beneficiary_id=? AND score>=75', p.id).n;
        const top = get(`SELECT m.score, m.target_type, m.target_id FROM matches m WHERE m.beneficiary_id=? ORDER BY m.score DESC LIMIT 1`, p.id);
        let topTitle = null;
        if (top) {
          const t = top.target_type === 'overseas'
            ? get('SELECT title FROM overseas_opportunities WHERE id=?', top.target_id)
            : get('SELECT title FROM vacancies WHERE id=?', top.target_id);
          topTitle = t?.title || null;
        }
        const cert = get('SELECT verification_id FROM certificates WHERE beneficiary_id=?', p.id);
        Object.assign(facts, { matchCount: mc, strong, topMatch: topTitle, trade: p.trade, score: p.assessment_score });
        contextText = `- Name: ${p.full_name}\n- Trade: ${p.trade} (assessment ${p.assessment_score}/100)\n- Skills: ${J(p.skills).join(', ')}\n- Availability: ${p.availability}; relocate: ${p.willing_relocate ? 'yes' : 'no'}; overseas: ${p.willing_overseas ? 'yes' : 'no'}\n- Location: ${p.location_city || ''}, ${p.location_state || ''}\n- Certificate ID: ${cert?.verification_id || 'n/a'}\n- Job matches: ${mc} total, ${strong} strong (75%+)${topTitle ? `\n- Best match: "${topTitle}" (${top.score}%)` : ''}`;
      }
    } else if (role === 'employer' || role === 'recruiter') {
      const vacs = all('SELECT * FROM vacancies WHERE employer_user_id=? ORDER BY created_at DESC', user.id);
      const totalMatches = get(`SELECT COUNT(*) n FROM matches WHERE target_type='vacancy' AND target_id IN (SELECT id FROM vacancies WHERE employer_user_id=?)`, user.id).n;
      facts.vacancies = vacs.length; facts.matches = totalMatches;
      contextText = `- Open postings: ${vacs.length}\n${vacs.slice(0, 8).map((v) => `   • "${v.title}" (${v.trade}) — ${get("SELECT COUNT(*) n FROM matches WHERE target_type='vacancy' AND target_id=? AND score>=55", v.id).n} candidate matches`).join('\n')}\n- Total candidate matches across your postings: ${totalMatches}`;
    } else if (role === 'agent') {
      const opps = all('SELECT * FROM overseas_opportunities WHERE agent_user_id=? ORDER BY created_at DESC', user.id);
      const overseasReady = get("SELECT COUNT(*) n FROM beneficiary_profiles WHERE willing_overseas=1 AND availability='available'").n;
      facts.opps = opps.length; facts.overseasReady = overseasReady;
      contextText = `- Your overseas postings: ${opps.length}\n${opps.slice(0, 8).map((o) => `   • "${o.title}" — ${o.country} (${o.trade})`).join('\n')}\n- Candidates open to overseas & available: ${overseasReady}`;
    } else if (role === 'institute') {
      const inst = get('SELECT * FROM training_institutes WHERE user_id=?', user.id);
      if (inst) {
        const total = get('SELECT COUNT(*) n FROM beneficiary_profiles WHERE institute_id=?', inst.id).n;
        const matched = get('SELECT COUNT(DISTINCT m.beneficiary_id) n FROM matches m JOIN beneficiary_profiles b ON b.id=m.beneficiary_id WHERE b.institute_id=? AND m.score>=55', inst.id).n;
        const placed = get('SELECT COUNT(*) n FROM placements pl JOIN beneficiary_profiles b ON b.id=pl.beneficiary_id WHERE b.institute_id=?', inst.id).n;
        facts.total = total; facts.matched = matched; facts.placed = placed;
        contextText = `- Institute: ${inst.name}\n- Alumni: ${total}; matched to opportunities: ${matched}; placed: ${placed}`;
      }
    } else if (role === 'admin') {
      const trainees = get('SELECT COUNT(*) n FROM beneficiary_profiles').n;
      const active = get("SELECT COUNT(*) n FROM beneficiary_profiles WHERE availability='available'").n;
      const matched = get('SELECT COUNT(DISTINCT beneficiary_id) n FROM matches').n;
      const placed = get('SELECT COUNT(*) n FROM placements').n;
      const matchRate = trainees ? Math.round((matched / trainees) * 100) : 0;
      // crude skill-gap: demanded skills with low certified supply
      const demand = {};
      for (const v of all("SELECT skills_required FROM vacancies WHERE status='open'")) for (const s of J(v.skills_required)) demand[s] = (demand[s] || 0) + 1;
      const supply = {};
      for (const b of all('SELECT skills FROM beneficiary_profiles')) for (const s of J(b.skills)) supply[s] = (supply[s] || 0) + 1;
      const gaps = Object.entries(demand).map(([s, d]) => [s, d - (supply[s] || 0)]).filter(([, g]) => g > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s]) => s);
      Object.assign(facts, { trainees, active, matched, placed, matchRate, gaps });
      contextText = `- Trainees: ${trainees} (available: ${active})\n- Matched: ${matched}; Placed: ${placed}; Match rate: ${matchRate}%\n- Top skill gaps (demand > supply): ${gaps.join(', ') || 'none'}`;
    }
  } catch (e) {
    contextText = '(context unavailable: ' + e.message + ')';
  }
  return { role, facts, contextText, pages: PAGES[role] || ['#/dashboard'] };
}

function parseActionMarker(text) {
  if (!text) return null;
  const i = text.indexOf('§ACTION§');
  if (i === -1) return null;
  const after = text.slice(i + 8).trim();
  const m = after.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function validateAction(action, ctx) {
  if (!action || typeof action !== 'object') return null;
  if (action.type === 'navigate') {
    return ctx.pages.includes(action.to) ? { type: 'navigate', to: action.to } : null;
  }
  if (action.type === 'search_talent' && ['employer', 'recruiter', 'agent'].includes(ctx.role)) {
    return { type: 'search_talent', trade: String(action.trade || '').slice(0, 40) };
  }
  if (action.type === 'run_matching' && ctx.role === 'admin') return { type: 'run_matching' };
  return null;
}

router.post('/assistant/stream', requireAuth, async (req, res) => {
  const userText = String(req.body?.message || '').slice(0, 2000);
  const history = Array.isArray(req.body?.history)
    ? req.body.history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content).slice(-6)
    : [];
  const ctx = buildAssistantContext(req.user);

  const actionDocs = [
    `{"type":"navigate","to":"<one of: ${ctx.pages.join(' ')}>"}`,
    (ctx.role === 'employer' || ctx.role === 'recruiter' || ctx.role === 'agent') ? '{"type":"search_talent","trade":"<Trade>"}' : '',
    ctx.role === 'admin' ? '{"type":"run_matching"}' : '',
  ].filter(Boolean).join('  OR  ');

  const sys = `You are the friendly in-app AI assistant for PM-MILAP, India's PM VIKAS skilling & placement portal.
The current user is ${req.user.name} (role: ${ctx.role}).

LIVE CONTEXT pulled from the database right now — treat these as ground truth and use the exact numbers; never invent data:
${ctx.contextText || '(no extra context)'}

Answer helpfully and concisely (2–5 sentences). If the user asks to go somewhere or do something, you MAY propose ONE action by writing it on a NEW FINAL LINE in exactly this form:
§ACTION§ ${actionDocs}
Only use an action when it clearly helps. Do not mention the §ACTION§ syntax to the user.`;

  const messages = [{ role: 'system', content: sys }, ...history, { role: 'user', content: userText }];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const send = (event, data) => res.write((event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(data)}\n\n`);

  // Send the exact prompt up front so the UI can reveal it ("show the prompt").
  send('meta', { prompt: messages, grounded: !!ctx.contextText });

  let full = await streamChat(messages, (tok) => send(null, { token: tok }), { temperature: 0.4, maxTokens: 500 });
  let source = 'llm';

  if (full == null) {
    const once = await complete(messages, { temperature: 0.4, maxTokens: 500 });
    if (once != null) { full = once; send(null, { token: once }); }
  }
  if (full == null) {
    const fb = assistantFallback(userText, ctx);
    source = 'fallback';
    send(null, { token: fb.reply });
    send('done', { action: validateAction(fb.action, ctx), source });
    return res.end();
  }

  let action = validateAction(parseActionMarker(full), ctx);
  if (!action) action = validateAction(assistantFallback(userText, ctx).action, ctx); // server-side intent backup
  send('done', { action, source });
  res.end();
});

// Admin: actively test LLM connectivity and surface the real error if any.
router.post('/admin/llm-test', requireAuth, requireRole('admin'), async (req, res) => {
  const r = await probe();
  res.json({ ...r, status: llmStatus() });
});

export default router;

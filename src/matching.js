// src/matching.js — the intelligent matching engine + nudge generator
import { all, get, run } from './db.js';
import { scoreMatch, heuristicScore } from './llm.js';

const J = (s) => { try { return JSON.parse(s || '[]'); } catch { return []; } };

function loadProfiles() {
  return all('SELECT * FROM beneficiary_profiles').map((p) => ({
    ...p, skills: J(p.skills), languages: J(p.languages),
  }));
}
function loadVacancies() {
  return all("SELECT * FROM vacancies WHERE status='open'").map((v) => ({
    ...v, skills_required: J(v.skills_required),
  }));
}
function loadOverseas() {
  return all("SELECT * FROM overseas_opportunities WHERE status='open'").map((o) => ({
    ...o, skills_required: J(o.skills_required),
  }));
}

// LLM budget per run so we never block the server; the rest use heuristics.
const LLM_BUDGET = 24;

export async function runMatching({ useLLM = true, verbose = false } = {}) {
  const profiles = loadProfiles();
  const vacancies = loadVacancies();
  const overseas = loadOverseas();
  let llmLeft = useLLM ? LLM_BUDGET : 0;
  let created = 0, updated = 0, llmUsed = 0;

  const upsert = (benId, type, id, score, reason, source) => {
    const existing = get('SELECT id, status FROM matches WHERE beneficiary_id=? AND target_type=? AND target_id=?', benId, type, id);
    if (existing) {
      run('UPDATE matches SET score=?, reason=?, source=? WHERE id=?', score, reason, source, existing.id);
      updated++;
      return { isNew: false };
    }
    run('INSERT INTO matches (beneficiary_id, target_type, target_id, score, reason, source) VALUES (?,?,?,?,?,?)',
      benId, type, id, score, reason, source);
    created++;
    return { isNew: true };
  };

  const consider = async (profile, opp, kind) => {
    // cheap pre-filter so we never spend an LLM call on obvious non-fits
    const pre = heuristicScore(profile, opp, kind);
    if (pre.score < 45) return null;
    let result = pre; result.source = 'heuristic';
    if (llmLeft > 0) {
      const r = await scoreMatch(profile, opp, kind);
      result = r; llmLeft--; if (r.source === 'llm') llmUsed++;
    }
    return result;
  };

  // ── candidates ↔ vacancies ──
  for (const v of vacancies) {
    for (const p of profiles) {
      if (p.availability === 'employed') continue;
      const r = await consider(p, v, 'vacancy');
      if (!r || r.score < 55) continue;
      const { isNew } = upsert(p.id, 'vacancy', v.id, r.score, r.reason, r.source);
      if (isNew && r.score >= 70) nudgeBeneficiary(p, v, 'vacancy', r.score);
    }
  }
  // ── candidates ↔ overseas ──
  for (const o of overseas) {
    for (const p of profiles) {
      if (!p.willing_overseas || p.availability === 'employed') continue;
      const r = await consider(p, o, 'overseas');
      if (!r || r.score < 55) continue;
      const { isNew } = upsert(p.id, 'overseas', o.id, r.score, r.reason, r.source);
      if (isNew && r.score >= 65) nudgeBeneficiary(p, o, 'overseas', r.score);
    }
  }

  // ── aggregate nudges for employers / recruiters ──
  for (const v of vacancies) {
    const cnt = get("SELECT COUNT(*) n FROM matches WHERE target_type='vacancy' AND target_id=? AND score>=65", v.id).n;
    if (cnt >= 1) {
      const trade = (v.trade || 'qualified candidates');
      maybeNotify(v.employer_user_id, 'match',
        `${cnt} certified ${pluralTrade(trade)} match "${v.title}"`,
        `Newly surfaced candidates fit your open vacancy. Open the talent pool to review and shortlist.`,
        '#/talent', 'users', 6);
    }
  }

  // ── institute alumni nudges ──
  const institutes = all('SELECT * FROM training_institutes WHERE user_id IS NOT NULL');
  for (const inst of institutes) {
    const matched = get(`SELECT COUNT(DISTINCT m.beneficiary_id) n FROM matches m
      JOIN beneficiary_profiles b ON b.id=m.beneficiary_id
      WHERE b.institute_id=? AND m.score>=65`, inst.id).n;
    if (matched >= 1) {
      maybeNotify(inst.user_id, 'alumni',
        `${matched} of your alumni were matched this week`,
        `${inst.name} graduates are being surfaced to employers. View placement outcomes on your dashboard.`,
        '#/alumni', 'graduation', 6);
    }
  }

  if (verbose) console.log(`[match] profiles=${profiles.length} created=${created} updated=${updated} llmUsed=${llmUsed}`);
  return { profiles: profiles.length, vacancies: vacancies.length, overseas: overseas.length, created, updated, llmUsed, llmLeft };
}

function pluralTrade(t) {
  const map = { Electrician: 'electricians', Welder: 'welders', Plumber: 'plumbers' };
  if (map[t]) return map[t];
  return /(s|ian|er)$/.test(t) ? t.toLowerCase() + 's' : t.toLowerCase() + 's';
}

function nudgeBeneficiary(p, opp, kind, score) {
  const u = get('SELECT user_id FROM beneficiary_profiles WHERE id=?', p.id);
  if (!u?.user_id) return;
  if (kind === 'overseas') {
    maybeNotify(u.user_id, 'overseas',
      `🌍 Overseas ${p.trade} role just opened in ${opp.country}`,
      `"${opp.title}" — ${opp.monthly_wage ? opp.currency + ' ' + opp.monthly_wage + '/mo' : 'competitive wage'}. ${score}% match with your profile.`,
      '#/matches', 'globe', 24);
  } else {
    maybeNotify(u.user_id, 'match',
      `New job matches your skills near ${opp.location_city || opp.location_state}`,
      `"${opp.title}" is a ${score}% fit. ${opp.wage_min ? '₹' + opp.wage_min.toLocaleString('en-IN') + '+/mo. ' : ''}Tap to view and apply.`,
      '#/matches', 'briefcase', 24);
  }
}

// De-dupe notifications within a recent window to avoid spam on repeated runs.
function maybeNotify(userId, type, title, body, link, icon, windowHours = 12) {
  if (!userId) return;
  const dupe = get(
    `SELECT id FROM notifications WHERE user_id=? AND title=? AND created_at > datetime('now', ?)`,
    userId, title, `-${windowHours} hours`
  );
  if (dupe) return;
  run('INSERT INTO notifications (user_id, type, title, body, link, icon) VALUES (?,?,?,?,?,?)',
    userId, type, title, body, link, icon);
}

// Upskill nudges: find skills the candidate lacks that are in high demand.
export function upskillSuggestions(profile, limit = 3) {
  const demand = {};
  for (const v of loadVacancies()) for (const s of v.skills_required) demand[s] = (demand[s] || 0) + 1;
  const have = new Set((profile.skills || []).map((s) => s.toLowerCase()));
  return Object.entries(demand)
    .filter(([s]) => !have.has(s.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([skill, demandCount]) => ({ skill, demandCount }));
}

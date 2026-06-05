// src/llm.js — provider-agnostic LLM service layer
// All model calls go through here so the provider/model can be swapped freely.
// Every function degrades gracefully to a deterministic local generator when the
// LLM endpoint is unreachable, so the portal is always fully demonstrable.

const CFG = {
  enabled: (process.env.LLM_ENABLED ?? 'true') !== 'false',
  apiKey: process.env.LLM_API_KEY || process.env.GROQ_API_KEY || '',
  baseURL: (process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, ''),
  model: process.env.LLM_MODEL || 'llama-3.1-8b-instant',
  // Hosted models can still be slow on the first request — give them real time.
  timeout: Number(process.env.LLM_TIMEOUT_MS || 60000),
  // 'auto' tries response_format and retries without it if rejected; 'off' never sends it.
  jsonMode: (process.env.LLM_JSON_MODE || 'auto').toLowerCase(),
};

let _online = null;      // null = unknown, true/false = last known reachability
let _lastTry = 0;        // timestamp of last network attempt
let _lastError = null;   // last error message (surfaced to admin for debugging)
const COOLDOWN_MS = 20000; // after a failure, wait this long before trying again (no permanent latch)

export function llmStatus() {
  return { ...CFG, apiKey: CFG.apiKey ? '••••' + CFG.apiKey.slice(-4) : null, online: _online, lastError: _lastError };
}

// Lightweight connectivity probe (tiny generation) so the dashboard pill and the
// boot log can reflect reality without waiting for a full resume/match call.
export async function probe() {
  const out = await chat([{ role: 'user', content: 'Reply with exactly: ok' }], { temperature: 0, maxTokens: 32 });
  return { online: _online, lastError: _lastError, sample: out };
}

// Pull a JSON object out of a model reply that may be fenced or wrapped in prose
// (reasoning models like gpt-oss often add commentary around the JSON).
function parseJsonLoose(s) {
  if (!s) return null;
  let t = String(s).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch { /* try to extract */ }
  const m = t.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* give up */ } }
  return null;
}

// Core completion call against an OpenAI-compatible /chat/completions endpoint.
async function chat(messages, { json = false, temperature = 0.5, maxTokens = 800 } = {}) {
  if (!CFG.enabled) return null;
  // Soft cooldown (not a permanent latch): if we recently failed, skip briefly,
  // then allow a fresh attempt so a transient hiccup self-heals without a restart.
  if (_online === false && Date.now() - _lastTry < COOLDOWN_MS) return null;

  const attempt = async (useJsonMode) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CFG.timeout);
    try {
      const res = await fetch(`${CFG.baseURL}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.apiKey}` },
        body: JSON.stringify({
          model: CFG.model,
          messages,
          temperature,
          max_tokens: maxTokens,
          ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const e = new Error(`HTTP ${res.status} ${body.slice(0, 180)}`);
        e.status = res.status;
        throw e;
      }
      const data = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() ?? '';
    } finally {
      clearTimeout(timer);
    }
  };

  _lastTry = Date.now();
  const wantJson = json && CFG.jsonMode !== 'off';
  try {
    let content;
    try {
      content = await attempt(wantJson);
    } catch (e) {
      // A 4xx with JSON mode usually means the server doesn't support
      // response_format — retry once in plain mode before giving up.
      if (wantJson && e.status >= 400 && e.status < 500) content = await attempt(false);
      else throw e;
    }
    _online = true;
    _lastError = null;
    return content;
  } catch (err) {
    _online = false;
    _lastError = err.name === 'AbortError' ? `timeout after ${CFG.timeout}ms` : (err.message || String(err));
    return null; // caller uses fallback
  }
}

// ── Streaming chat (Server-Sent Events from an OpenAI-compatible endpoint) ──
// Calls onToken(textDelta) for each streamed chunk; returns the full text, or
// null if the endpoint is unreachable / doesn't support streaming. Used by the
// in-app AI assistant so a slow local model shows tokens as they arrive.
export async function streamChat(messages, onToken, { temperature = 0.5, maxTokens = 700 } = {}) {
  if (!CFG.enabled) return null;
  if (_online === false && Date.now() - _lastTry < COOLDOWN_MS) return null;
  _lastTry = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CFG.timeout);
  try {
    const res = await fetch(`${CFG.baseURL}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.apiKey}` },
      body: JSON.stringify({ model: CFG.model, messages, temperature, max_tokens: maxTokens, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    let full = '';
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const j = JSON.parse(payload);
          const delta = j?.choices?.[0]?.delta?.content || '';
          if (delta) { full += delta; onToken(delta); }
        } catch { /* ignore keep-alive / partial */ }
      }
    }
    _online = true; _lastError = null;
    return full;
  } catch (err) {
    _online = false;
    _lastError = err.name === 'AbortError' ? `timeout after ${CFG.timeout}ms` : (err.message || String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Non-streaming completion used by the assistant when streaming isn't available.
export async function complete(messages, opts = {}) {
  return chat(messages, opts);
}

// Deterministic assistant reply when the LLM is unreachable — keeps the demo
// fully functional offline and still feels helpful and on-topic.
export function assistantFallback(userText, ctx) {
  const q = (userText || '').toLowerCase();
  const lines = [];
  if (/match|job|vacanc|opportunit/.test(q) && ctx.role === 'beneficiary') {
    lines.push(`You currently have ${ctx.facts.matchCount ?? 0} matches, ${ctx.facts.strong ?? 0} of them strong (75%+).`);
    if (ctx.facts.topMatch) lines.push(`Your best fit right now is "${ctx.facts.topMatch}".`);
    return { reply: lines.join(' ') + ' Opening your matches.', action: { type: 'navigate', to: '#/matches' } };
  }
  if (/welder|electric|plumb|talent|candidate|find/.test(q) && (ctx.role === 'employer' || ctx.role === 'recruiter')) {
    const trade = (q.match(/welder|electrician|plumber|solar|cnc|beautician|technician/) || [''])[0];
    return { reply: `Opening the talent pool${trade ? ' for ' + trade : ''}.`, action: { type: 'navigate', to: '#/talent', query: { trade: trade ? trade[0].toUpperCase() + trade.slice(1) : '' } } };
  }
  if (/run|refresh|matching/.test(q) && ctx.role === 'admin') {
    return { reply: 'Running the matching engine now.', action: { type: 'run_matching' } };
  }
  if (/gap|skill|analytic|placement|report/.test(q) && ctx.role === 'admin') {
    lines.push(`Match rate is ${ctx.facts.matchRate ?? '—'}%. Top skill gaps: ${(ctx.facts.gaps || []).join(', ') || 'n/a'}.`);
    return { reply: lines.join(' ') + ' Opening analytics.', action: { type: 'navigate', to: '#/analytics' } };
  }
  return { reply: `I can help you navigate PM-MILAP and answer questions about your ${ctx.role} dashboard. (The AI model is offline right now, so this is a built-in fallback response.)`, action: null };
}

// ── 1. Professional headline + bio ─────────────────────────────────────────
export async function generateBio(p, useLLM = true) {
  if (!useLLM) return { ...fallbackBio(p), ai: false };
  const skills = (p.skills || []).join(', ');
  const sys = 'You are a career writer for India\'s PM VIKAS skilling mission. Write encouraging, concise, professional copy. Return strict JSON.';
  const user = `Create a LinkedIn-style professional headline and a 2-3 sentence bio for this government-certified trainee.
Name: ${p.full_name}
Trade: ${p.trade}
Skills: ${skills}
Assessment score: ${p.assessment_score}/100
Training: ${p.training_institute || 'PM VIKAS centre'}, ${p.location_city}, ${p.location_state}
Return JSON: {"headline": "...", "bio": "..."}`;
  const out = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: true, temperature: 0.6 });
  if (out) {
    const j = parseJsonLoose(out);
    if (j && j.headline && j.bio) return { ...j, ai: true };
  }
  return { ...fallbackBio(p), ai: false };
}

function fallbackBio(p) {
  const skills = (p.skills || []).slice(0, 3).join(', ');
  const tier = p.assessment_score >= 85 ? 'top-performing' : p.assessment_score >= 70 ? 'skilled' : 'certified';
  return {
    headline: `${p.trade} | PM VIKAS Certified | ${p.location_city || p.location_state}`,
    bio: `${p.full_name} is a ${tier} ${p.trade.toLowerCase()} certified under the PM VIKAS scheme with hands-on proficiency in ${skills || p.trade.toLowerCase()}. Assessed at ${p.assessment_score}/100 and ready to contribute to employers across ${p.location_state}${p.willing_overseas ? ' and overseas' : ''}.`,
  };
}

// ── 2. Polished resume (Markdown) ───────────────────────────────────────────
export async function generateResume(p, useLLM = true) {
  if (!useLLM) return { resume: fallbackResume(p), ai: false };
  const sys = 'You are an expert resume writer. Produce a clean, ATS-friendly resume in Markdown. No preamble.';
  const user = `Write a one-page professional resume in Markdown for a government-certified trainee.
Name: ${p.full_name}
Trade / Role target: ${p.trade}
Skills: ${(p.skills || []).join(', ')}
Training institute: ${p.training_institute}
Completion date: ${p.completion_date}
Assessment score: ${p.assessment_score}/100
Location: ${p.location_city}, ${p.location_state}
Languages: ${(p.languages || []).join(', ')}
Use sections: Summary, Core Skills, Certification (PM VIKAS, verified), Training & Assessment, Languages, Availability. Keep it factual and confident.`;
  const out = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.5, maxTokens: 900 });
  if (out) return { resume: out, ai: true };
  return { resume: fallbackResume(p), ai: false };
}

function fallbackResume(p) {
  const skills = (p.skills || []).map((s) => `- ${s}`).join('\n');
  return `# ${p.full_name}
**${p.trade}** · ${p.location_city || ''}, ${p.location_state || ''} · ${p.phone || ''}

## Summary
PM VIKAS-certified ${p.trade.toLowerCase()} with assessed proficiency (${p.assessment_score}/100). Trained at ${p.training_institute || 'a PM VIKAS centre'} and ready for immediate placement${p.willing_relocate ? ', open to relocation' : ''}${p.willing_overseas ? ' and overseas roles' : ''}.

## Core Skills
${skills || '- ' + p.trade}

## Certification
- **PM VIKAS National Skill Certificate** — ${p.trade}
- Issued by Ministry of Skill Development & Entrepreneurship, Govt. of India
- Status: ✅ Verified

## Training & Assessment
- **Institute:** ${p.training_institute || 'PM VIKAS Centre'}
- **Completed:** ${p.completion_date || '—'}
- **Assessment score:** ${p.assessment_score}/100

## Languages
${(p.languages || ['Hindi', 'English']).join(', ')}

## Availability
${p.availability === 'available' ? 'Available immediately' : p.availability}`;
}

// ── 3. Semantic match scoring (candidate ↔ opportunity) ─────────────────────
export async function scoreMatch(profile, opp, kind, useLLM = true) {
  if (!useLLM) return { ...heuristicScore(profile, opp, kind), source: 'heuristic' };
  const sys = 'You are a placement-matching engine for a skilling mission. Judge fit beyond keywords — consider transferable and related skills. Return strict JSON only.';
  const user = `Candidate:
- Trade: ${profile.trade}
- Skills: ${(profile.skills || []).join(', ')}
- Assessment: ${profile.assessment_score}/100
- Location: ${profile.location_city}, ${profile.location_state}
- Willing to relocate: ${profile.willing_relocate ? 'yes' : 'no'} | overseas: ${profile.willing_overseas ? 'yes' : 'no'}

${kind === 'overseas' ? 'Overseas opportunity' : 'Job vacancy'}:
- Title: ${opp.title}
- Trade: ${opp.trade}
- Skills required: ${(opp.skills_required || []).join(', ')}
- Location: ${kind === 'overseas' ? opp.country : (opp.location_city + ', ' + opp.location_state)}

Return JSON: {"score": <0-100 integer>, "reason": "<one short sentence, <=22 words>"}`;
  const out = await chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { json: true, temperature: 0.3, maxTokens: 160 });
  if (out) {
    const j = parseJsonLoose(out);
    if (j && typeof j.score === 'number' && j.reason) {
      return { score: Math.max(0, Math.min(100, Math.round(j.score))), reason: j.reason, source: 'llm' };
    }
  }
  return { ...heuristicScore(profile, opp, kind), source: 'heuristic' };
}

// Deterministic fallback scorer (also used to pre-filter before LLM calls).
export function heuristicScore(profile, opp, kind) {
  const pSkills = new Set((profile.skills || []).map((s) => s.toLowerCase()));
  const need = (opp.skills_required || []).map((s) => s.toLowerCase());
  let overlap = need.filter((s) => pSkills.has(s) || [...pSkills].some((x) => x.includes(s) || s.includes(x))).length;
  let score = need.length ? (overlap / need.length) * 60 : 30;

  // trade alignment
  if (profile.trade && opp.trade) {
    const a = profile.trade.toLowerCase(), b = opp.trade.toLowerCase();
    if (a === b) score += 25;
    else if (a.includes(b) || b.includes(a) || sharesWord(a, b)) score += 14;
  }
  // assessment quality
  score += Math.round((profile.assessment_score || 0) / 100 * 10);

  // location / mobility
  if (kind === 'overseas') {
    if (profile.willing_overseas) score += 5; else score -= 25;
  } else {
    if (profile.location_state && opp.location_state &&
        profile.location_state.toLowerCase() === opp.location_state.toLowerCase()) score += 5;
    else if (!profile.willing_relocate) score -= 8;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const reasons = [];
  if (overlap) reasons.push(`${overlap} of ${need.length} required skills matched`);
  if (profile.trade.toLowerCase() === (opp.trade || '').toLowerCase()) reasons.push(`exact ${profile.trade} trade fit`);
  else reasons.push(`transferable ${profile.trade} background`);
  if (profile.assessment_score >= 80) reasons.push(`strong ${profile.assessment_score}/100 assessment`);
  const reason = (score >= 75 ? 'Strong fit: ' : score >= 55 ? 'Good fit: ' : 'Possible fit: ') +
    reasons.slice(0, 2).join(' + ') + '.';
  return { score, reason };
}

function sharesWord(a, b) {
  const wa = new Set(a.split(/\W+/).filter((w) => w.length > 3));
  return b.split(/\W+/).some((w) => w.length > 3 && wa.has(w));
}

export { CFG as llmConfig };

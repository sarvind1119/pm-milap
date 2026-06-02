// api.js — thin fetch wrapper + auth/token store (localStorage).

const TOKEN_KEY = 'pmmilap_token';
const USER_KEY = 'pmmilap_user';

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY) || null; },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
    catch { return null; }
  },
  set(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  get isAuthed() { return !!this.token; },
};

async function request(method, path, body, { query } = {}) {
  let url = '/api' + path;
  if (query) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    if (qs) url += '?' + qs;
  }
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth.token) headers['Authorization'] = 'Bearer ' + auth.token;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError('Network error — is the server running?', 0);
  }

  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { raw: text }; } }

  if (!res.ok) {
    // Token expired / invalid → bounce to login.
    if (res.status === 401 && auth.isAuthed) {
      auth.clear();
      if (!location.hash.startsWith('#/login')) location.hash = '#/login';
    }
    throw new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data);
  }
  return data;
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export const api = {
  get: (p, opts) => request('GET', p, undefined, opts),
  post: (p, body, opts) => request('POST', p, body ?? {}, opts),
  patch: (p, body, opts) => request('PATCH', p, body ?? {}, opts),

  // ---- auth ----
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  register: (payload) => request('POST', '/auth/register', payload),
  me: () => request('GET', '/auth/me'),

  // ---- public ----
  profile: (id) => request('GET', `/profiles/${id}`),
  verify: (vid) => request('GET', `/verify/${encodeURIComponent(vid)}`),
  vacancies: (query) => request('GET', '/vacancies', undefined, { query }),
  overseas: () => request('GET', '/overseas'),
  systemStatus: () => request('GET', '/system/status'),

  // ---- beneficiary ----
  dashboard: () => request('GET', '/me/dashboard'),
  updateProfile: (patch) => request('PATCH', '/me/profile', patch),
  regenerateAI: (id) => request('POST', `/profiles/${id}/regenerate-ai`, {}),
  apply: (matchId) => request('POST', `/matches/${matchId}/apply`, {}),

  // ---- talent / employer / recruiter / agent ----
  talent: (query) => request('GET', '/talent', undefined, { query }),
  vacancyMatches: (id) => request('GET', `/vacancies/${id}/matches`),
  postVacancy: (body) => request('POST', '/vacancies', body),
  myVacancies: () => request('GET', '/my/vacancies'),
  postOverseas: (body) => request('POST', '/overseas', body),
  myOverseas: () => request('GET', '/my/overseas'),

  // ---- institute ----
  alumni: () => request('GET', '/institute/alumni'),

  // ---- notifications ----
  notifications: () => request('GET', '/notifications'),
  readNotif: (id) => request('POST', `/notifications/${id}/read`, {}),
  readAllNotifs: () => request('POST', '/notifications/read-all', {}),

  // ---- admin ----
  analytics: () => request('GET', '/admin/analytics'),
  stakeholders: () => request('GET', '/admin/stakeholders'),
  setStatus: (id, status) => request('POST', `/admin/stakeholders/${id}/status`, { status }),
  ingest: (records, useLLM) => request('POST', '/admin/ingest', { records, useLLM }),
  runMatching: (useLLM) => request('POST', '/admin/run-matching', { useLLM }),
  certificates: () => request('GET', '/admin/certificates'),
  setCertVerified: (id, verified) => request('POST', `/admin/certificates/${id}/verify`, { verified }),
  testLLM: () => request('POST', '/admin/llm-test', {}),
};

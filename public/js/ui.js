// ui.js — DOM helpers, toast, icon refresh, formatters, and i18n.

/* ---------------- DOM helper ----------------
   el('div.card.pad', { onclick }, [child, 'text']) → HTMLElement  */
export function el(tag, attrs = {}, children = []) {
  let tagName = 'div', id = null;
  const classes = [];
  // parse "tag#id.class.class"
  tag.replace(/([.#]?[^.#]+)/g, (m) => {
    if (m[0] === '.') classes.push(m.slice(1));
    else if (m[0] === '#') id = m.slice(1);
    else tagName = m;
    return m;
  });
  const node = document.createElement(tagName);
  if (id) node.id = id;
  if (classes.length) node.className = classes.join(' ');

  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = (node.className ? node.className + ' ' : '') + v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }

  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

/* ---------------- Lucide icon ---------------- */
export function icon(name, attrs = {}) {
  const i = el('i', { 'data-lucide': name, ...attrs });
  return i;
}
// Re-render any [data-lucide] placeholders into SVGs.
export function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

/* ---------------- Toast ---------------- */
export function toast(message, kind = '') {
  const host = document.getElementById('toast-host');
  const t = el('div.toast' + (kind ? '.' + kind : ''), { text: message });
  host.appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s, transform .3s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(8px)';
    setTimeout(() => t.remove(), 320);
  }, 3200);
}

/* ---------------- Formatters ---------------- */
export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase() || '?';
}

// deterministic avatar colour from a string
export function avatarColor(seed = '') {
  const palette = ['#102A56', '#0F7B3E', '#DB6E10', '#6B3FA0', '#1B6CA8', '#B8862F', '#2155b8', '#9A3412'];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

export function timeAgo(iso) {
  if (!iso) return '';
  const then = new Date(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z');
  const s = Math.floor((Date.now() - then.getTime()) / 1000);
  if (Number.isNaN(s)) return '';
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtMonth(ym) {
  const [y, m] = String(ym).split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

export function money(amount, currency = '₹') {
  if (amount == null || amount === '') return '—';
  const n = Number(amount);
  const grouped = n.toLocaleString('en-IN');
  return (currency === '₹' ? '₹' : currency + ' ') + grouped;
}

/* ---------------- i18n ---------------- */
const DICT = {
  en: {
    tagline: 'Connecting India\u2019s certified talent with opportunity',
    signIn: 'Sign in', email: 'Email', password: 'Password',
    quickDemo: 'Or jump in with a demo account', orEmail: 'sign in with email',
    dashboard: 'Dashboard', myProfile: 'My Profile', myMatches: 'My Matches',
    opportunities: 'Opportunities', upskill: 'Upskill', certificate: 'Certificate',
    talentPool: 'Talent Pool', myVacancies: 'My Vacancies', postVacancy: 'Post a Vacancy',
    overseasRoles: 'Overseas Roles', postOverseas: 'Post Opportunity', candidates: 'Candidates',
    alumni: 'Alumni', analytics: 'Analytics', ingestion: 'Data Ingestion',
    stakeholders: 'Stakeholders', verifyCerts: 'Certificates', verifyCert: 'Verify a Certificate',
    notifications: 'Notifications', logout: 'Log out', markAllRead: 'Mark all read',
    noNotifs: 'You\u2019re all caught up', search: 'Search', filters: 'Filters', apply: 'Apply now',
    applied: 'Applied', viewProfile: 'View profile', regenerate: 'Regenerate with AI',
    availability: 'Availability', openToOverseas: 'Open to overseas', willingRelocate: 'Willing to relocate',
    matchScore: 'Match', verified: 'Verified', strongMatches: 'Strong matches',
    activeTrainees: 'Active trainees', placements: 'Placements', matchRate: 'Match rate',
    welcome: 'Welcome back', viewResume: 'View resume', share: 'Public profile',
  },
  hi: {
    tagline: '\u092D\u093E\u0930\u0924 \u0915\u0940 \u092A\u094D\u0930\u092E\u093E\u0923\u093F\u0924 \u092A\u094D\u0930\u0924\u093F\u092D\u093E \u0915\u094B \u0905\u0935\u0938\u0930 \u0938\u0947 \u091C\u094B\u0921\u093C\u0928\u093E',
    signIn: '\u0938\u093E\u0907\u0928 \u0907\u0928 \u0915\u0930\u0947\u0902', email: '\u0908\u092E\u0947\u0932', password: '\u092A\u093E\u0938\u0935\u0930\u094D\u0921',
    quickDemo: '\u092F\u093E \u0921\u0947\u092E\u094B \u0916\u093E\u0924\u0947 \u0938\u0947 \u0936\u0941\u0930\u0942 \u0915\u0930\u0947\u0902', orEmail: '\u0908\u092E\u0947\u0932 \u0938\u0947 \u0938\u093E\u0907\u0928 \u0907\u0928',
    dashboard: '\u0921\u0948\u0936\u092C\u094B\u0930\u094D\u0921', myProfile: '\u092E\u0947\u0930\u0940 \u092A\u094D\u0930\u094B\u092B\u093E\u0907\u0932', myMatches: '\u092E\u0947\u0930\u0947 \u092E\u0948\u091A',
    opportunities: '\u0905\u0935\u0938\u0930', upskill: '\u0915\u094C\u0936\u0932 \u0935\u0943\u0926\u094D\u0927\u093F', certificate: '\u092A\u094D\u0930\u092E\u093E\u0923\u092A\u0924\u094D\u0930',
    talentPool: '\u092A\u094D\u0930\u0924\u093F\u092D\u093E \u092A\u0942\u0932', myVacancies: '\u092E\u0947\u0930\u0940 \u0930\u093F\u0915\u094D\u0924\u093F\u092F\u093E\u0901', postVacancy: '\u0930\u093F\u0915\u094D\u0924\u093F \u092A\u094B\u0938\u094D\u091F \u0915\u0930\u0947\u0902',
    overseasRoles: '\u0935\u093F\u0926\u0947\u0936\u0940 \u092D\u0942\u092E\u093F\u0915\u093E\u090F\u0901', postOverseas: '\u0905\u0935\u0938\u0930 \u092A\u094B\u0938\u094D\u091F \u0915\u0930\u0947\u0902', candidates: '\u0909\u092E\u094D\u092E\u0940\u0926\u0935\u093E\u0930',
    alumni: '\u092A\u0942\u0930\u094D\u0935 \u091B\u093E\u0924\u094D\u0930', analytics: '\u0935\u093F\u0936\u094D\u0932\u0947\u0937\u0923', ingestion: '\u0921\u0947\u091F\u093E \u0907\u0928\u092A\u0941\u091F',
    stakeholders: '\u0939\u093F\u0924\u0927\u093E\u0930\u0915', verifyCerts: '\u092A\u094D\u0930\u092E\u093E\u0923\u092A\u0924\u094D\u0930', verifyCert: '\u092A\u094D\u0930\u092E\u093E\u0923\u092A\u0924\u094D\u0930 \u0938\u0924\u094D\u092F\u093E\u092A\u093F\u0924 \u0915\u0930\u0947\u0902',
    notifications: '\u0938\u0942\u091A\u0928\u093E\u090F\u0901', logout: '\u0932\u0949\u0917 \u0906\u0909\u091F', markAllRead: '\u0938\u092D\u0940 \u092A\u0922\u093C\u093E \u0939\u0941\u0906 \u091A\u093F\u0939\u094D\u0928\u093F\u0924 \u0915\u0930\u0947\u0902',
    noNotifs: '\u0915\u094B\u0908 \u0928\u0908 \u0938\u0942\u091A\u0928\u093E \u0928\u0939\u0940\u0902', search: '\u0916\u094B\u091C\u0947\u0902', filters: '\u092B\u093C\u093F\u0932\u094D\u091F\u0930', apply: '\u0905\u092D\u0940 \u0906\u0935\u0947\u0926\u0928 \u0915\u0930\u0947\u0902',
    applied: '\u0906\u0935\u0947\u0926\u0928 \u0915\u093F\u092F\u093E', viewProfile: '\u092A\u094D\u0930\u094B\u092B\u093E\u0907\u0932 \u0926\u0947\u0916\u0947\u0902', regenerate: 'AI \u0938\u0947 \u092A\u0941\u0928\u0903 \u092C\u0928\u093E\u090F\u0901',
    availability: '\u0909\u092A\u0932\u092C\u094D\u0927\u0924\u093E', openToOverseas: '\u0935\u093F\u0926\u0947\u0936 \u0915\u0947 \u0932\u093F\u090F \u0924\u0948\u092F\u093E\u0930', willingRelocate: '\u0938\u094D\u0925\u093E\u0928\u093E\u0902\u0924\u0930\u0923 \u0915\u094B \u0907\u091A\u094D\u091B\u0941\u0915',
    matchScore: '\u092E\u0948\u091A', verified: '\u0938\u0924\u094D\u092F\u093E\u092A\u093F\u0924', strongMatches: '\u092E\u091C\u092C\u0942\u0924 \u092E\u0948\u091A',
    activeTrainees: '\u0938\u0915\u094D\u0930\u093F\u092F \u092A\u094D\u0930\u0936\u093F\u0915\u094D\u0937\u0941', placements: '\u0928\u093F\u092F\u0941\u0915\u094D\u0924\u093F\u092F\u093E\u0901', matchRate: '\u092E\u0948\u091A \u0926\u0930',
    welcome: '\u0935\u093E\u092A\u0938\u0940 \u092A\u0930 \u0938\u094D\u0935\u093E\u0917\u0924 \u0939\u0948', viewResume: '\u0930\u093F\u091C\u094D\u092F\u0942\u092E\u0947 \u0926\u0947\u0916\u0947\u0902', share: '\u0938\u093E\u0930\u094D\u0935\u091C\u0928\u093F\u0915 \u092A\u094D\u0930\u094B\u092B\u093E\u0907\u0932',
  },
};

let lang = localStorage.getItem('pmmilap_lang') || 'en';
export function getLang() { return lang; }
export function setLang(l) { lang = l; localStorage.setItem('pmmilap_lang', l); }
export function t(key) { return (DICT[lang] && DICT[lang][key]) || DICT.en[key] || key; }

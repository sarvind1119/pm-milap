// app.js — PM-MILAP single-page app: hash router + all views.
import { api, auth, ApiError } from './api.js';
import {
  el, clear, icon, refreshIcons, toast, initials, avatarColor,
  timeAgo, fmtDate, fmtMonth, money, t, getLang, setLang,
} from './ui.js';

const app = document.getElementById('app');

/* ============================================================
   Small shared render components
   ============================================================ */
const spinner = () => el('div.spinner');

function emptyState(iconName, text, sub) {
  return el('div.empty', {}, [
    icon(iconName),
    el('div', { style: { fontWeight: '600', color: 'var(--navy)' }, text }),
    sub ? el('div.tiny.muted', { style: { marginTop: '4px' }, text: sub }) : null,
  ]);
}

function scoreRing(score) {
  const s = Math.round(Number(score) || 0);
  const ring = el('div.score' + (s >= 75 ? '.high' : ''), { style: { '--v': String(s) } }, [
    el('b', { text: String(s) }),
  ]);
  return ring;
}

function chip(text, cls = '') {
  return el('span.chip' + (cls ? '.' + cls : ''), { text });
}

function tag(text, cls) { return el('span.tag.' + cls, { text }); }

function avatar(name, sizeClass = 'av') {
  const a = el('div.' + sizeClass, { text: initials(name) });
  a.style.background = avatarColor(name);
  return a;
}

function sectionTitle(iconName, text, right) {
  return el('div.section-title.between', {}, [
    el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } }, [icon(iconName), text]),
    right || null,
  ]);
}

/* very small Markdown → HTML for AI resume */
function markdownToHtml(md = '') {
  const lines = md.split('\n');
  let html = '', inList = false;
  const inline = (s) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (let raw of lines) {
    const line = raw.trimEnd();
    if (/^#\s+/.test(line)) { closeList(); html += `<h1>${inline(line.replace(/^#\s+/, ''))}</h1>`; }
    else if (/^##\s+/.test(line)) { closeList(); html += `<h2>${inline(line.replace(/^##\s+/, ''))}</h2>`; }
    else if (/^###\s+/.test(line)) { closeList(); html += `<h3>${inline(line.replace(/^###\s+/, ''))}</h3>`; }
    else if (/^[-*]\s+/.test(line)) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`; }
    else if (line === '') { closeList(); }
    else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return html;
}

/* ============================================================
   App state
   ============================================================ */
const state = { notifs: [], unread: 0, notifTimer: null };

function roleHome(role) {
  return ({
    beneficiary: '#/dashboard',
    employer: '#/talent',
    recruiter: '#/talent',
    agent: '#/overseas',
    institute: '#/alumni',
    admin: '#/analytics',
  })[role] || '#/login';
}

/* nav config per role: [key, hash, label, icon] */
function navFor(role) {
  switch (role) {
    case 'beneficiary': return [
      ['dashboard', '#/dashboard', t('dashboard'), 'layout-dashboard'],
      ['profile', '#/profile', t('myProfile'), 'user-round'],
      ['matches', '#/matches', t('myMatches'), 'briefcase'],
      ['upskill', '#/upskill', t('upskill'), 'graduation-cap'],
      ['certificate', '#/certificate', t('certificate'), 'award'],
    ];
    case 'employer': case 'recruiter': return [
      ['talent', '#/talent', t('talentPool'), 'users-round'],
      ['vacancies', '#/vacancies', t('myVacancies'), 'briefcase'],
      ['post', '#/post-vacancy', t('postVacancy'), 'plus-circle'],
    ];
    case 'agent': return [
      ['overseas', '#/overseas', t('overseasRoles'), 'plane'],
      ['candidates', '#/candidates', t('candidates'), 'users-round'],
      ['post', '#/post-overseas', t('postOverseas'), 'plus-circle'],
    ];
    case 'institute': return [
      ['alumni', '#/alumni', t('alumni'), 'graduation-cap'],
    ];
    case 'admin': return [
      ['analytics', '#/analytics', t('analytics'), 'bar-chart-3'],
      ['ingestion', '#/ingestion', t('ingestion'), 'database'],
      ['stakeholders', '#/stakeholders', t('stakeholders'), 'building-2'],
      ['certificates', '#/certificates', t('verifyCerts'), 'shield-check'],
      ['verify', '#/verify', t('verifyCert'), 'search-check'],
    ];
    default: return [];
  }
}

/* ============================================================
   Shell (sidebar + topbar + content)
   ============================================================ */
function renderShell(activeKey, pageTitle) {
  const u = auth.user;
  const items = navFor(u.role);

  const navLinks = items.map(([key, hash, label, ic]) =>
    el('a' + (key === activeKey ? '.active' : ''), { href: hash }, [icon(ic), label]));

  const sidebar = el('aside.sidebar', {}, [
    el('div.brand', {}, [
      el('div.logo', {}, [icon('sparkles')]),
      el('div', {}, [el('h1', { text: 'PM-MILAP' }), el('small', { text: 'Livelihood · Aspiration · Placement' })]),
    ]),
    el('nav.nav', {}, [
      el('div.sec', { text: 'Menu' }),
      ...navLinks,
    ]),
    el('div.who', {}, [
      avatar(u.name),
      el('div', {}, [
        el('div.nm', { text: u.name }),
        el('div.rl', { text: u.role }),
      ]),
    ]),
  ]);

  // bell
  const bellDot = state.unread > 0 ? el('span.dot', { text: state.unread > 9 ? '9+' : String(state.unread) }) : null;
  const bellBtn = el('button.bell', { title: t('notifications'), onclick: toggleNotifPanel }, [icon('bell'), bellDot]);
  const bellWrap = el('div', { style: { position: 'relative' } }, [bellBtn]);

  const langToggle = el('div.lang-toggle', {}, [
    el('button' + (getLang() === 'en' ? '.active' : ''), { text: 'EN', onclick: () => switchLang('en') }),
    el('button' + (getLang() === 'hi' ? '.active' : ''), { text: 'हि', onclick: () => switchLang('hi') }),
  ]);

  const logoutBtn = el('button.btn.btn-ghost.btn-sm', { onclick: doLogout }, [icon('log-out'), t('logout')]);

  const topbar = el('header.topbar', {}, [
    el('div.pgtitle', { text: pageTitle }),
    el('div.grow'),
    langToggle,
    bellWrap,
    logoutBtn,
  ]);

  const content = el('main.content', { id: 'content' }, [spinner()]);

  // mobile bottom nav (first 5 items)
  const mob = el('nav.mobnav', {}, items.slice(0, 5).map(([key, hash, label, ic]) =>
    el('a' + (key === activeKey ? '.active' : ''), { href: hash }, [icon(ic), el('span', { text: label })])));

  clear(app);
  app.appendChild(el('div.tricolor'));
  app.appendChild(el('div.shell', {}, [sidebar, el('div.main', {}, [topbar, content])]));
  app.appendChild(mob);
  refreshIcons();

  // keep bell wrapper reference for the panel
  state.bellWrap = bellWrap;
  ensureAssistant();
  return content;
}

/* ============================================================
   Notifications
   ============================================================ */
async function loadNotifs() {
  if (!auth.isAuthed) return;
  try {
    const { notifications, unread } = await api.notifications();
    state.notifs = notifications;
    state.unread = unread;
    updateBellBadge();
  } catch { /* ignore polling errors */ }
}

function updateBellBadge() {
  if (!state.bellWrap) return;
  const bell = state.bellWrap.querySelector('.bell');
  if (!bell) return;
  let dot = bell.querySelector('.dot');
  if (state.unread > 0) {
    if (!dot) { dot = el('span.dot'); bell.appendChild(dot); }
    dot.textContent = state.unread > 9 ? '9+' : String(state.unread);
  } else if (dot) dot.remove();
}

function notifIcon(type) {
  return ({ match: 'briefcase', overseas: 'plane', upskill: 'trending-up', alumni: 'users-round', system: 'info' })[type] || 'bell';
}

async function toggleNotifPanel() {
  if (!state.bellWrap) return;
  const existing = state.bellWrap.querySelector('.notif-panel');
  if (existing) { existing.remove(); return; }

  const panel = el('div.notif-panel', {}, [
    el('div.hd', {}, [
      el('strong', { text: t('notifications') }),
      el('button.btn.btn-ghost.btn-sm', { onclick: async (e) => { e.stopPropagation(); await api.readAllNotifs(); await loadNotifs(); rebuildNotifList(panel); }, text: t('markAllRead') }),
    ]),
    el('div.notif-list'),
  ]);
  state.bellWrap.appendChild(panel);
  rebuildNotifList(panel);
  refreshIcons();

  // close on outside click
  setTimeout(() => {
    const onDoc = (ev) => {
      if (!state.bellWrap.contains(ev.target)) { panel.remove(); document.removeEventListener('click', onDoc); }
    };
    document.addEventListener('click', onDoc);
  }, 0);
}

function rebuildNotifList(panel) {
  const list = panel.querySelector('.notif-list');
  clear(list);
  if (!state.notifs.length) { list.appendChild(emptyState('bell-off', t('noNotifs'))); refreshIcons(); return; }
  for (const n of state.notifs) {
    const item = el('div.notif-item' + (n.read ? '' : '.unread'), {
      onclick: async () => {
        if (!n.read) { await api.readNotif(n.id); n.read = 1; item.classList.remove('unread'); state.unread = Math.max(0, state.unread - 1); updateBellBadge(); }
        if (n.link) { location.hash = n.link; panel.remove(); }
      },
    }, [
      el('div.ic', {}, [icon(notifIcon(n.type))]),
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('h5', { text: n.title }),
        n.body ? el('p', { text: n.body }) : null,
        el('time', { text: timeAgo(n.created_at) }),
      ]),
    ]);
    list.appendChild(item);
  }
  refreshIcons();
}

function startNotifPolling() {
  if (state.notifTimer) clearInterval(state.notifTimer);
  state.notifTimer = setInterval(loadNotifs, 30000);
}

/* ============================================================
   Auth actions
   ============================================================ */
function switchLang(l) { setLang(l); route(); }

async function doLogin(email, password) {
  const res = await api.login(email, password);
  auth.set(res.token, res.user);
  await loadNotifs();
  startNotifPolling();
  location.hash = roleHome(res.user.role);
}

function doLogout() {
  auth.clear();
  if (state.notifTimer) clearInterval(state.notifTimer);
  state.notifs = []; state.unread = 0;
  removeAssistant();
  location.hash = '#/login';
}

/* ============================================================
   PUBLIC: Landing / Login
   ============================================================ */
async function viewLogin() {
  const demoAccounts = [
    ['Beneficiary', 'ramesh.yadav@pmvikas.demo'],
    ['Employer', 'hr@bharatfab.com'],
    ['Recruiter', 'feed@nationaljobsfeed.in'],
    ['Overseas Agent', 'gulf@skybridge-overseas.com'],
    ['Training Institute', 'rajasthan.iti@pmmilap.gov.in'],
    ['Govt. Admin', 'admin@pmmilap.gov.in'],
  ];

  const emailIn = el('input', { type: 'email', placeholder: 'you@example.com', value: '' });
  const passIn = el('input', { type: 'password', placeholder: '••••••••', value: '' });
  const errBox = el('div.err.tiny', { style: { display: 'none', color: 'var(--danger)', marginBottom: '10px', fontWeight: '600' } });

  const submit = async () => {
    errBox.style.display = 'none';
    try { await doLogin(emailIn.value.trim(), passIn.value); }
    catch (e) { errBox.textContent = e.message; errBox.style.display = 'block'; }
  };

  const demoGrid = el('div.demo-grid', {}, demoAccounts.map(([label, email]) =>
    el('button.demo-btn', {
      onclick: async () => { try { await doLogin(email, 'demo1234'); } catch (e) { toast(e.message, 'err'); } },
    }, [
      el('div.r', { text: label }),
      el('div.n', { text: email }),
    ])));

  const panel = el('div.panel', {}, [
    el('div.lang-toggle', { style: { alignSelf: 'flex-end', marginBottom: '14px' } }, [
      el('button' + (getLang() === 'en' ? '.active' : ''), { text: 'EN', onclick: () => switchLang('en') }),
      el('button' + (getLang() === 'hi' ? '.active' : ''), { text: 'हिंदी', onclick: () => switchLang('hi') }),
    ]),
    el('h2', { text: t('welcome') }),
    el('p.muted', { style: { marginTop: '4px', marginBottom: '8px' }, text: t('quickDemo') }),
    demoGrid,
    el('div.divider', { text: t('orEmail') }),
    errBox,
    el('div.field', {}, [el('label', { text: t('email') }), emailIn]),
    el('div.field', {}, [el('label', { text: t('password') }), passIn]),
    el('button.btn.btn-primary.btn-block', { onclick: submit }, [icon('log-in'), t('signIn')]),
    el('p.tiny.muted', { style: { marginTop: '14px', textAlign: 'center' } }, [
      'Verify a certificate without signing in — ',
      el('a', { href: '#/verify', text: 'open public lookup' }),
    ]),
  ]);

  passIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  const hero = el('div.hero', {}, [
    el('div', {}, [
      el('div.logo', {}, [icon('sparkles')]),
      el('h1', { text: 'India\u2019s certified talent, matched to real opportunity.' }),
      el('p.lede', { text: t('tagline') + '. PM-MILAP turns every PM VIKAS training record into a verified professional profile, then uses AI to connect trainees with jobs, institutes and overseas roles.' }),
    ]),
    el('div.feats', {}, [
      ['shield-check', 'Government-verified skill certificates'],
      ['sparkles', 'AI-generated resumes & semantic job matching'],
      ['plane', 'Domestic & overseas placement pipeline'],
      ['bar-chart-3', 'Live analytics on skills, gaps & placements'],
    ].map(([ic, txt]) => el('div', {}, [icon(ic), el('span', { text: txt })]))),
  ]);

  clear(app);
  app.appendChild(el('div.tricolor'));
  app.appendChild(el('div.auth', {}, [hero, panel]));
  refreshIcons();
}

/* ============================================================
   PUBLIC: Certificate verification
   ============================================================ */
async function viewVerify(vid) {
  const wrap = publicShell(t('verifyCert'), 'shield-check');
  const result = el('div.mt');

  const input = el('input', { placeholder: 'e.g. PMV-ELC-2025-XXXXXX', value: vid || '', style: { textTransform: 'uppercase' } });
  const run = async (id) => {
    clear(result); result.appendChild(spinner()); refreshIcons();
    try {
      const r = await api.verify(id);
      clear(result);
      result.appendChild(certificateCard(r.certificate, r.holder, r.verified));
    } catch (e) {
      clear(result);
      result.appendChild(el('div.card.pad', {}, [
        el('div.row', { style: { color: 'var(--danger)', fontWeight: '700' } }, [icon('x-circle'), 'Not verified']),
        el('p.muted.tiny', { style: { marginTop: '6px' }, text: e.message }),
      ]));
      refreshIcons();
    }
  };

  wrap.querySelector('.pubcard').appendChild(el('div', {}, [
    el('p.muted', { style: { marginBottom: '14px' }, text: 'Enter a certificate verification ID to confirm it was issued under the PM VIKAS scheme.' }),
    el('div.row', {}, [
      input,
      el('button.btn.btn-primary', { onclick: () => run(input.value.trim().toUpperCase()) }, [icon('search'), 'Verify']),
    ]),
    result,
  ]));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(input.value.trim().toUpperCase()); });
  refreshIcons();
  if (vid) run(vid);
}

function certificateCard(cert, holder, verified) {
  return el('div.certificate', {}, [
    el('div.gov', {}, [
      el('div.em', {}, [icon('landmark')]),
      el('div', {}, [
        el('div.cap', { text: 'Government of India' }),
        el('small', { text: cert.issuing_authority || 'PM VIKAS — Ministry of Skill Development & Entrepreneurship' }),
      ]),
    ]),
    el('div.cap', { style: { marginTop: '16px' }, text: 'Certificate of Skill Proficiency' }),
    el('div.holder', { text: holder ? holder.full_name : '—' }),
    el('div.row.wrap', { style: { gap: '8px', marginTop: '6px' } }, [
      chip(cert.trade),
      cert.level ? chip(cert.level, 'skill') : null,
      cert.score != null ? chip('Score ' + cert.score + '/100', 'skill') : null,
    ]),
    el('p.muted.tiny', { style: { marginTop: '12px' } }, [
      holder ? `${holder.training_institute || 'PM VIKAS Centre'} · ${holder.location_city || ''}${holder.location_state ? ', ' + holder.location_state : ''}` : '',
    ]),
    el('p.muted.tiny', {}, ['Issued ' + fmtDate(cert.issue_date)]),
    el('div.row.between.wrap', { style: { marginTop: '16px', alignItems: 'flex-end' } }, [
      el('div', {}, [
        el('div.vid', { text: cert.verification_id }),
        el('div', { style: { marginTop: '12px' } }, [
          verified
            ? el('span.badge-verified', {}, [icon('badge-check'), t('verified')])
            : el('span.badge-verified', { style: { background: '#FCEDE6', color: 'var(--danger)', borderColor: '#F3C7B5' } }, [icon('x-circle'), 'Not verified']),
        ]),
      ]),
      holder ? el('a.btn.btn-ghost.btn-sm', { href: '#/profile/' + holder.id }, [icon('external-link'), 'View profile']) : null,
    ]),
    el('svg.seal', { viewBox: '0 0 100 100', html: sealSvg() }),
  ]);
}

function sealSvg() {
  return `<circle cx="50" cy="50" r="46" fill="none" stroke="#B8862F" stroke-width="2"/>
    <circle cx="50" cy="50" r="38" fill="none" stroke="#B8862F" stroke-width="1" stroke-dasharray="2 3"/>
    <path d="M50 24 L57 42 L76 43 L61 55 L66 74 L50 63 L34 74 L39 55 L24 43 L43 42 Z" fill="#B8862F" opacity="0.9"/>
    <text x="50" y="92" text-anchor="middle" font-size="7" fill="#B8862F" font-family="serif">PM VIKAS</text>`;
}

/* ============================================================
   PUBLIC: shareable profile page
   ============================================================ */
async function viewPublicProfile(id) {
  const wrap = publicShell('Professional Profile', 'user-round');
  const card = wrap.querySelector('.pubcard');
  clear(card); card.appendChild(spinner()); refreshIcons();
  try {
    const { profile: p, certificate } = await api.profile(id);
    clear(card);
    card.appendChild(profileHeader(p));
    if (p.bio) card.appendChild(el('p', { style: { marginTop: '14px', maxWidth: '70ch' }, text: p.bio }));
    if (p.resume_md) {
      card.appendChild(el('div.mt', {}, [el('div.resume', { html: markdownToHtml(p.resume_md) })]));
    }
    if (certificate) {
      card.appendChild(el('div.mt', {}, [certificateCard(certificate, {
        full_name: p.full_name, training_institute: p.training_institute,
        location_city: p.location_city, location_state: p.location_state, id: p.id,
      }, certificate.verified)]));
    }
    refreshIcons();
  } catch (e) {
    clear(card); card.appendChild(emptyState('user-x', 'Profile not found', e.message)); refreshIcons();
  }
}

function profileHeader(p) {
  return el('div.row.wrap', { style: { alignItems: 'flex-start', gap: '16px' } }, [
    (() => { const a = el('div.av', { text: initials(p.full_name), style: { width: '64px', height: '64px', borderRadius: '18px', fontSize: '26px' } }); a.style.background = avatarColor(p.full_name); return a; })(),
    el('div', { style: { flex: '1', minWidth: '0' } }, [
      el('h2', { text: p.full_name }),
      el('p.muted', { text: p.headline || p.trade }),
      el('div.row.wrap', { style: { gap: '8px', marginTop: '10px' } }, [
        chip(p.trade),
        p.location_city ? chip(p.location_city + (p.location_state ? ', ' + p.location_state : ''), 'skill') : null,
        p.assessment_score != null ? chip('Assessed ' + p.assessment_score + '/100', 'skill') : null,
        p.ai_generated ? tag('AI resume', 'recruiter') : null,
      ]),
      el('div.skills', { style: { marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' } },
        (p.skills || []).map((s) => chip(s, 'skill'))),
    ]),
  ]);
}

function publicShell(title, iconName) {
  clear(app);
  app.appendChild(el('div.tricolor'));
  const card = el('div.card.pad.pubcard', { style: { marginTop: '18px' } });
  const wrap = el('div', { style: { maxWidth: '780px', margin: '0 auto', padding: '0 16px 60px', position: 'relative', zIndex: '1' } }, [
    el('div.row.between', { style: { marginTop: '22px' } }, [
      el('div.row', {}, [
        el('div.logo', { style: { width: '40px', height: '40px', borderRadius: '11px', background: 'linear-gradient(135deg,var(--saffron),var(--saffron-600))', display: 'grid', placeItems: 'center' } }, [icon('sparkles', { style: { color: '#fff' } })]),
        el('div', {}, [el('h3', { text: 'PM-MILAP' }), el('div.tiny.muted', { text: title })]),
      ]),
      el('a.btn.btn-ghost.btn-sm', { href: auth.isAuthed ? roleHome(auth.user.role) : '#/login' }, [icon('arrow-left'), auth.isAuthed ? 'Dashboard' : 'Sign in']),
    ]),
    card,
  ]);
  app.appendChild(wrap);
  refreshIcons();
  return wrap;
}

/* ============================================================
   BENEFICIARY views
   ============================================================ */
async function viewDashboard() {
  const content = renderShell('dashboard', t('dashboard'));
  try {
    const d = await api.dashboard();
    clear(content);
    const p = d.profile;

    const hero = el('div.hero-card', {}, [
      el('div.row.between.wrap', { style: { gap: '16px' } }, [
        el('div.row', { style: { alignItems: 'center' } }, [
          el('div.av', { text: initials(p.full_name) }),
          el('div', {}, [
            el('h2', { text: t('welcome') + ', ' + p.full_name.split(' ')[0] + ' 👋' }),
            el('div.sub', { text: p.headline || p.trade }),
          ]),
        ]),
        el('a.btn.btn-accent', { href: '#/profile/' + p.id }, [icon('external-link'), t('share')]),
      ]),
    ]);

    const stats = el('div.grid.g3.mt', {}, [
      statCard(t('myMatches'), d.stats.matches, 'New opportunities', 'briefcase'),
      statCard(t('strongMatches'), d.stats.strong, 'Score 75+', 'flame'),
      statCard(t('notifications'), d.stats.unread, 'Unread', 'bell'),
    ]);

    // top matches as nudges
    const topMatches = (d.matches || []).slice(0, 4);
    const nudges = el('div.grid.g2.mt', {}, topMatches.length
      ? topMatches.map((m) => nudgeForMatch(m))
      : [emptyState('inbox', 'No matches yet', 'Our engine runs every couple of minutes — check back soon.')]);

    const upskillCards = (d.upskill || []).map((s) => el('div.nudge.up', {}, [
      el('div.ic', {}, [icon('trending-up')]),
      el('div', {}, [
        el('h4', { text: 'Upskill: ' + s.skill }),
        el('p', { text: s.reason || `${s.demand || ''} open roles ask for this — add it to unlock more matches.` }),
      ]),
    ]));

    clear(content);
    content.appendChild(hero);
    content.appendChild(stats);
    content.appendChild(el('div.mt', {}, [sectionTitle('sparkles', 'Top matches for you', el('a.btn.btn-ghost.btn-sm', { href: '#/matches' }, ['See all', icon('arrow-right')]))]));
    content.appendChild(nudges);
    if (upskillCards.length) {
      content.appendChild(el('div.mt', {}, [sectionTitle('graduation-cap', 'Suggested upskilling')]));
      content.appendChild(el('div.grid.g3', {}, upskillCards));
    }
    refreshIcons();
  } catch (e) { renderError(content, e); }
}

function statCard(k, v, sub, ic) {
  return el('div.card.stat', {}, [
    el('div.ic', {}, [icon(ic)]),
    el('div.k', { text: k }),
    el('div.v', { text: String(v) }),
    sub ? el('div.sub', { text: sub }) : null,
  ]);
}

function nudgeForMatch(m) {
  const overseas = m.target_type === 'overseas';
  return el('div.nudge' + (overseas ? '.ov' : ''), {}, [
    el('div.ic', {}, [icon(overseas ? 'plane' : 'briefcase')]),
    el('div', { style: { flex: '1', minWidth: '0' } }, [
      el('div.row.between', {}, [
        el('h4', { text: m.title || (overseas ? 'Overseas role' : 'Job opening') }),
        scoreRing(m.score),
      ]),
      el('p', { text: [m.poster, m.place].filter(Boolean).join(' · ') }),
      m.reason ? el('div.reason', { text: m.reason }) : null,
    ]),
  ]);
}

async function viewMatches() {
  const content = renderShell('matches', t('myMatches'));
  try {
    const d = await api.dashboard();
    clear(content);
    if (!d.matches.length) { content.appendChild(emptyState('inbox', 'No matches yet')); refreshIcons(); return; }
    const list = el('div.card', {}, d.matches.map((m) => matchRow(m)));
    content.appendChild(list);
    refreshIcons();
  } catch (e) { renderError(content, e); }
}

function matchRow(m) {
  const overseas = m.target_type === 'overseas';
  const applied = m.status === 'applied';
  const btn = el('button.btn.btn-sm' + (applied ? '.btn-ghost' : '.btn-primary'), { disabled: applied }, [
    icon(applied ? 'check' : 'send'), applied ? t('applied') : t('apply'),
  ]);
  btn.addEventListener('click', async () => {
    try { await api.apply(m.id); btn.disabled = true; btn.className = 'btn btn-sm btn-ghost'; clear(btn); btn.append(icon('check'), document.createTextNode(' ' + t('applied'))); refreshIcons(); toast('Application sent', 'ok'); }
    catch (e) { toast(e.message, 'err'); }
  });
  return el('div.opp', {}, [
    scoreRing(m.score),
    el('div.meta', {}, [
      el('div.row', { style: { gap: '8px', alignItems: 'center' } }, [
        el('h4', { text: m.title || (overseas ? 'Overseas role' : 'Job opening') }),
        overseas ? tag('Overseas', 'overseas') : tag('Local', 'local'),
      ]),
      el('div.sub', {}, [
        m.poster ? el('span', {}, [icon('building-2'), m.poster]) : null,
        m.place ? el('span', {}, [icon('map-pin'), m.place]) : null,
        m.wage ? el('span', {}, [icon('wallet'), money(m.wage, m.cur || '₹') + (overseas ? '/mo' : '')]) : null,
      ]),
      m.reason ? el('div.reason', { text: m.reason }) : null,
    ]),
    btn,
  ]);
}

async function viewProfile() {
  const content = renderShell('profile', t('myProfile'));
  try {
    const d = await api.dashboard();
    clear(content);
    const p = d.profile;

    // availability controls
    const availSel = el('select', {}, ['available', 'employed', 'training'].map((o) =>
      el('option', { value: o, selected: p.availability === o, text: o[0].toUpperCase() + o.slice(1) })));
    const relocate = toggle(t('willingRelocate'), !!p.willing_relocate);
    const overseas = toggle(t('openToOverseas'), !!p.willing_overseas);

    const saveBtn = el('button.btn.btn-primary', { onclick: async () => {
      try {
        await api.updateProfile({
          availability: availSel.value,
          willing_relocate: relocate.input.checked ? 1 : 0,
          willing_overseas: overseas.input.checked ? 1 : 0,
        });
        toast('Profile updated', 'ok');
      } catch (e) { toast(e.message, 'err'); }
    } }, [icon('save'), 'Save preferences']);

    const regenBtn = el('button.btn.btn-accent', {}, [icon('sparkles'), t('regenerate')]);
    const resumeBox = el('div.resume', { html: markdownToHtml(p.resume_md || '') });
    const bioBox = el('p', { style: { maxWidth: '70ch' }, text: p.bio || '' });
    regenBtn.addEventListener('click', async () => {
      regenBtn.disabled = true; const orig = regenBtn.innerHTML; regenBtn.innerHTML = ''; regenBtn.append(spinnerInline(), document.createTextNode(' Generating…'));
      try {
        const r = await api.regenerateAI(p.id);
        resumeBox.innerHTML = markdownToHtml(r.resume_md || '');
        bioBox.textContent = r.bio || '';
        toast(r.source === 'llm' ? 'Regenerated with live LLM' : 'Regenerated (offline fallback)', 'ok');
      } catch (e) { toast(e.message, 'err'); }
      finally { regenBtn.disabled = false; regenBtn.innerHTML = orig; refreshIcons(); }
    });

    content.appendChild(el('div.card.pad', {}, [
      profileHeader(p),
      el('div.divider', { text: 'About' }),
      bioBox,
    ]));

    content.appendChild(el('div.grid.g2.mt', {}, [
      el('div.card.pad', {}, [
        sectionTitle('settings-2', 'Preferences'),
        el('div.field', {}, [el('label', { text: t('availability') }), availSel]),
        relocate.node,
        overseas.node,
        el('div.mt', {}, [saveBtn]),
      ]),
      el('div.card.pad', {}, [
        sectionTitle('award', t('certificate')),
        d.certificate ? miniCert(d.certificate, p) : emptyState('award', 'No certificate'),
      ]),
    ]));

    content.appendChild(el('div.mt', {}, [sectionTitle('file-text', 'AI-generated resume', regenBtn)]));
    content.appendChild(resumeBox);
    refreshIcons();
  } catch (e) { renderError(content, e); }
}

function miniCert(cert, p) {
  return el('div', {}, [
    el('div.row.between.wrap', {}, [
      el('div', {}, [
        el('div.tiny.muted', { text: cert.trade + (cert.level ? ' · ' + cert.level : '') }),
        el('div.vid', { style: { marginTop: '8px' }, text: cert.verification_id }),
      ]),
      cert.verified ? el('span.badge-verified', {}, [icon('badge-check'), t('verified')]) : null,
    ]),
    el('a.btn.btn-ghost.btn-sm', { href: '#/certificate', style: { marginTop: '14px' } }, [icon('eye'), 'View full certificate']),
  ]);
}

function toggle(label, checked) {
  const input = el('input', { type: 'checkbox', checked: checked ? true : null, style: { width: 'auto' } });
  const node = el('label.row', { style: { gap: '10px', cursor: 'pointer', marginBottom: '10px', fontWeight: '600', color: 'var(--ink)' } }, [input, label]);
  return { node, input };
}

async function viewCertificate() {
  const content = renderShell('certificate', t('certificate'));
  try {
    const d = await api.dashboard();
    clear(content);
    if (!d.certificate) { content.appendChild(emptyState('award', 'No certificate issued yet')); refreshIcons(); return; }
    content.appendChild(certificateCard(d.certificate, {
      full_name: d.profile.full_name, training_institute: d.profile.training_institute,
      location_city: d.profile.location_city, location_state: d.profile.location_state, id: d.profile.id,
    }, d.certificate.verified));
    content.appendChild(el('p.muted.tiny.mt', {}, [
      'Anyone can confirm this certificate at the ',
      el('a', { href: '#/verify/' + d.certificate.verification_id, text: 'public verification page' }), '.',
    ]));
    refreshIcons();
  } catch (e) { renderError(content, e); }
}

async function viewUpskill() {
  const content = renderShell('upskill', t('upskill'));
  try {
    const d = await api.dashboard();
    clear(content);
    content.appendChild(el('div.card.pad', {}, [
      el('p.muted', { text: 'Skills in demand across open roles that you can add to unlock more matches.' }),
    ]));
    const cards = (d.upskill || []).map((s) => el('div.nudge.up', {}, [
      el('div.ic', {}, [icon('trending-up')]),
      el('div', { style: { flex: '1' } }, [
        el('h4', { text: s.skill }),
        el('p', { text: s.reason || `${s.demand || 'Several'} open roles ask for this skill.` }),
        s.demand != null ? el('div.bar.demand', { style: { marginTop: '8px' } }, [el('span', { style: { width: Math.min(100, s.demand * 18) + '%' } })]) : null,
      ]),
    ]));
    content.appendChild(el('div.grid.g2.mt', {}, cards.length ? cards : [emptyState('check-circle', 'Your skill set already covers current demand')]));
    refreshIcons();
  } catch (e) { renderError(content, e); }
}

/* ============================================================
   EMPLOYER / RECRUITER / AGENT — talent pool
   ============================================================ */
let talentFacets = null;
async function viewTalent(activeKey = 'talent') {
  const content = renderShell(activeKey, t('talentPool'));
  const q = el('input', { placeholder: t('search') + ' name, trade or skill…' });
  const tradeSel = el('select', {}, [el('option', { value: '', text: 'All trades' })]);
  const stateSel = el('select', {}, [el('option', { value: '', text: 'All states' })]);
  const availSel = el('select', {}, [
    el('option', { value: '', text: 'Any availability' }),
    el('option', { value: 'available', text: 'Available' }),
    el('option', { value: 'employed', text: 'Employed' }),
  ]);
  const overseasChk = el('input', { type: 'checkbox', style: { width: 'auto' } });
  const relocateChk = el('input', { type: 'checkbox', style: { width: 'auto' } });
  const results = el('div.grid.g3.mt');

  const search = async () => {
    clear(results); results.appendChild(spinner()); refreshIcons();
    try {
      const r = await api.talent({
        q: q.value.trim(), trade: tradeSel.value, state: stateSel.value,
        availability: availSel.value, overseas: overseasChk.checked ? '1' : '', relocate: relocateChk.checked ? '1' : '',
      });
      if (!talentFacets) {
        talentFacets = r.facets;
        for (const tr of r.facets.trades) tradeSel.appendChild(el('option', { value: tr, text: tr }));
        for (const st of r.facets.states) stateSel.appendChild(el('option', { value: st, text: st }));
      }
      clear(results);
      if (!r.candidates.length) { results.appendChild(emptyState('user-x', 'No candidates match these filters')); refreshIcons(); return; }
      r.candidates.forEach((c) => results.appendChild(candidateCard(c)));
      refreshIcons();
    } catch (e) { renderError(results, e); }
  };

  [tradeSel, stateSel, availSel].forEach((s) => s.addEventListener('change', search));
  [overseasChk, relocateChk].forEach((s) => s.addEventListener('change', search));
  q.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

  clear(content);
  content.appendChild(el('div.card.pad', {}, [
    el('div.row.wrap', { style: { gap: '10px' } }, [
      el('div', { style: { flex: '2', minWidth: '180px' } }, [q]),
      el('div', { style: { flex: '1', minWidth: '130px' } }, [tradeSel]),
      el('div', { style: { flex: '1', minWidth: '130px' } }, [stateSel]),
      el('div', { style: { flex: '1', minWidth: '130px' } }, [availSel]),
      el('button.btn.btn-primary', { onclick: search }, [icon('search'), t('search')]),
    ]),
    el('div.row.wrap', { style: { gap: '18px', marginTop: '12px' } }, [
      el('label.row', { style: { gap: '8px', fontWeight: '600' } }, [overseasChk, t('openToOverseas')]),
      el('label.row', { style: { gap: '8px', fontWeight: '600' } }, [relocateChk, t('willingRelocate')]),
    ]),
  ]));
  content.appendChild(results);
  refreshIcons();
  if (talentPrefill) { q.value = talentPrefill; talentPrefill = ''; }
  search();
}

function candidateCard(c) {
  const av = el('div.av', { text: initials(c.full_name) }); av.style.background = avatarColor(c.full_name);
  return el('div.card.cand', {}, [
    el('div.head', {}, [
      av,
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('h4', { style: { fontSize: '16px' }, text: c.full_name }),
        el('div.tiny.muted', { text: c.trade + ' · ' + (c.location_city || c.location_state || '') }),
      ]),
      c.assessment_score != null ? scoreRing(c.assessment_score) : null,
    ]),
    el('div.skills', {}, (c.skills || []).slice(0, 5).map((s) => chip(s, 'skill'))),
    el('div.row.wrap', { style: { gap: '6px' } }, [
      c.availability === 'available' ? chip('Available', 'skill') : chip(c.availability, 'skill'),
      c.willing_overseas ? tag('Overseas', 'overseas') : null,
      c.willing_relocate ? tag('Relocate', 'local') : null,
    ]),
    c.verification_id ? el('div.row.between', { style: { borderTop: '1px solid var(--line)', paddingTop: '12px' } }, [
      el('span.badge-verified', {}, [icon('badge-check'), 'Verified']),
      el('a.btn.btn-ghost.btn-sm', { href: '#/profile/' + c.id }, [icon('external-link'), t('viewProfile')]),
    ]) : el('a.btn.btn-ghost.btn-sm.btn-block', { href: '#/profile/' + c.id }, [icon('external-link'), t('viewProfile')]),
  ]);
}

async function viewMyVacancies() {
  const content = renderShell('vacancies', t('myVacancies'));
  try {
    const { vacancies } = await api.myVacancies();
    clear(content);
    content.appendChild(el('div.row.between.mb', {}, [
      el('div.muted', { text: vacancies.length + ' posting' + (vacancies.length === 1 ? '' : 's') }),
      el('a.btn.btn-primary.btn-sm', { href: '#/post-vacancy' }, [icon('plus'), t('postVacancy')]),
    ]));
    if (!vacancies.length) { content.appendChild(emptyState('briefcase', 'No vacancies yet', 'Post one to start matching candidates.')); refreshIcons(); return; }
    for (const v of vacancies) content.appendChild(vacancyCard(v));
    refreshIcons();
  } catch (e) { renderError(content, e); }
}

function vacancyCard(v) {
  const matchesBox = el('div');
  const toggleBtn = el('button.btn.btn-ghost.btn-sm', {}, [icon('users-round'), `${v.match_count} matched`]);
  let open = false;
  toggleBtn.addEventListener('click', async () => {
    open = !open;
    if (!open) { clear(matchesBox); return; }
    clear(matchesBox); matchesBox.appendChild(spinnerInline()); 
    try {
      const { matches } = await api.vacancyMatches(v.id);
      clear(matchesBox);
      if (!matches.length) { matchesBox.appendChild(el('p.muted.tiny', { text: 'No candidate matches yet.' })); return; }
      matches.forEach((m) => matchesBox.appendChild(candidateMatchRow(m)));
      refreshIcons();
    } catch (e) { clear(matchesBox); matchesBox.appendChild(el('p.tiny', { style: { color: 'var(--danger)' }, text: e.message })); }
  });
  return el('div.card.pad.mb', {}, [
    el('div.row.between.wrap', {}, [
      el('div', {}, [
        el('h4', { text: v.title }),
        el('div.tiny.muted', { style: { marginTop: '4px' }, text: [v.trade, (v.location_city || '') + (v.location_state ? ', ' + v.location_state : ''), v.positions + ' position' + (v.positions === 1 ? '' : 's')].filter(Boolean).join(' · ') }),
      ]),
      el('div.row', { style: { gap: '8px' } }, [
        v.source === 'recruiter' ? tag('Recruiter', 'recruiter') : tag('Direct', 'local'),
        toggleBtn,
      ]),
    ]),
    (v.skills_required || []).length ? el('div.skills', { style: { marginTop: '10px' } }, v.skills_required.map((s) => chip(s, 'skill'))) : null,
    matchesBox,
  ]);
}

function candidateMatchRow(m) {
  return el('div.opp', { style: { paddingLeft: '0', paddingRight: '0' } }, [
    scoreRing(m.score),
    el('div.meta', {}, [
      el('h4', { text: m.full_name }),
      el('div.sub', {}, [
        el('span', {}, [icon('briefcase'), m.trade]),
        el('span', {}, [icon('map-pin'), (m.location_city || '') + (m.location_state ? ', ' + m.location_state : '')]),
        el('span', {}, [icon('gauge'), 'Assessed ' + (m.assessment_score ?? '—')]),
      ]),
      m.reason ? el('div.reason', { text: m.reason }) : null,
    ]),
    el('a.btn.btn-ghost.btn-sm', { href: '#/profile/' + m.beneficiary_id }, [icon('external-link'), t('viewProfile')]),
  ]);
}

async function viewPostVacancy() {
  const content = renderShell('post', t('postVacancy'));
  clear(content);
  const f = {};
  const field = (key, label, opts = {}) => {
    const input = opts.type === 'textarea' ? el('textarea', { rows: 3, placeholder: opts.ph || '' })
      : el('input', { type: opts.type || 'text', placeholder: opts.ph || '' });
    f[key] = input;
    return el('div.field', {}, [el('label', { text: label }), input]);
  };
  const submit = async () => {
    const body = {
      title: f.title.value.trim(), trade: f.trade.value.trim(),
      skills_required: f.skills.value.split(',').map((s) => s.trim()).filter(Boolean),
      location_state: f.state.value.trim(), location_city: f.city.value.trim(),
      wage_min: Number(f.wage_min.value) || null, wage_max: Number(f.wage_max.value) || null,
      positions: Number(f.positions.value) || 1, certification_required: f.cert.value.trim(),
      description: f.desc.value.trim(),
    };
    if (!body.title || !body.trade) { toast('Title and trade are required', 'err'); return; }
    try {
      await api.postVacancy(body);
      toast('Vacancy posted — matching will run shortly', 'ok');
      location.hash = '#/vacancies';
    } catch (e) { toast(e.message, 'err'); }
  };
  content.appendChild(el('div.card.pad', { style: { maxWidth: '680px' } }, [
    sectionTitle('plus-circle', t('postVacancy')),
    field('title', 'Job title', { ph: 'e.g. Site Electrician' }),
    el('div.grid.g2', {}, [field('trade', 'Trade', { ph: 'Electrician' }), field('cert', 'Certification required', { ph: 'PM VIKAS Electrician' })]),
    field('skills', 'Required skills (comma-separated)', { ph: 'Wiring, Conduit Bending, Safety' }),
    el('div.grid.g2', {}, [field('state', 'State', { ph: 'Maharashtra' }), field('city', 'City', { ph: 'Pune' })]),
    el('div.grid.g3', {}, [field('wage_min', 'Wage min (₹)', { type: 'number' }), field('wage_max', 'Wage max (₹)', { type: 'number' }), field('positions', 'Positions', { type: 'number', ph: '1' })]),
    field('desc', 'Description', { type: 'textarea', ph: 'Role responsibilities…' }),
    el('div.mt', {}, [el('button.btn.btn-primary', { onclick: submit }, [icon('send'), 'Post vacancy'])]),
  ]));
  refreshIcons();
}

/* ---------------- AGENT ---------------- */
async function viewOverseas() {
  const content = renderShell('overseas', t('overseasRoles'));
  try {
    const { overseas } = await api.myOverseas();
    clear(content);
    content.appendChild(el('div.row.between.mb', {}, [
      el('div.muted', { text: overseas.length + ' opportunit' + (overseas.length === 1 ? 'y' : 'ies') }),
      el('a.btn.btn-primary.btn-sm', { href: '#/post-overseas' }, [icon('plus'), t('postOverseas')]),
    ]));
    if (!overseas.length) { content.appendChild(emptyState('plane', 'No overseas roles yet')); refreshIcons(); return; }
    for (const o of overseas) content.appendChild(overseasCard(o));
    refreshIcons();
  } catch (e) { renderError(content, e); }
}

function overseasCard(o) {
  const matchesBox = el('div');
  const toggleBtn = el('button.btn.btn-ghost.btn-sm', {}, [icon('users-round'), `${o.match_count} matched`]);
  let open = false;
  toggleBtn.addEventListener('click', async () => {
    open = !open;
    if (!open) { clear(matchesBox); return; }
    clear(matchesBox); matchesBox.appendChild(spinnerInline());
    try {
      const r = await api.talent({ trade: o.trade, overseas: '1' });
      clear(matchesBox);
      if (!r.candidates.length) { matchesBox.appendChild(el('p.muted.tiny', { text: 'No overseas-ready candidates in this trade yet.' })); return; }
      r.candidates.slice(0, 6).forEach((c) => matchesBox.appendChild(candidateMatchRow({
        beneficiary_id: c.id, full_name: c.full_name, trade: c.trade, location_city: c.location_city,
        location_state: c.location_state, assessment_score: c.assessment_score, score: c.assessment_score,
      })));
      refreshIcons();
    } catch (e) { clear(matchesBox); matchesBox.appendChild(el('p.tiny', { style: { color: 'var(--danger)' }, text: e.message })); }
  });
  return el('div.card.pad.mb', {}, [
    el('div.row.between.wrap', {}, [
      el('div', {}, [
        el('div.row', { style: { gap: '8px' } }, [el('h4', { text: o.title }), tag('Overseas', 'overseas')]),
        el('div.tiny.muted', { style: { marginTop: '4px' }, text: [o.country, o.visa_type, o.trade].filter(Boolean).join(' · ') }),
      ]),
      el('div.row', { style: { gap: '8px', alignItems: 'center' } }, [
        o.monthly_wage ? chip(money(o.monthly_wage, o.currency || 'USD') + '/mo', 'skill') : null,
        toggleBtn,
      ]),
    ]),
    (o.skills_required || []).length ? el('div.skills', { style: { marginTop: '10px' } }, o.skills_required.map((s) => chip(s, 'skill'))) : null,
    matchesBox,
  ]);
}

async function viewCandidates() { return viewTalent('candidates'); }

async function viewPostOverseas() {
  const content = renderShell('post', t('postOverseas'));
  clear(content);
  const f = {};
  const field = (key, label, opts = {}) => {
    const input = opts.type === 'textarea' ? el('textarea', { rows: 3, placeholder: opts.ph || '' })
      : el('input', { type: opts.type || 'text', placeholder: opts.ph || '' });
    f[key] = input;
    return el('div.field', {}, [el('label', { text: label }), input]);
  };
  const submit = async () => {
    const body = {
      title: f.title.value.trim(), trade: f.trade.value.trim(), country: f.country.value.trim(),
      visa_type: f.visa.value.trim(), monthly_wage: Number(f.wage.value) || null, currency: f.currency.value.trim() || 'USD',
      skills_required: f.skills.value.split(',').map((s) => s.trim()).filter(Boolean),
      positions: Number(f.positions.value) || 1, description: f.desc.value.trim(),
    };
    if (!body.title || !body.trade || !body.country) { toast('Title, trade and country are required', 'err'); return; }
    try { await api.postOverseas(body); toast('Overseas opportunity posted', 'ok'); location.hash = '#/overseas'; }
    catch (e) { toast(e.message, 'err'); }
  };
  content.appendChild(el('div.card.pad', { style: { maxWidth: '680px' } }, [
    sectionTitle('plus-circle', t('postOverseas')),
    field('title', 'Role title', { ph: 'e.g. Structural Welder — GCC' }),
    el('div.grid.g2', {}, [field('trade', 'Trade', { ph: 'Welder' }), field('country', 'Country', { ph: 'UAE' })]),
    el('div.grid.g2', {}, [field('visa', 'Visa type', { ph: 'Employment (2 yr)' }), field('positions', 'Positions', { type: 'number', ph: '1' })]),
    el('div.grid.g2', {}, [field('wage', 'Monthly wage', { type: 'number', ph: '1500' }), field('currency', 'Currency', { ph: 'USD' })]),
    field('skills', 'Required skills (comma-separated)', { ph: 'MIG Welding, Blueprint Reading' }),
    field('desc', 'Description', { type: 'textarea' }),
    el('div.mt', {}, [el('button.btn.btn-primary', { onclick: submit }, [icon('send'), 'Post opportunity'])]),
  ]));
  refreshIcons();
}

/* ============================================================
   INSTITUTE
   ============================================================ */
async function viewAlumni() {
  const content = renderShell('alumni', t('alumni'));
  try {
    const { institute, alumni, stats } = await api.alumni();
    clear(content);
    content.appendChild(el('div.card.pad.mb', {}, [
      el('h3', { text: institute.name }),
      el('div.tiny.muted', { text: [institute.location_city, institute.location_state, institute.accreditation_id].filter(Boolean).join(' · ') }),
    ]));
    content.appendChild(el('div.grid.g4', {}, [
      statCard('Total alumni', stats.total, null, 'users-round'),
      statCard('Matched', stats.matched, 'Have ≥1 match', 'sparkles'),
      statCard('Placed', stats.placed, 'In employment', 'check-circle'),
      statCard('Avg. score', stats.avg_score, 'Assessment', 'gauge'),
    ]));
    const rows = alumni.map((a) => el('tr', {}, [
      el('td', {}, [el('a', { href: '#/profile/' + a.id, text: a.full_name })]),
      el('td', { text: a.trade }),
      el('td', { text: (a.location_city || '') + (a.location_state ? ', ' + a.location_state : '') }),
      el('td', { text: String(a.assessment_score ?? '—') }),
      el('td', { text: String(a.matches) }),
      el('td', {}, [a.placed ? el('span.badge-verified', { style: { fontSize: '11px' } }, [icon('check'), 'Placed']) : chip(a.availability, 'skill')]),
    ]));
    content.appendChild(el('div.card.pad.mt', {}, [
      sectionTitle('graduation-cap', 'Alumni outcomes'),
      el('div', { style: { overflowX: 'auto' } }, [
        el('table.tbl', {}, [
          el('thead', {}, [el('tr', {}, ['Name', 'Trade', 'Location', 'Score', 'Matches', 'Status'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, rows),
        ]),
      ]),
    ]));
    refreshIcons();
  } catch (e) { renderError(content, e); }
}

/* ============================================================
   ADMIN
   ============================================================ */
const charts = {};
function destroyCharts() { Object.values(charts).forEach((c) => { try { c.destroy(); } catch {} }); for (const k in charts) delete charts[k]; }

async function viewAnalytics() {
  const content = renderShell('analytics', t('analytics'));
  try {
    const a = await api.analytics();
    destroyCharts();
    clear(content);

    // LLM status pill
    const llm = a.llm || {};
    const pill = el('span.llm-pill.' + (llm.online ? 'on' : 'off'), {}, [el('span.d'), llm.online ? 'LLM online · ' + (llm.model || '') : 'LLM offline · deterministic fallback']);
    const testBtn = el('button.btn.btn-ghost.btn-sm', {}, [icon('plug-zap'), 'Test connection']);
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true; const orig = testBtn.innerHTML; testBtn.innerHTML = ''; testBtn.append(spinnerInline(), document.createTextNode(' Testing…'));
      try {
        const r = await api.testLLM();
        if (r.online) {
          pill.className = 'llm-pill on'; clear(pill); pill.append(el('span.d'), document.createTextNode('LLM online · ' + (r.status?.model || '')));
          toast('LLM connected — model replied "' + String(r.sample || '').slice(0, 30) + '"', 'ok');
        } else {
          pill.className = 'llm-pill off'; clear(pill); pill.append(el('span.d'), document.createTextNode('LLM offline · deterministic fallback'));
          toast('Still offline: ' + (r.lastError || 'unknown error'), 'err');
        }
      } catch (e) { toast(e.message, 'err'); }
      finally { testBtn.disabled = false; testBtn.innerHTML = orig; refreshIcons(); }
    });
    content.appendChild(el('div.row.between.wrap.mb', {}, [el('div.muted', {}, ['Scheme-wide performance ', el('span.tiny', { style: { opacity: '.5' }, text: '· build 0601c' })]), el('div.row', { style: { gap: '8px', alignItems: 'center' } }, [pill, testBtn])]));

    content.appendChild(el('div.grid.g4', {}, [
      statCard(t('activeTrainees'), a.totals.active, 'of ' + a.totals.trainees + ' total', 'users-round'),
      statCard(t('placements'), a.funnel.placed, 'cumulative', 'check-circle'),
      statCard(t('matchRate'), a.totals.match_rate + '%', a.totals.matches + ' matches', 'target'),
      statCard('Open roles', a.totals.vacancies + a.totals.overseas, a.totals.vacancies + ' local · ' + a.totals.overseas + ' overseas', 'briefcase'),
    ]));

    // charts row — each canvas MUST sit in a fixed-height, position:relative box,
    // otherwise Chart.js (maintainAspectRatio:false) grows it on every redraw.
    const placeCanvas = el('canvas', { style: { display: 'block' } });
    const funnelCanvas = el('canvas', { style: { display: 'block' } });
    const chartBox = (canvas, h = 260) => el('div', { style: { position: 'relative', height: h + 'px', width: '100%', overflow: 'hidden' } }, [canvas]);
    content.appendChild(el('div.grid.g2.mt', {}, [
      el('div.card.pad', {}, [sectionTitle('line-chart', 'Placements over time'), chartBox(placeCanvas)]),
      el('div.card.pad', {}, [sectionTitle('filter', 'Match-to-placement funnel'), chartBox(funnelCanvas)]),
    ]));

    // skill gaps
    const gapCanvas = el('canvas', { style: { display: 'block' } });
    content.appendChild(el('div.card.pad.mt', {}, [sectionTitle('alert-triangle', 'Top skill gaps (demand vs supply)'), chartBox(gapCanvas, 320)]));

    // regional table
    content.appendChild(el('div.card.pad.mt', {}, [
      sectionTitle('map', 'Regional skill availability'),
      el('div', { style: { overflowX: 'auto' } }, [
        el('table.tbl', {}, [
          el('thead', {}, [el('tr', {}, ['State', 'Trainees', 'Avg. score'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, a.regional.map((r) => el('tr', {}, [
            el('td', { text: r.state }), el('td', { text: String(r.trainees) }), el('td', { text: String(r.avg_score ?? '—') }),
          ]))),
        ]),
      ]),
    ]));
    refreshIcons();

    // draw charts (Chart.js)
    const navy = '#102A56', saffron = '#F4811F', green = '#0F7B3E';
    charts.place = new Chart(placeCanvas, {
      type: 'line',
      data: {
        labels: a.series.map((s) => fmtMonth(s.ym)),
        datasets: [{ label: 'Placements', data: a.series.map((s) => s.n), borderColor: saffron, backgroundColor: 'rgba(244,129,31,.12)', fill: true, tension: .35, pointRadius: 3, pointBackgroundColor: saffron }],
      },
      options: chartOpts(),
    });
    charts.funnel = new Chart(funnelCanvas, {
      type: 'bar',
      data: {
        labels: ['Trainees', 'Matched', 'Applied', 'Placed'],
        datasets: [{ data: [a.funnel.trainees, a.funnel.matched, a.funnel.applied, a.funnel.placed], backgroundColor: [navy, '#2155b8', saffron, green], borderRadius: 8 }],
      },
      options: chartOpts({ legend: false }),
    });
    charts.gap = new Chart(gapCanvas, {
      type: 'bar',
      data: {
        labels: a.gaps.map((g) => g.skill),
        datasets: [
          { label: 'Demand', data: a.gaps.map((g) => g.demand), backgroundColor: navy, borderRadius: 6 },
          { label: 'Supply', data: a.gaps.map((g) => g.supply), backgroundColor: saffron, borderRadius: 6 },
        ],
      },
      options: chartOpts({ indexAxis: 'y' }),
    });
  } catch (e) { renderError(content, e); }
}

function chartOpts(extra = {}) {
  const grid = { color: 'rgba(16,42,86,.06)' };
  return {
    responsive: true, maintainAspectRatio: false,
    indexAxis: extra.indexAxis || 'x',
    plugins: { legend: extra.legend === false ? { display: false } : { labels: { font: { family: 'Mukta' }, color: '#4B5768' } } },
    scales: {
      x: { grid: extra.indexAxis === 'y' ? grid : { display: false }, ticks: { font: { family: 'Mukta' }, color: '#4B5768' } },
      y: { grid, ticks: { font: { family: 'Mukta' }, color: '#4B5768', precision: 0 }, beginAtZero: true },
    },
  };
}

async function viewIngestion() {
  const content = renderShell('ingestion', t('ingestion'));
  clear(content);
  const sample = {
    candidate_id: 'PMV-DEMO-001', full_name: 'Anita Verma', trade: 'Solar PV Technician',
    skills: ['Panel Installation', 'Wiring', 'Maintenance'], assessment_score: 88,
    training_institute: 'Rajasthan Skill Institute', accreditation_id: 'TI-RJ-012',
    completion_date: '2026-04-20', location_state: 'Rajasthan', location_city: 'Jaipur',
    languages: ['Hindi', 'English'], willing_overseas: true,
  };
  const ta = el('textarea', { rows: 14, style: { fontFamily: 'ui-monospace, monospace', fontSize: '13px' } });
  ta.value = JSON.stringify([sample], null, 2);
  const useLLM = el('input', { type: 'checkbox', style: { width: 'auto' } });
  const out = el('div.mt');

  const ingest = async () => {
    let records;
    try { records = JSON.parse(ta.value); } catch { toast('Invalid JSON', 'err'); return; }
    if (!Array.isArray(records)) records = [records];
    clear(out); out.appendChild(spinnerInline());
    try {
      const r = await api.ingest(records, useLLM.checked);
      clear(out);
      out.appendChild(el('div.card.pad', {}, [
        el('div.row', { style: { color: 'var(--green)', fontWeight: '700' } }, [icon('check-circle'), `Ingested ${r.ingested} of ${r.results.length} record(s)`]),
        el('div.mt', {}, r.results.map((res) => el('div.tiny.muted', { text: (res.created ? '✓ ' : '• ') + (res.full_name || res.candidate_id || '') + (res.verification_id ? ' → ' + res.verification_id : '') + (res.created ? '' : ' (skipped: ' + (res.reason || 'exists') + ')') }))),
      ]));
      await api.runMatching(false).catch(() => {});
      toast('Records ingested & matching refreshed', 'ok');
      refreshIcons();
    } catch (e) { clear(out); renderError(out, e); }
  };

  content.appendChild(el('div.card.pad', {}, [
    sectionTitle('database', 'Simulate government training-DB feed'),
    el('p.muted.tiny', { style: { marginBottom: '12px' }, text: 'Paste one or more training records (JSON array). Each creates a beneficiary profile, AI resume, and a verified certificate.' }),
    ta,
    el('div.row.between.wrap', { style: { marginTop: '12px' } }, [
      el('label.row', { style: { gap: '8px', fontWeight: '600' } }, [useLLM, 'Use live LLM for resume/bio (slower; falls back if offline)']),
      el('button.btn.btn-primary', { onclick: ingest }, [icon('upload'), 'Ingest records']),
    ]),
    out,
  ]));
  refreshIcons();
}

async function viewStakeholders() {
  const content = renderShell('stakeholders', t('stakeholders'));
  try {
    const { users } = await api.stakeholders();
    clear(content);
    const rows = users.map((u) => {
      const statusChip = el('span');
      const paint = (s) => { clear(statusChip); statusChip.appendChild(s === 'active' ? el('span.badge-verified', { style: { fontSize: '11px' } }, [icon('check'), 'Active']) : chip(s, 'skill')); refreshIcons(); };
      paint(u.status);
      const act = (status) => async () => { try { await api.setStatus(u.id, status); paint(status); toast('Updated ' + u.name, 'ok'); } catch (e) { toast(e.message, 'err'); } };
      return el('tr', {}, [
        el('td', { text: u.name }),
        el('td', {}, [chip(u.role, 'skill')]),
        el('td', { text: u.email }),
        el('td', {}, [statusChip]),
        el('td', {}, [el('div.row', { style: { gap: '6px' } }, [
          el('button.btn.btn-ghost.btn-sm', { onclick: act('active'), title: 'Activate' }, [icon('check')]),
          el('button.btn.btn-ghost.btn-sm', { onclick: act('suspended'), title: 'Suspend' }, [icon('ban')]),
        ])]),
      ]);
    });
    content.appendChild(el('div.card.pad', {}, [
      sectionTitle('building-2', 'Registered stakeholders'),
      el('div', { style: { overflowX: 'auto' } }, [
        el('table.tbl', {}, [
          el('thead', {}, [el('tr', {}, ['Name', 'Role', 'Email', 'Status', ''].map((h) => el('th', { text: h })))]),
          el('tbody', {}, rows),
        ]),
      ]),
    ]));
    refreshIcons();
  } catch (e) { renderError(content, e); }
}

async function viewAdminCertificates() {
  const content = renderShell('certificates', t('verifyCerts'));
  try {
    const { certificates } = await api.certificates();
    clear(content);
    const rows = certificates.map((c) => {
      const badge = el('span');
      const paint = (v) => { clear(badge); badge.appendChild(v ? el('span.badge-verified', { style: { fontSize: '11px' } }, [icon('badge-check'), 'Verified']) : chip('Revoked', 'skill')); refreshIcons(); };
      paint(c.verified);
      const toggleV = async () => { try { const nv = c.verified ? 0 : 1; await api.setCertVerified(c.id, nv); c.verified = nv; paint(nv); toast('Updated', 'ok'); } catch (e) { toast(e.message, 'err'); } };
      return el('tr', {}, [
        el('td', {}, [el('a', { href: '#/profile/' + c.beneficiary_id, text: c.full_name })]),
        el('td', { text: c.trade }),
        el('td', {}, [el('code', { style: { fontSize: '12px' }, text: c.verification_id })]),
        el('td', { text: fmtDate(c.issue_date) }),
        el('td', {}, [badge]),
        el('td', {}, [el('button.btn.btn-ghost.btn-sm', { onclick: toggleV }, [icon('repeat'), 'Toggle'])]),
      ]);
    });
    content.appendChild(el('div.card.pad', {}, [
      sectionTitle('shield-check', 'Issued certificates'),
      el('p.muted.tiny', { style: { marginBottom: '12px' } }, ['Public lookup available at ', el('a', { href: '#/verify' }, ['the verification page']), '.']),
      el('div', { style: { overflowX: 'auto' } }, [
        el('table.tbl', {}, [
          el('thead', {}, [el('tr', {}, ['Holder', 'Trade', 'Verification ID', 'Issued', 'Status', ''].map((h) => el('th', { text: h })))]),
          el('tbody', {}, rows),
        ]),
      ]),
    ]));
    refreshIcons();
  } catch (e) { renderError(content, e); }
}

// Admin in-app verify (reuses public verify card inside shell)
async function viewAdminVerify() {
  const content = renderShell('verify', t('verifyCert'));
  clear(content);
  const result = el('div.mt');
  const input = el('input', { placeholder: 'PMV-XXX-2025-XXXXXX', style: { textTransform: 'uppercase' } });
  const run = async (id) => {
    if (!id) return;
    clear(result); result.appendChild(spinnerInline());
    try { const r = await api.verify(id); clear(result); result.appendChild(certificateCard(r.certificate, r.holder, r.verified)); refreshIcons(); }
    catch (e) { clear(result); renderError(result, e); }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(input.value.trim().toUpperCase()); });
  content.appendChild(el('div.card.pad', {}, [
    sectionTitle('search-check', t('verifyCert')),
    el('div.row', {}, [input, el('button.btn.btn-primary', { onclick: () => run(input.value.trim().toUpperCase()) }, [icon('search'), 'Verify'])]),
    result,
  ]));
  refreshIcons();
}

/* ============================================================
   Helpers: inline spinner, error
   ============================================================ */
function spinnerInline() { const s = el('span.spinner', { style: { width: '20px', height: '20px', margin: '0', display: 'inline-block', borderWidth: '2px', verticalAlign: 'middle' } }); return s; }

function renderError(container, e) {
  clear(container);
  const msg = e instanceof ApiError ? e.message : (e.message || 'Something went wrong');
  container.appendChild(el('div.card.pad', {}, [
    el('div.row', { style: { color: 'var(--danger)', fontWeight: '700' } }, [icon('alert-circle'), 'Error']),
    el('p.muted.tiny', { style: { marginTop: '6px' }, text: msg }),
  ]));
  refreshIcons();
}

/* ============================================================
   AI Assistant — floating, data-aware, streaming, action-capable
   ============================================================ */
const assistant = { open: false, history: [], lastPrompt: null, greeted: false, els: {} };
let talentPrefill = '';

function assistantChips() {
  const role = auth.user?.role;
  return ({
    beneficiary: ['What are my best job matches?', 'How can I improve my profile?', 'Open my certificate'],
    employer: ['Find welders', 'Show my vacancies', 'Which posting has the most matches?'],
    recruiter: ['Find electricians', 'Show my vacancies', 'Open the talent pool'],
    agent: ['Show candidates open to overseas', 'My overseas postings'],
    institute: ['How are my alumni doing?', 'Open alumni outcomes'],
    admin: ['What are the top skill gaps?', 'Run the matching engine', 'Show analytics'],
  })[role] || ['What can you do?'];
}

function ensureAssistant() {
  if (!auth.isAuthed) return;
  if (document.getElementById('asst-bubble')) return;
  const bubble = el('button.asst-bubble#asst-bubble', { title: 'Ask the PM-MILAP assistant', onclick: toggleAssistant }, [
    icon('sparkles'), el('span.nudge-dot'),
  ]);
  document.body.appendChild(bubble);
  refreshIcons();
}
function removeAssistant() {
  document.getElementById('asst-bubble')?.remove();
  document.getElementById('asst-panel')?.remove();
  assistant.open = false; assistant.greeted = false; assistant.history = [];
}

function toggleAssistant() {
  if (assistant.open) { document.getElementById('asst-panel')?.remove(); assistant.open = false; return; }
  openAssistant();
}

function openAssistant() {
  assistant.open = true;
  const body = el('div.asst-body#asst-body');
  const input = el('textarea', { rows: 1, placeholder: 'Ask me anything…' });
  const sendBtn = el('button.send', { title: 'Send', onclick: () => submitAssistant(input) }, [icon('send')]);
  const statusDot = el('span.st#asst-status', {}, [el('span.d'), 'connecting…']);

  const panel = el('div.asst-panel#asst-panel', {}, [
    el('div.asst-hd', {}, [
      el('div.ava', {}, [icon('sparkles')]),
      el('div', {}, [el('h4', { text: 'PM-MILAP Assistant' }), statusDot]),
      el('div.grow'),
      el('button', { title: 'Clear', onclick: () => { assistant.history = []; assistant.greeted = false; clear(body); greetAssistant(body); } }, [icon('eraser')]),
      el('button', { title: 'Close', onclick: toggleAssistant }, [icon('x')]),
    ]),
    body,
    el('div.asst-foot', {}, [input, sendBtn]),
  ]);
  assistant.els = { body, input, sendBtn };
  document.body.appendChild(panel);
  refreshIcons();

  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAssistant(input); } });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(90, input.scrollHeight) + 'px'; });
  input.focus();

  greetAssistant(body);
  // reflect live LLM status in the header dot
  api.systemStatus().then((s) => {
    const st = document.getElementById('asst-status');
    if (!st) return;
    if (s.llm?.online) { st.className = 'st on'; st.lastChild.textContent = ' AI model online'; }
    else { st.className = 'st'; st.lastChild.textContent = ' offline · smart fallback'; }
  }).catch(() => {});
}

function greetAssistant(body) {
  if (assistant.greeted) return;
  assistant.greeted = true;
  const name = (auth.user?.name || '').split(' ')[0];
  addBotMessage(body, `Hi ${name}! I'm your PM-MILAP assistant. I can see your live dashboard data and help you get around. Try one of these:`, null, null);
  const chips = el('div.asst-chips', {}, assistantChips().map((c) =>
    el('button.asst-chip', { text: c, onclick: () => { assistant.els.input.value = c; submitAssistant(assistant.els.input); } })));
  body.appendChild(chips);
  body.scrollTop = body.scrollHeight;
}

function addUserMessage(body, text) {
  body.appendChild(el('div.asst-msg.user', { text }));
  body.scrollTop = body.scrollHeight;
}
function addBotMessage(body, text, source) {
  const msg = el('div.asst-msg.bot', {}, [el('span.bot-text', { text: text || '' })]);
  if (source) msg.appendChild(el('span.src.' + source, {}, [icon(source === 'llm' ? 'sparkles' : 'cpu'), source === 'llm' ? 'AI model' : 'fallback']));
  body.appendChild(msg);
  body.scrollTop = body.scrollHeight;
  refreshIcons();
  return msg;
}

async function submitAssistant(input) {
  const text = input.value.trim();
  if (!text) return;
  input.value = ''; input.style.height = 'auto';
  const body = assistant.els.body;
  // remove any greeting chips
  body.querySelector('.asst-chips')?.remove();
  addUserMessage(body, text);
  assistant.history.push({ role: 'user', content: text });
  assistant.els.sendBtn.disabled = true;

  const typing = el('div.asst-typing', {}, [el('span'), el('span'), el('span')]);
  body.appendChild(typing); body.scrollTop = body.scrollHeight;

  let botMsg = null, botTextEl = null, raw = '', source = 'llm', metaPrompt = null;
  const ensureBotMsg = () => {
    if (botMsg) return;
    typing.remove();
    botMsg = addBotMessage(body, '', null);
    botTextEl = botMsg.querySelector('.bot-text');
  };
  const renderRaw = () => { botTextEl.textContent = raw.split('§ACTION§')[0].trimEnd(); body.scrollTop = body.scrollHeight; };

  try {
    const res = await fetch('/api/assistant/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.token },
      body: JSON.stringify({ message: text, history: assistant.history.slice(0, -1) }),
    });
    if (!res.ok || !res.body) throw new Error('assistant unavailable');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', doneData = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split('\n\n'); buf = blocks.pop() || '';
      for (const block of blocks) {
        let ev = null, data = null;
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) ev = line.slice(6).trim();
          else if (line.startsWith('data:')) data = line.slice(5).trim();
        }
        if (!data) continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        if (ev === 'meta') { metaPrompt = j.prompt; assistant.lastPrompt = j.prompt; }
        else if (ev === 'done') { doneData = j; }
        else if (j.token) { ensureBotMsg(); raw += j.token; renderRaw(); }
      }
    }
    ensureBotMsg();
    source = doneData?.source || 'llm';
    // source badge
    if (source) botMsg.appendChild(el('span.src.' + source, {}, [icon(source === 'llm' ? 'sparkles' : 'cpu'), source === 'llm' ? 'AI model' : 'fallback']));
    refreshIcons();
    // "show the prompt" teaching toggle
    if (metaPrompt) addPromptToggle(botMsg, metaPrompt);
    // record assistant reply (cleaned) into history
    assistant.history.push({ role: 'assistant', content: raw.split('§ACTION§')[0].trim() });
    assistant.history = assistant.history.slice(-8);
    // execute any action after a short beat so the reply is read first
    if (doneData?.action) setTimeout(() => runAssistantAction(doneData.action), 550);
  } catch (e) {
    typing.remove();
    addBotMessage(body, 'Sorry — I could not reach the assistant service. ' + e.message, 'fallback');
  } finally {
    assistant.els.sendBtn.disabled = false;
  }
}

function addPromptToggle(botMsg, prompt) {
  const toggle = el('span.asst-toggle-prompt', {}, [icon('code'), 'Show the prompt sent to the model']);
  const pre = el('div.asst-prompt', { style: { display: 'none' } });
  pre.textContent = prompt.map((m) => `[${m.role}]\n${m.content}`).join('\n\n');
  let shown = false;
  toggle.addEventListener('click', () => {
    shown = !shown; pre.style.display = shown ? 'block' : 'none';
    toggle.lastChild.textContent = shown ? 'Hide the prompt' : 'Show the prompt sent to the model';
    assistant.els.body.scrollTop = assistant.els.body.scrollHeight;
  });
  botMsg.after(pre);
  botMsg.after(toggle);
  refreshIcons();
}

function runAssistantAction(action) {
  if (!action) return;
  if (action.type === 'navigate') {
    if (location.hash === action.to) route(); else location.hash = action.to;
    toast('Opening ' + action.to.replace('#/', ''), 'ok');
  } else if (action.type === 'search_talent') {
    talentPrefill = action.trade || '';
    const dest = auth.user.role === 'agent' ? '#/candidates' : '#/talent';
    if ((location.hash || '').startsWith(dest)) (dest === '#/candidates' ? viewCandidates() : viewTalent('talent'));
    else location.hash = dest;
    if (action.trade) toast('Searching talent: ' + action.trade, 'ok');
  } else if (action.type === 'run_matching') {
    toast('Running the matching engine…');
    api.runMatching(false).then(() => {
      toast('Matching engine run complete', 'ok');
      if ((location.hash || '').startsWith('#/analytics')) viewAnalytics();
    }).catch((e) => toast(e.message, 'err'));
  }
}


const ROUTES = {
  'dashboard': { roles: ['beneficiary'], view: viewDashboard },
  'profile': { roles: ['beneficiary'], view: viewProfile },
  'matches': { roles: ['beneficiary'], view: viewMatches },
  'upskill': { roles: ['beneficiary'], view: viewUpskill },
  'certificate': { roles: ['beneficiary'], view: viewCertificate },
  'talent': { roles: ['employer', 'recruiter'], view: () => viewTalent('talent') },
  'vacancies': { roles: ['employer', 'recruiter'], view: viewMyVacancies },
  'post-vacancy': { roles: ['employer', 'recruiter'], view: viewPostVacancy },
  'overseas': { roles: ['agent'], view: viewOverseas },
  'candidates': { roles: ['agent'], view: viewCandidates },
  'post-overseas': { roles: ['agent'], view: viewPostOverseas },
  'alumni': { roles: ['institute'], view: viewAlumni },
  'analytics': { roles: ['admin'], view: viewAnalytics },
  'ingestion': { roles: ['admin'], view: viewIngestion },
  'stakeholders': { roles: ['admin'], view: viewStakeholders },
  'certificates': { roles: ['admin'], view: viewAdminCertificates },
};

async function route() {
  const hash = location.hash || '';
  const parts = hash.replace(/^#\//, '').split('/');
  const head = parts[0] || '';
  const sub = parts[1] ? decodeURIComponent(parts[1]) : '';

  // Logged-in admin gets the in-shell verify tool for the bare #/verify nav item.
  // (A specific #/verify/:vid deep-link still uses the standalone public lookup.)
  if (head === 'verify' && !sub && auth.isAuthed && auth.user.role === 'admin') {
    return viewAdminVerify();
  }

  // Public routes (no auth required).
  if (head === 'login') { if (auth.isAuthed) { location.hash = roleHome(auth.user.role); return; } return viewLogin(); }
  if (head === 'verify') return viewVerify(sub);
  if (head === 'profile' && sub) return viewPublicProfile(sub);

  // Everything else requires auth.
  if (!auth.isAuthed) { location.hash = '#/login'; return; }
  if (!head) { location.hash = roleHome(auth.user.role); return; }

  const r = ROUTES[head];
  if (!r) { location.hash = roleHome(auth.user.role); return; }
  if (!r.roles.includes(auth.user.role)) { location.hash = roleHome(auth.user.role); return; }
  return r.view();
}

window.addEventListener('hashchange', route);

/* ============================================================
   Boot
   ============================================================ */
(async function boot() {
  console.log('PM-MILAP build 20260601c (AI assistant)');
  // validate token if present
  if (auth.isAuthed) {
    try { const me = await api.me(); auth.set(auth.token, { id: me.user.id, role: me.user.role, name: me.user.name, email: me.user.email }); await loadNotifs(); startNotifPolling(); }
    catch { auth.clear(); }
  }
  if (!location.hash) location.hash = auth.isAuthed ? roleHome(auth.user.role) : '#/login';
  else route();
})();

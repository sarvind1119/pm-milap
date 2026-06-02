// src/db.js — SQLite connection + schema.
//
// Works on any Node 18/20/22 with NO native compilation:
//   • Node 22.5+  → uses the fast built-in `node:sqlite` (DatabaseSync).
//   • Older Node  → transparently falls back to `sql.js` (SQLite compiled to
//                   WebAssembly, pure JS), persisting to the same .sqlite file.
// Both backends are exposed behind one identical synchronous interface
// (`run` / `get` / `all` / `initSchema` / `resetDb`), so nothing else in the
// app needs to know or care which engine is active.
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'pm-milap.sqlite');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Backend selection: honour an explicit override, else prefer node:sqlite.
const FORCE = (process.env.DB_BACKEND || '').toLowerCase(); // 'node' | 'sqljs' | ''

let backend;          // 'node' | 'sqljs'
let _exec;            // (sql) => void           — run a multi-statement script
let _run;             // (sql, params[]) => {lastInsertRowid, changes}
let _get;             // (sql, params[]) => row | undefined
let _all;             // (sql, params[]) => row[]
export let db;        // underlying engine handle (compat export)

async function tryNodeSqlite() {
  const { DatabaseSync } = await import('node:sqlite');
  const d = new DatabaseSync(DB_PATH);
  d.exec('PRAGMA journal_mode = WAL;');
  d.exec('PRAGMA foreign_keys = ON;');
  const num = (v) => (typeof v === 'bigint' ? Number(v) : v);
  _exec = (sql) => d.exec(sql);
  _run = (sql, p) => { const r = d.prepare(sql).run(...p); return { lastInsertRowid: num(r.lastInsertRowid), changes: num(r.changes) }; };
  _get = (sql, p) => d.prepare(sql).get(...p);
  _all = (sql, p) => d.prepare(sql).all(...p);
  db = d;
  backend = 'node';
}

async function trySqlJs() {
  const initSqlJs = require('sql.js');
  const distDir = path.dirname(require.resolve('sql.js/dist/sql-wasm.js'));
  const SQL = await initSqlJs({ locateFile: (f) => path.join(distDir, f) });
  const bytes = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  const d = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
  d.run('PRAGMA foreign_keys = ON;');

  const persist = () => fs.writeFileSync(DB_PATH, Buffer.from(d.export()));
  // sql.js only binds number | string | null | Uint8Array. Coerce the values
  // that the built-in node:sqlite engine tolerates: undefined → null, bool → 0/1.
  const clean = (p) => (p || []).map((v) =>
    v === undefined ? null : v === true ? 1 : v === false ? 0 : v);
  const queryAll = (sql, p) => {
    const stmt = d.prepare(sql);
    try {
      const c = clean(p);
      if (c.length) stmt.bind(c);
      const out = [];
      while (stmt.step()) out.push(stmt.getAsObject());
      return out;
    } finally { stmt.free(); }
  };

  _exec = (sql) => { d.exec(sql); persist(); };
  _run = (sql, p) => {
    const c = clean(p);
    d.run(sql, c.length ? c : undefined);
    const meta = d.exec('SELECT last_insert_rowid() AS id, changes() AS ch');
    let lastInsertRowid = 0, changes = 0;
    if (meta.length && meta[0].values.length) { [lastInsertRowid, changes] = meta[0].values[0]; }
    persist();
    return { lastInsertRowid, changes };
  };
  _get = (sql, p) => queryAll(sql, p)[0];
  _all = (sql, p) => queryAll(sql, p);
  db = d;
  backend = 'sqljs';
}

// ── initialise the chosen backend (top-level await; resolves before import completes) ──
if (FORCE === 'sqljs') {
  await trySqlJs();
} else if (FORCE === 'node') {
  await tryNodeSqlite();
} else {
  try { await tryNodeSqlite(); }
  catch { await trySqlJs(); }
}

export function dbInfo() { return { backend, path: DB_PATH }; }

export function initSchema() {
  _exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    role          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    profile_json  TEXT DEFAULT '{}',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS beneficiary_profiles (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    full_name        TEXT NOT NULL,
    trade            TEXT NOT NULL,
    skills           TEXT NOT NULL DEFAULT '[]',
    training_institute TEXT,
    institute_id     INTEGER,
    training_center  TEXT,
    completion_date  TEXT,
    assessment_score INTEGER,
    location_state   TEXT,
    location_city    TEXT,
    phone            TEXT,
    languages        TEXT DEFAULT '[]',
    headline         TEXT,
    bio              TEXT,
    resume_md        TEXT,
    availability     TEXT DEFAULT 'available',
    willing_relocate INTEGER DEFAULT 0,
    willing_overseas INTEGER DEFAULT 0,
    photo_seed       TEXT,
    ai_generated     INTEGER DEFAULT 0,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS certificates (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    beneficiary_id    INTEGER REFERENCES beneficiary_profiles(id) ON DELETE CASCADE,
    trade             TEXT NOT NULL,
    level             TEXT,
    score             INTEGER,
    issue_date        TEXT,
    verification_id   TEXT UNIQUE NOT NULL,
    issuing_authority TEXT DEFAULT 'PM VIKAS — Ministry of Skill Development & Entrepreneurship',
    verified          INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS skills_trades (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT UNIQUE NOT NULL,
    category TEXT
  );

  CREATE TABLE IF NOT EXISTS training_institutes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name           TEXT NOT NULL,
    location_state TEXT,
    location_city  TEXT,
    accreditation_id TEXT
  );

  CREATE TABLE IF NOT EXISTS vacancies (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    employer_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    source          TEXT DEFAULT 'employer',
    title           TEXT NOT NULL,
    trade           TEXT,
    skills_required TEXT DEFAULT '[]',
    location_state  TEXT,
    location_city   TEXT,
    wage_min        INTEGER,
    wage_max        INTEGER,
    positions       INTEGER DEFAULT 1,
    certification_required TEXT,
    description     TEXT,
    status          TEXT DEFAULT 'open',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS overseas_opportunities (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    trade           TEXT,
    country         TEXT,
    visa_type       TEXT,
    monthly_wage    INTEGER,
    currency        TEXT DEFAULT 'USD',
    skills_required TEXT DEFAULT '[]',
    positions       INTEGER DEFAULT 1,
    description     TEXT,
    status          TEXT DEFAULT 'open',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    beneficiary_id INTEGER REFERENCES beneficiary_profiles(id) ON DELETE CASCADE,
    target_type   TEXT NOT NULL,
    target_id     INTEGER NOT NULL,
    score         INTEGER NOT NULL,
    reason        TEXT,
    source        TEXT DEFAULT 'heuristic',
    status        TEXT DEFAULT 'new',
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(beneficiary_id, target_type, target_id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT,
    title       TEXT NOT NULL,
    body        TEXT,
    link        TEXT,
    icon        TEXT DEFAULT 'bell',
    read        INTEGER DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS placements (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    beneficiary_id INTEGER REFERENCES beneficiary_profiles(id) ON DELETE CASCADE,
    target_type   TEXT,
    target_id     INTEGER,
    employer_user_id INTEGER,
    trade         TEXT,
    placed_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_match_ben   ON matches(beneficiary_id);
  CREATE INDEX IF NOT EXISTS idx_notif_user  ON notifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_vac_status  ON vacancies(status);
  `);
}

// ── unified tiny helpers (variadic params, like better-sqlite3 / node:sqlite) ──
export const all = (sql, ...p) => _all(sql, p);
export const get = (sql, ...p) => _get(sql, p);
export const run = (sql, ...p) => _run(sql, p);

export function resetDb() {
  const tables = ['placements', 'notifications', 'matches', 'overseas_opportunities',
    'vacancies', 'certificates', 'beneficiary_profiles', 'training_institutes',
    'skills_trades', 'users'];
  _exec(tables.map((t) => `DROP TABLE IF EXISTS ${t};`).join('\n'));
  initSchema();
}

export { DB_PATH };

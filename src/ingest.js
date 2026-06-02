// src/ingest.js — simulates ingesting a government training record and
// auto-generating a beneficiary profile + verified certificate.
import { get, run } from './db.js';
import { hashPassword } from './auth.js';
import { generateBio, generateResume } from './llm.js';

const rand = (n) => Math.floor(Math.random() * n);
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = (n = 6) => Array.from({ length: n }, () => CHARS[rand(CHARS.length)]).join('');

const TRADE_ABBR = {
  Welder: 'WLD', Electrician: 'ELC', Plumber: 'PLM', 'Solar PV Technician': 'SPV',
  'CNC Machinist': 'CNC', 'Sewing Machine Operator': 'SMO', Beautician: 'BTN',
  'Mobile Repair Technician': 'MRT', 'Automotive Service Technician': 'AST',
  'Healthcare Assistant': 'HCA', 'Data Entry Operator': 'DEO', Mason: 'MSN',
};

export function makeVerificationId(trade, year = 2025) {
  const ab = TRADE_ABBR[trade] || trade.slice(0, 3).toUpperCase();
  return `PMV-${ab}-${year}-${code(6)}`;
}

// Ingest one record. Returns { profileId, userId, verificationId, created }.
// useLLM=false keeps it fast/offline (deterministic fallback content).
export async function ingestRecord(rec, { useLLM = false } = {}) {
  const email = rec.email || `${(rec.name || 'trainee').toLowerCase().replace(/[^a-z]+/g, '.')}@pmvikas.demo`;
  const existing = get('SELECT id FROM users WHERE email=?', email);
  if (existing) {
    const bp = get('SELECT id FROM beneficiary_profiles WHERE user_id=?', existing.id);
    const cert = get('SELECT verification_id FROM certificates WHERE beneficiary_id=?', bp?.id);
    return { userId: existing.id, profileId: bp?.id, verificationId: cert?.verification_id, created: false };
  }

  // 1. base user (auto-generated, no manual sign-up)
  const ures = run(
    'INSERT INTO users (role, email, password_hash, name, status, profile_json) VALUES (?,?,?,?,?,?)',
    'beneficiary', email, hashPassword('demo1234'), rec.name, 'active',
    JSON.stringify({ candidate_id: rec.candidate_id, auto_generated: true })
  );
  const userId = ures.lastInsertRowid;

  // link institute if present
  let instituteId = null;
  if (rec.institute_code) {
    const inst = get('SELECT id FROM training_institutes WHERE accreditation_id=?', rec.institute_code);
    instituteId = inst?.id || null;
  }

  const year = (rec.completion_date || '2025').slice(0, 4);

  // 2. bio/headline + resume (LLM with deterministic fallback)
  const profileSeed = {
    full_name: rec.name, trade: rec.trade, skills: rec.skills || [],
    assessment_score: rec.assessment_score, training_institute: rec.training_institute,
    location_city: rec.city, location_state: rec.state, completion_date: rec.completion_date,
    languages: rec.languages || [], phone: rec.phone,
    willing_relocate: rec.willing_relocate ? 1 : 0, willing_overseas: rec.willing_overseas ? 1 : 0,
    availability: 'available',
  };
  const bio = await generateBio(profileSeed, useLLM);
  const resume = await generateResume(profileSeed, useLLM);
  const aiFlag = (bio.ai && resume.ai) ? 1 : 0;

  // 3. beneficiary profile
  const pres = run(`INSERT INTO beneficiary_profiles
    (user_id, full_name, trade, skills, training_institute, institute_id, training_center,
     completion_date, assessment_score, location_state, location_city, phone, languages,
     headline, bio, resume_md, availability, willing_relocate, willing_overseas, photo_seed, ai_generated)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    userId, rec.name, rec.trade, JSON.stringify(rec.skills || []), rec.training_institute,
    instituteId, rec.training_center, rec.completion_date, rec.assessment_score, rec.state,
    rec.city, rec.phone, JSON.stringify(rec.languages || []), bio.headline, bio.bio, resume.resume,
    'available', rec.willing_relocate ? 1 : 0, rec.willing_overseas ? 1 : 0,
    (rec.name || 'x').replace(/\s+/g, ''), aiFlag);
  const profileId = pres.lastInsertRowid;

  // 4. verified government certificate
  const vid = makeVerificationId(rec.trade, Number(year));
  run(`INSERT INTO certificates (beneficiary_id, trade, level, score, issue_date, verification_id, verified)
       VALUES (?,?,?,?,?,?,1)`,
    profileId, rec.trade, rec.certificate_level || 'NSQF Level 4', rec.assessment_score,
    rec.completion_date, vid);

  return { userId, profileId, verificationId: vid, created: true, ai: !!aiFlag };
}

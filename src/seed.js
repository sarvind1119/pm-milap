// src/seed.js — populate realistic mock data for every role.
// Run directly with `node src/seed.js --reset` or imported by server bootstrap.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { db, get, run, all, initSchema, resetDb } from './db.js';
import { hashPassword } from './auth.js';
import { ingestRecord } from './ingest.js';
import { runMatching } from './matching.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_PW = 'demo1234';

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function makeUser(role, email, name, profile = {}) {
  const r = run('INSERT INTO users (role, email, password_hash, name, status, profile_json) VALUES (?,?,?,?,?,?)',
    role, email, hashPassword(DEMO_PW), name, 'active', JSON.stringify(profile));
  return r.lastInsertRowid;
}

const SKILLS = [
  ['Arc Welding', 'Welding'], ['MIG Welding', 'Welding'], ['TIG Welding', 'Welding'],
  ['Pipe Welding', 'Welding'], ['Metal Fabrication', 'Welding'], ['Domestic Wiring', 'Electrical'],
  ['Industrial Wiring', 'Electrical'], ['Solar Panel Installation', 'Renewable'],
  ['Inverter Wiring', 'Renewable'], ['CNC Programming', 'Manufacturing'], ['G-Code', 'Manufacturing'],
  ['Patient Care', 'Healthcare'], ['First Aid', 'Healthcare'], ['Pipe Fitting', 'Plumbing'],
  ['Engine Diagnostics', 'Automotive'], ['Industrial Stitching', 'Apparel'], ['MS Excel', 'IT'],
  ['Hardware Repair', 'Electronics'], ['Soldering', 'Electronics'], ['Bridal Makeup', 'Wellness'],
];

export async function seed({ reset = false, useLLM = false, verbose = true } = {}) {
  if (reset) resetDb(); else initSchema();
  if (get('SELECT COUNT(*) n FROM users').n > 0 && !reset) {
    if (verbose) console.log('[seed] data already present — skipping');
    return;
  }

  // ── skills / trades reference table ──
  for (const [name, category] of SKILLS) {
    run('INSERT OR IGNORE INTO skills_trades (name, category) VALUES (?,?)', name, category);
  }

  // ── Admin (Government) ──
  makeUser('admin', 'admin@pmmilap.gov.in', 'Scheme Administrator', { dept: 'MSDE — PM VIKAS Cell' });

  // ── Training Institutes (with linked login accounts) ──
  const institutes = [
    { name: 'Rajasthan Skill Mission ITI', code: 'TI-RJ-012', state: 'Rajasthan', city: 'Jaipur', email: 'rajasthan.iti@pmmilap.gov.in' },
    { name: 'Kerala Polytechnic Skill Academy', code: 'TI-KL-003', state: 'Kerala', city: 'Kochi', email: 'kerala.academy@pmmilap.gov.in' },
    { name: 'Maharashtra Advanced Manufacturing ITI', code: 'TI-MH-009', state: 'Maharashtra', city: 'Pune', email: 'maharashtra.iti@pmmilap.gov.in' },
  ];
  for (const inst of institutes) {
    const uid = makeUser('institute', inst.email, inst.name, { accreditation_id: inst.code });
    run('INSERT INTO training_institutes (user_id, name, location_state, location_city, accreditation_id) VALUES (?,?,?,?,?)',
      uid, inst.name, inst.state, inst.city, inst.code);
  }
  // institutes referenced by ingestion records but without a login (still verifiable)
  for (const [name, code, state, city] of [
    ['Bihar Apparel Training Centre', 'TI-BR-007', 'Bihar', 'Patna'],
    ['Delhi Wellness Skill Institute', 'TI-DL-019', 'Delhi', 'New Delhi'],
    ['Tamil Nadu Allied Health Academy', 'TI-TN-021', 'Tamil Nadu', 'Chennai'],
    ['Punjab Industrial Training Institute', 'TI-PB-005', 'Punjab', 'Ludhiana'],
    ['Jharkhand Digital Skill Centre', 'TI-JH-014', 'Jharkhand', 'Ranchi'],
    ['Telangana Electronics Skill Academy', 'TI-TG-016', 'Telangana', 'Hyderabad'],
    ['Andhra Renewable Skill Institute', 'TI-AP-011', 'Andhra Pradesh', 'Visakhapatnam'],
    ['Uttar Pradesh Construction Skill ITI', 'TI-UP-002', 'Uttar Pradesh', 'Lucknow'],
    ['Gujarat Automotive Skill Centre', 'TI-GJ-008', 'Gujarat', 'Ahmedabad'],
  ]) {
    run('INSERT INTO training_institutes (user_id, name, location_state, location_city, accreditation_id) VALUES (NULL,?,?,?,?)',
      name, state, city, code);
  }

  // ── Employers + vacancies ──
  const e1 = makeUser('employer', 'hr@bharatfab.com', 'Bharat Fabrication Industries', { company_name: 'Bharat Fabrication Industries', sector: 'Manufacturing', state: 'Gujarat', city: 'Ahmedabad' });
  const e2 = makeUser('employer', 'careers@greenvolt.in', 'GreenVolt Energy Pvt Ltd', { company_name: 'GreenVolt Energy Pvt Ltd', sector: 'Renewable Energy', state: 'Tamil Nadu', city: 'Chennai' });
  const e3 = makeUser('employer', 'jobs@meditrust.in', 'MediTrust Hospitals', { company_name: 'MediTrust Hospitals', sector: 'Healthcare', state: 'Maharashtra', city: 'Mumbai' });
  // Recruiter / vacancy notification service
  const rec1 = makeUser('recruiter', 'feed@nationaljobsfeed.in', 'National Jobs Feed', { company_name: 'National Jobs Feed (Aggregator)' });

  const vac = (employer, source, v) => run(
    `INSERT INTO vacancies (employer_user_id, source, title, trade, skills_required, location_state, location_city, wage_min, wage_max, positions, certification_required, description, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    employer, source, v.title, v.trade, JSON.stringify(v.skills), v.state, v.city, v.wage_min, v.wage_max, v.positions, v.cert || null, v.desc, daysAgo(v.age || 5)
  );

  vac(e1, 'employer', { title: 'Fabrication Welder (MIG/Arc)', trade: 'Welder', skills: ['MIG Welding', 'Arc Welding', 'Metal Fabrication', 'Blueprint Reading'], state: 'Gujarat', city: 'Ahmedabad', wage_min: 22000, wage_max: 32000, positions: 8, cert: 'NSQF Level 4 Welder', desc: 'Structural fabrication unit hiring certified welders for heavy steel work. Two shifts. PPE and hostel provided.', age: 3 });
  vac(e1, 'employer', { title: 'CNC Machine Operator', trade: 'CNC Machinist', skills: ['CNC Programming', 'G-Code', 'Precision Measurement'], state: 'Gujarat', city: 'Ahmedabad', wage_min: 26000, wage_max: 38000, positions: 4, desc: 'Operate and program CNC lathes for precision components.', age: 6 });
  vac(e2, 'employer', { title: 'Solar PV Installation Technician', trade: 'Solar PV Technician', skills: ['Solar Panel Installation', 'Inverter Wiring', 'Electrical Safety', 'Rooftop Mounting'], state: 'Tamil Nadu', city: 'Chennai', wage_min: 20000, wage_max: 28000, positions: 12, desc: 'Rooftop and ground-mount solar installs across Tamil Nadu. Field role, travel allowance included.', age: 2 });
  vac(e2, 'employer', { title: 'Site Electrician — Renewable Projects', trade: 'Electrician', skills: ['Industrial Wiring', 'Panel Wiring', 'Circuit Troubleshooting', 'Solar Panel Installation'], state: 'Tamil Nadu', city: 'Chennai', wage_min: 23000, wage_max: 30000, positions: 6, desc: 'Electricians for solar plant commissioning. ITI + PM VIKAS certification preferred.', age: 4 });
  vac(e3, 'employer', { title: 'Healthcare Assistant — In-patient Ward', trade: 'Healthcare Assistant', skills: ['Patient Care', 'Vital Monitoring', 'First Aid', 'Infection Control'], state: 'Maharashtra', city: 'Mumbai', wage_min: 18000, wage_max: 25000, positions: 10, desc: 'Caring, certified healthcare assistants for multi-specialty hospital. Rotational shifts.', age: 1 });
  vac(rec1, 'recruiter', { title: 'Mobile Repair Technician (Retail Chain)', trade: 'Mobile Repair Technician', skills: ['Hardware Repair', 'Software Flashing', 'Diagnostics', 'Soldering'], state: 'Telangana', city: 'Hyderabad', wage_min: 16000, wage_max: 24000, positions: 5, desc: 'Aggregated listing: national electronics retail chain hiring service technicians.', age: 7 });
  vac(rec1, 'recruiter', { title: 'Industrial Plumber — Infrastructure', trade: 'Plumber', skills: ['Pipe Fitting', 'PPR Welding', 'Sanitary Installation', 'Blueprint Reading'], state: 'Uttar Pradesh', city: 'Lucknow', wage_min: 19000, wage_max: 27000, positions: 6, desc: 'Aggregated listing: metro infrastructure project requires certified plumbers.', age: 8 });
  vac(rec1, 'recruiter', { title: 'Garment Production Operator', trade: 'Sewing Machine Operator', skills: ['Industrial Stitching', 'Overlock Machine', 'Quality Checking'], state: 'Tamil Nadu', city: 'Chennai', wage_min: 14000, wage_max: 19000, positions: 20, desc: 'Aggregated listing: apparel export unit, women-friendly facility with transport.', age: 5 });
  vac(rec1, 'recruiter', { title: 'Salon Beautician & Stylist', trade: 'Beautician', skills: ['Hair Styling', 'Skin Care', 'Bridal Makeup', 'Customer Service'], state: 'Delhi', city: 'New Delhi', wage_min: 15000, wage_max: 26000, positions: 6, desc: 'Aggregated listing: premium salon chain hiring certified beauticians across NCR.', age: 6 });
  vac(rec1, 'recruiter', { title: 'Back-Office Data Entry Operator', trade: 'Data Entry Operator', skills: ['Typing 45 WPM', 'MS Excel', 'Data Validation', 'Document Management'], state: 'Jharkhand', city: 'Ranchi', wage_min: 13000, wage_max: 18000, positions: 8, desc: 'Aggregated listing: BPO back-office processing unit, day shift.', age: 9 });
  vac(rec1, 'recruiter', { title: 'Automotive Service Technician (Multi-brand)', trade: 'Automotive Service Technician', skills: ['Engine Diagnostics', 'Brake Service', 'Electrical Systems', 'AC Service'], state: 'Gujarat', city: 'Ahmedabad', wage_min: 17000, wage_max: 26000, positions: 7, desc: 'Aggregated listing: multi-brand service garage network hiring technicians.', age: 4 });

  // ── Overseas placement agents + opportunities ──
  const a1 = makeUser('agent', 'gulf@skybridge-overseas.com', 'SkyBridge Overseas Recruitment', { agency_name: 'SkyBridge Overseas Recruitment', countries: ['UAE', 'Saudi Arabia', 'Qatar'] });
  const a2 = makeUser('agent', 'eu@globalskillpath.com', 'GlobalSkillPath Migration', { agency_name: 'GlobalSkillPath Migration', countries: ['Germany', 'Japan'] });

  const ovs = (agent, o) => run(
    `INSERT INTO overseas_opportunities (agent_user_id, title, trade, country, visa_type, monthly_wage, currency, skills_required, positions, description, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    agent, o.title, o.trade, o.country, o.visa, o.wage, o.cur, JSON.stringify(o.skills), o.positions, o.desc, daysAgo(o.age || 3)
  );
  ovs(a1, { title: 'Structural Welder — Dubai Mega Project', trade: 'Welder', country: 'UAE', visa: 'Employment Visa (2 yr)', wage: 1600, cur: 'AED', skills: ['Arc Welding', 'MIG Welding', 'Pipe Welding', 'Safety Compliance'], positions: 30, desc: 'Leading Gulf contractor hiring certified welders. Free accommodation, food allowance, annual ticket.', age: 1 });
  ovs(a1, { title: 'Industrial Electrician — Saudi Arabia', trade: 'Electrician', country: 'Saudi Arabia', visa: 'Iqama Work Permit', wage: 2200, cur: 'SAR', skills: ['Industrial Wiring', 'Panel Wiring', 'Motor Repair', 'Circuit Troubleshooting'], positions: 15, desc: 'Petrochemical facility maintenance. Medical insurance + overtime.', age: 4 });
  ovs(a1, { title: 'Healthcare Assistant — Qatar Hospitals', trade: 'Healthcare Assistant', country: 'Qatar', visa: 'Work Visa', wage: 3500, cur: 'QAR', skills: ['Patient Care', 'Vital Monitoring', 'First Aid', 'Elder Care'], positions: 20, desc: 'Private hospital group recruiting trained healthcare assistants. English required.', age: 2 });
  ovs(a2, { title: 'Solar Installer — Germany (Green Card)', trade: 'Solar PV Technician', country: 'Germany', visa: 'EU Skilled Worker Visa', wage: 2800, cur: 'EUR', skills: ['Solar Panel Installation', 'Inverter Wiring', 'Electrical Safety'], positions: 10, desc: 'Renewable energy firm; German A2 language support provided post-arrival.', age: 6 });
  ovs(a2, { title: 'CNC Machinist — Japan Manufacturing', trade: 'CNC Machinist', country: 'Japan', visa: 'SSW (Specified Skilled Worker)', wage: 210000, cur: 'JPY', skills: ['CNC Programming', 'G-Code', 'Precision Measurement', 'CAD Reading'], positions: 8, desc: 'Precision parts manufacturer. JLPT N4 training provided. Long-term pathway to residency.', age: 5 });

  // ── Ingest beneficiaries from the mock government training database ──
  const records = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'mock_training_records.json'), 'utf8'));
  for (const rec of records) await ingestRecord(rec, { useLLM });

  // ── Seed historical placements (for analytics time-series) ──
  const profiles = all('SELECT id, trade FROM beneficiary_profiles');
  const trades = [...new Set(profiles.map((p) => p.trade))];
  let placementCount = 0;
  for (let i = 0; i < 46; i++) {
    const t = trades[i % trades.length];
    const cand = profiles.find((p) => p.trade === t) || profiles[0];
    run('INSERT INTO placements (beneficiary_id, target_type, target_id, employer_user_id, trade, placed_at) VALUES (?,?,?,?,?,?)',
      cand.id, i % 4 === 0 ? 'overseas' : 'vacancy', 0, e1, t, daysAgo(rand0(245)));
    placementCount++;
  }
  // mark a couple of beneficiaries employed for funnel realism
  // (deliberately not the showcased high-scoring demo logins, so matches stay visible)
  for (const id of all("SELECT id FROM beneficiary_profiles WHERE full_name IN ('Vijay Patil','Kavita Joshi')").map((r) => r.id)) {
    run("UPDATE beneficiary_profiles SET availability='employed' WHERE id=?", id);
  }

  if (verbose) console.log(`[seed] users=${get('SELECT COUNT(*) n FROM users').n} beneficiaries=${profiles.length} vacancies=${get('SELECT COUNT(*) n FROM vacancies').n} overseas=${get('SELECT COUNT(*) n FROM overseas_opportunities').n} placements=${placementCount}`);

  // ── Initial matching pass (heuristic at seed time; background job refines with LLM) ──
  const summary = await runMatching({ useLLM, verbose });
  if (verbose) console.log('[seed] initial match pass:', summary);
}

function rand0(n) { return Math.floor(Math.random() * n); }

// CLI entry
if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  const reset = process.argv.includes('--reset');
  seed({ reset, useLLM: process.argv.includes('--llm') })
    .then(() => { console.log('[seed] done'); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}

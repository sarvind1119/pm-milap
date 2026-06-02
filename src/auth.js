// src/auth.js — JWT-based role authentication & authorization
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { get } from './db.js';

const SECRET = process.env.JWT_SECRET || 'pm-milap-dev-secret-change-me';

export const hashPassword = (pw) => bcrypt.hashSync(pw, 10);
export const checkPassword = (pw, hash) => bcrypt.compareSync(pw, hash);

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email },
    SECRET,
    { expiresIn: '7d' }
  );
}

// Attaches req.user when a valid Bearer token is present (optional auth).
export function attachUser(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) {
    try { req.user = jwt.verify(token, SECRET); } catch { req.user = null; }
  }
  next();
}

// Hard gate: requires a logged-in user.
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

// Role gate: requireRole('employer','recruiter')
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden — requires role: ${roles.join(' / ')}` });
    }
    next();
  };
}

export function currentUserRow(req) {
  if (!req.user) return null;
  return get('SELECT id, role, email, name, status, profile_json FROM users WHERE id = ?', req.user.id);
}

const crypto = require('crypto');
const { query } = require('./db');

const COOKIE = 'pv_session';
const MAX_AGE_S = 30 * 24 * 3600;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('SESSION_SECRET must be set (16+ characters)');
  return s;
}
const mac = (body) => crypto.createHmac('sha256', secret()).update(body).digest('base64url');

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return body + '.' + mac(body);
}
function unsign(token) {
  if (typeof token !== 'string') return null;
  const [body, m] = token.split('.');
  if (!body || !m) return null;
  const a = Buffer.from(m), b = Buffer.from(mac(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p && p.exp > Date.now() ? p : null;
  } catch { return null; }
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 32);
  return 's1$' + salt.toString('hex') + '$' + h.toString('hex');
}
function checkPassword(pw, stored) {
  const [v, s, h] = String(stored).split('$');
  if (v !== 's1' || !s || !h) return false;
  const got = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 32);
  const want = Buffer.from(h, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function currentUser(req) {
  const p = unsign(parseCookies(req)[COOKIE]);
  if (!p) return null;
  const rows = await query('SELECT id, name, is_admin FROM users WHERE id = $1', [p.uid]);
  const u = rows[0];
  return u ? { id: u.id, name: u.name, admin: !!u.is_admin } : null;
}

function setSession(res, uid) {
  const token = sign({ uid, exp: Date.now() + MAX_AGE_S * 1000 });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_S}`);
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

// State-changing requests must be JSON (blocks plain cross-site form posts).
function jsonOnly(req, res) {
  if (!/application\/json/i.test(req.headers['content-type'] || '')) {
    res.status(415).json({ error: 'Send JSON' });
    return false;
  }
  return true;
}

async function isClosed() {
  const rows = await query("SELECT value FROM settings WHERE key = 'closed'");
  return rows[0] ? rows[0].value === 'true' : false;
}

function wrap(handler) {
  return async (req, res) => {
    try { await handler(req, res); }
    catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
  };
}

module.exports = { hashPassword, checkPassword, currentUser, setSession, clearSession, jsonOnly, isClosed, wrap, sign, unsign };

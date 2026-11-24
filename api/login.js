const { query } = require('../lib/db');
const { checkPassword, setSession, jsonOnly, wrap } = require('../lib/auth');

const MAX_FAILS = 10;
const LOCK_MIN = 15;
const DUMMY = 's1$00000000000000000000000000000000$' + '0'.repeat(64);

module.exports = wrap(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!jsonOnly(req, res)) return;
  const { name, password } = req.body || {};
  if (typeof name !== 'string' || typeof password !== 'string' || password.length > 200) {
    return res.status(400).json({ error: 'Name and password required' });
  }
  const rows = await query(
    'SELECT id, name, pass_hash, is_admin, failed_attempts, locked_until FROM users WHERE lower(name) = lower($1)',
    [name.trim()]
  );
  const u = rows[0];
  if (u && u.locked_until && new Date(u.locked_until) > new Date()) {
    return res.status(429).json({ error: `Too many wrong tries. Try again in ${LOCK_MIN} minutes.` });
  }
  const ok = checkPassword(password.trim(), u ? u.pass_hash : DUMMY) && !!u;
  if (!ok) {
    if (u) {
      const n = (u.failed_attempts || 0) + 1;
      const lock = n >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000).toISOString() : null;
      await query('UPDATE users SET failed_attempts = $2::int, locked_until = $3::timestamptz WHERE id = $1', [u.id, n >= MAX_FAILS ? 0 : n, lock]);
    }
    return res.status(401).json({ error: 'Wrong name or password' });
  }
  await query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [u.id]);
  setSession(res, u.id);
  res.status(200).json({ ok: true, user: { name: u.name, admin: !!u.is_admin } });
});

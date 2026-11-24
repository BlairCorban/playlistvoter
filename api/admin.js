const { query } = require('../lib/db');
const { currentUser, jsonOnly, wrap } = require('../lib/auth');

// Admin only: close voting (reveals results to everyone) or reopen it.
module.exports = wrap(async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!jsonOnly(req, res)) return;
  const user = await currentUser(req);
  if (!user || !user.admin) return res.status(403).json({ error: 'Admin only' });
  const closed = !!(req.body && req.body.closed);
  await query(
    "INSERT INTO settings (key, value) VALUES ('closed', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [closed ? 'true' : 'false']
  );
  res.status(200).json({ ok: true, closed });
});

const { query } = require('../lib/db');
const { currentUser, isClosed, jsonOnly, wrap } = require('../lib/auth');
const { SUPER_LIMIT } = require('../lib/config');
const SONGS = require('../public/songs.json');

const IDS = new Set(SONGS.map((s) => s[0]));
const CODES = new Set([-1, 0, 1, 2]);

module.exports = wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in' });
  res.setHeader('Cache-Control', 'no-store');
  const closed = await isClosed();

  if (req.method === 'GET') {
    const mineRows = await query('SELECT video_id, code FROM votes WHERE user_id = $1', [user.id]);
    const mine = {};
    for (const r of mineRows) mine[r.video_id] = r.code;
    // Everyone's votes are only revealed once voting is closed (the admin can always look).
    let all = null;
    if (closed || user.admin) {
      const rows = await query('SELECT u.id, u.name, v.video_id, v.code FROM users u LEFT JOIN votes v ON v.user_id = u.id ORDER BY u.id');
      const by = new Map();
      for (const r of rows) {
        if (!by.has(r.id)) by.set(r.id, { name: r.name, v: {} });
        if (r.video_id) by.get(r.id).v[r.video_id] = r.code;
      }
      all = [...by.values()];
    }
    return res.status(200).json({ mine, closed, all, superLimit: SUPER_LIMIT });
  }

  if (req.method === 'POST') {
    if (!jsonOnly(req, res)) return;
    if (closed) return res.status(403).json({ error: 'Voting is closed' });
    const changes = req.body && req.body.changes;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return res.status(400).json({ error: 'changes required' });
    const entries = Object.entries(changes);
    if (entries.length > 800) return res.status(400).json({ error: 'Too many changes' });
    const set = {}, del = [];
    for (const [id, code] of entries) {
      if (!IDS.has(id)) return res.status(400).json({ error: 'Unknown song' });
      if (code === null) del.push(id);
      else if (CODES.has(code)) set[id] = code;
      else return res.status(400).json({ error: 'Bad vote' });
    }
    // Super vote limit, counted as it would be after this change.
    const cur = await query('SELECT video_id, code FROM votes WHERE user_id = $1', [user.id]);
    const after = new Map(cur.map((r) => [r.video_id, r.code]));
    for (const id of del) after.delete(id);
    for (const [id, c] of Object.entries(set)) after.set(id, c);
    const supers = [...after.values()].filter((c) => c === 2).length;
    if (supers > SUPER_LIMIT) return res.status(409).json({ error: `You only get ${SUPER_LIMIT} super upvotes` });

    if (Object.keys(set).length) {
      await query(
        `INSERT INTO votes (user_id, video_id, code)
         SELECT $1::int, key, value::smallint FROM jsonb_each_text($2::jsonb)
         ON CONFLICT (user_id, video_id) DO UPDATE SET code = EXCLUDED.code, updated_at = now()`,
        [user.id, JSON.stringify(set)]
      );
    }
    if (del.length) {
      await query(
        'DELETE FROM votes WHERE user_id = $1::int AND video_id IN (SELECT jsonb_array_elements_text($2::jsonb))',
        [user.id, JSON.stringify(del)]
      );
    }
    return res.status(200).json({ ok: true, supers });
  }

  res.status(405).json({ error: 'GET or POST only' });
});

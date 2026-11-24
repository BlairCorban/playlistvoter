const { query } = require('../lib/db');
const { wrap } = require('../lib/auth');

module.exports = wrap(async (req, res) => {
  const rows = await query('SELECT name FROM users ORDER BY id');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ names: rows.map((r) => r.name) });
});

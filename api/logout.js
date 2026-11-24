const { clearSession, wrap } = require('../lib/auth');

module.exports = wrap(async (req, res) => {
  clearSession(res);
  res.status(200).json({ ok: true });
});

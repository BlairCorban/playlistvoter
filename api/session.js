const { currentUser, isClosed, wrap } = require('../lib/auth');
const { SUPER_LIMIT } = require('../lib/config');

module.exports = wrap(async (req, res) => {
  const user = await currentUser(req);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ user: user ? { name: user.name, admin: user.admin } : null, closed: await isClosed(), superLimit: SUPER_LIMIT });
});

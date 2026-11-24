// Exercises the real API handlers against an in-memory Postgres (PGlite).
const assert = require('assert');
process.env.SESSION_SECRET = 'test-secret-test-secret-1234';
const { PGlite } = require('@electric-sql/pglite');
const { setQueryImpl, query } = require('../lib/db');
const schema = require('../lib/schema');
const { hashPassword } = require('../lib/auth');
const SONGS = require('../public/songs.json');

const H = {
  login: require('../api/login'), session: require('../api/session'), votes: require('../api/votes'),
  admin: require('../api/admin'), names: require('../api/names'), logout: require('../api/logout'),
};

function call(handler, { method = 'GET', body, cookie, json = true } = {}) {
  return new Promise(async (resolve) => {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined && json) headers['content-type'] = 'application/json';
    const res = {
      headers: {}, code: 200,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.code = c; return this; },
      json(o) { resolve({ code: this.code, body: o, headers: this.headers }); },
    };
    await handler({ method, headers, body }, res);
  });
}
const cookieOf = (r) => (r.headers['set-cookie'] || '').split(';')[0];

(async () => {
  const pg = new PGlite();
  setQueryImpl(async (t, p) => (await pg.query(t, p)).rows);
  for (const s of schema) await query(s);
  await query('INSERT INTO users (name, pass_hash, is_admin) VALUES ($1,$2,true)', ['Blair', hashPassword('alpha-pass')]);
  await query('INSERT INTO users (name, pass_hash) VALUES ($1,$2)', ['Chad', hashPassword('bravo-pass')]);
  const ids = SONGS.map((s) => s[0]);
  let n = 0;
  const ok = (m) => console.log('  ok -', m, ++n);

  assert.deepStrictEqual((await call(H.names)).body.names, ['Blair', 'Chad']); ok('names list');
  assert.strictEqual((await call(H.votes)).code, 401); ok('votes need login');
  assert.strictEqual((await call(H.login, { method: 'POST', body: { name: 'Blair', password: 'nope' } })).code, 401); ok('wrong password rejected');
  assert.strictEqual((await call(H.login, { method: 'POST', body: { name: 'Blair', password: 'alpha-pass' }, json: false })).code, 415); ok('non-JSON login rejected');

  const b = await call(H.login, { method: 'POST', body: { name: 'blair', password: ' alpha-pass ' } });
  assert.strictEqual(b.code, 200); assert.ok(/HttpOnly/.test(b.headers['set-cookie']) && /Secure/.test(b.headers['set-cookie']));
  const bc = cookieOf(b); ok('admin login (case-insensitive name, trimmed password)');
  const c = await call(H.login, { method: 'POST', body: { name: 'Chad', password: 'bravo-pass' } });
  const cc = cookieOf(c);
  assert.strictEqual((await call(H.session, { cookie: cc })).body.user.name, 'Chad'); ok('session reports user');
  assert.strictEqual((await call(H.session, { cookie: cc + 'x' })).body.user, null); ok('tampered cookie ignored');

  // voting
  let r = await call(H.votes, { method: 'POST', cookie: cc, body: { changes: { [ids[0]]: 1, [ids[1]]: -1, [ids[2]]: 2, [ids[3]]: 0 } } });
  assert.strictEqual(r.code, 200); ok('chad votes');
  r = await call(H.votes, { cookie: cc });
  assert.deepStrictEqual(r.body.mine, { [ids[0]]: 1, [ids[1]]: -1, [ids[2]]: 2, [ids[3]]: 0 });
  assert.strictEqual(r.body.all, null); ok('non-admin cannot see others while open');
  await call(H.votes, { method: 'POST', cookie: cc, body: { changes: { [ids[0]]: -1, [ids[1]]: null } } });
  r = await call(H.votes, { cookie: cc });
  assert.strictEqual(r.body.mine[ids[0]], -1); assert.ok(!(ids[1] in r.body.mine)); ok('update + delete votes');

  assert.strictEqual((await call(H.votes, { method: 'POST', cookie: cc, body: { changes: { nope12345ab: 1 } } })).code, 400); ok('unknown song rejected');
  assert.strictEqual((await call(H.votes, { method: 'POST', cookie: cc, body: { changes: { [ids[5]]: 7 } } })).code, 400); ok('bad vote code rejected');
  const sup = {}; for (let i = 10; i < 10 + 20; i++) sup[ids[i]] = 2;
  r = await call(H.votes, { method: 'POST', cookie: cc, body: { changes: sup } });
  assert.strictEqual(r.code, 409); ok('super limit enforced (20 > 15)');
  const sup14 = {}; for (let i = 10; i < 10 + 14; i++) sup14[ids[i]] = 2; // 14 + the existing 1 = 15
  assert.strictEqual((await call(H.votes, { method: 'POST', cookie: cc, body: { changes: sup14 } })).code, 200); ok('exactly 15 supers allowed');
  assert.strictEqual((await call(H.votes, { method: 'POST', cookie: cc, body: { changes: { [ids[40]]: 2 } } })).code, 409); ok('16th super rejected');
  assert.strictEqual((await call(H.votes, { method: 'POST', cookie: cc, body: { changes: { [ids[10]]: 1, [ids[40]]: 2 } } })).code, 200); ok('swapping a super for another is fine');

  // admin sees all; non-admin cannot close
  await call(H.votes, { method: 'POST', cookie: bc, body: { changes: { [ids[0]]: 1 } } });
  r = await call(H.votes, { cookie: bc });
  assert.strictEqual(r.body.all.length, 2); assert.strictEqual(r.body.all[1].name, 'Chad'); ok('admin sees everyone');
  assert.strictEqual((await call(H.admin, { method: 'POST', cookie: cc, body: { closed: true } })).code, 403); ok('non-admin cannot close');

  // close: reveal + lock
  assert.strictEqual((await call(H.admin, { method: 'POST', cookie: bc, body: { closed: true } })).code, 200);
  r = await call(H.votes, { cookie: cc });
  assert.strictEqual(r.body.closed, true); assert.strictEqual(r.body.all.length, 2); ok('closing reveals results to everyone');
  assert.strictEqual((await call(H.votes, { method: 'POST', cookie: cc, body: { changes: { [ids[50]]: 1 } } })).code, 403); ok('no voting once closed');
  await call(H.admin, { method: 'POST', cookie: bc, body: { closed: false } });
  assert.strictEqual((await call(H.votes, { cookie: cc })).body.all, null); ok('reopen hides results again');

  // lockout
  for (let i = 0; i < 10; i++) await call(H.login, { method: 'POST', body: { name: 'Chad', password: 'wrong' + i } });
  assert.strictEqual((await call(H.login, { method: 'POST', body: { name: 'Chad', password: 'bravo-pass' } })).code, 429); ok('locked after 10 wrong tries');
  await query("UPDATE users SET locked_until = now() - interval '1 minute' WHERE name = 'Chad'");
  assert.strictEqual((await call(H.login, { method: 'POST', body: { name: 'Chad', password: 'bravo-pass' } })).code, 200); ok('lock expires');
  assert.strictEqual((await call(H.login, { method: 'POST', body: { name: 'Ghost', password: 'x' } })).code, 401); ok('unknown user = same error');
  console.log('API tests passed:', n);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

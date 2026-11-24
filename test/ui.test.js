// Loads the real page in jsdom, wired to the real API handlers + in-memory Postgres.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
process.env.SESSION_SECRET = 'test-secret-test-secret-1234';
const { JSDOM } = require('jsdom');
const { PGlite } = require('@electric-sql/pglite');
const { setQueryImpl, query } = require('../lib/db');
const schema = require('../lib/schema');
const { hashPassword } = require('../lib/auth');
const SONGS = require('../public/songs.json');
const H = { '/api/login': require('../api/login'), '/api/session': require('../api/session'), '/api/votes': require('../api/votes'), '/api/admin': require('../api/admin'), '/api/names': require('../api/names'), '/api/logout': require('../api/logout') };
const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeBrowser() {
  let cookie = '';
  const fetchImpl = async (url, opts = {}) => {
    if (url === '/songs.json') return { ok: true, status: 200, json: async () => SONGS };
    const handler = H[url.split('?')[0]];
    return new Promise(async (resolve) => {
      const headers = {};
      for (const [k, v] of Object.entries(opts.headers || {})) headers[k.toLowerCase()] = v;
      if (cookie) headers.cookie = cookie;
      const res = {
        code: 200,
        setHeader(k, v) { if (k.toLowerCase() === 'set-cookie') { const c = v.split(';')[0]; cookie = /=$/.test(c) ? '' : c; } },
        status(c) { this.code = c; return this; },
        json(o) { resolve({ ok: this.code < 400, status: this.code, statusText: 'x', json: async () => o }); },
      };
      await handler({ method: opts.method || 'GET', headers, body: opts.body ? JSON.parse(opts.body) : undefined }, res);
    });
  };
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://vote.test/', beforeParse(w) { w.fetch = fetchImpl; w.confirm = () => true; } });
  return dom.window;
}
async function login(w, name, pw) {
  const d = w.document;
  d.querySelector('#ln').value = name; d.querySelector('#lp').value = pw;
  d.querySelector('[data-act=login]').click(); await sleep(150);
}

(async () => {
  const pg = new PGlite();
  setQueryImpl(async (t, p) => (await pg.query(t, p)).rows);
  for (const s of schema) await query(s);
  await query('INSERT INTO users (name, pass_hash, is_admin) VALUES ($1,$2,true)', ['Blair', hashPassword('pw-blair')]);
  for (const n of ['Chad', 'Jack', 'Angus']) await query('INSERT INTO users (name, pass_hash) VALUES ($1,$2)', [n, hashPassword('pw-' + n.toLowerCase())]);
  let n = 0; const ok = (m) => console.log('  ok -', m, ++n);

  // Chad
  const chad = makeBrowser(); await sleep(250);
  let d = chad.document;
  assert.ok(d.querySelector('#app').textContent.includes('Sign in')); ok('login screen lists names');
  assert.deepStrictEqual([...d.querySelectorAll('#ln option')].map((o) => o.textContent), ['Blair', 'Chad', 'Jack', 'Angus']); ok('all voters in dropdown');
  await login(chad, 'Chad', 'wrong');
  assert.ok(d.querySelector('#app').textContent.includes('Wrong name or password')); ok('wrong password shows error');
  await login(chad, 'Chad', 'pw-chad');
  assert.ok(d.querySelector('.vbtns')); assert.strictEqual(d.querySelector('#who').textContent, 'Chad'); ok('Chad signed in, vote card shown');
  for (let i = 0; i < 20; i++) d.querySelector(`[data-vote="${[1, -1, 2, 0][i % 4]}"]`).click();
  await sleep(1000);
  const rows = await query("SELECT count(*)::int AS c FROM votes v JOIN users u ON u.id=v.user_id WHERE u.name='Chad'");
  assert.strictEqual(rows[0].c, 20); ok('20 votes saved to the database');
  d.querySelector('[data-tab=results]').click(); await sleep(50);
  assert.ok(d.querySelector('#app').textContent.includes('Locked')); ok('results locked for non-admin while open');

  // test mode: nothing reaches the db
  d.querySelector('#testbtn').click(); await sleep(50);
  assert.ok(d.querySelector('.testbar')); ok('test mode banner');
  d.querySelector('[data-act=fill]').click(); d.querySelector('[data-act=fakes]').click();
  d.querySelector('[data-tab=vote]').click(); await sleep(30);
  for (let i = 0; i < 5; i++) d.querySelector('[data-vote="1"]').click();
  await sleep(900);
  assert.strictEqual((await query('SELECT count(*)::int AS c FROM votes'))[0].c, 20); ok('test votes never hit the database');
  for (const t of ['results', 'stats', 'wrapped']) {
    d.querySelector(`[data-tab=${t}]`).click(); await sleep(60);
    assert.ok(!d.querySelector('#app').textContent.includes('Locked')); assert.ok(d.querySelector('#app').innerHTML.length > 1500);
  }
  ok('results/stats/wrapped usable in test mode');
  const w = d.querySelector('#app').textContent;
  assert.ok(w.includes("Chad (test)'s breakdown") && w.includes('The group awards') && w.includes('Pickiest voter') && w.includes('Your voting style')); ok('wrapped cards render');
  console.log('   sample wrapped titles:', [...d.querySelectorAll('.story h2')].map((e) => e.textContent).join(' | '));
  d.querySelector('#testbtn').click(); await sleep(60);
  assert.ok(!d.querySelector('.testbar')); d.querySelector('[data-tab=mine]').click(); await sleep(30);
  assert.ok(d.querySelector('#app').textContent.includes('all (20)')); ok('turning test mode off restores the real 20 votes');

  // Blair (admin) votes, sees everything, closes voting
  const blair = makeBrowser(); await sleep(250); d = blair.document;
  await login(blair, 'Blair', 'pw-blair');
  for (let i = 0; i < 6; i++) d.querySelector('[data-vote="-1"]').click(); await sleep(900);
  d.querySelector('[data-tab=results]').click(); await sleep(150);
  assert.ok(d.querySelector('#app').textContent.includes('Admin') && d.querySelector('[data-act=close]')); ok('admin sees results + close button early');
  d.querySelector('[data-act=close]').click(); await sleep(200);
  assert.ok(d.querySelector('[data-act=reopen]')); ok('admin closed voting');

  // Chad now sees results and can't vote
  d = chad.document; chad.document.querySelector('[data-tab=results]').click(); await sleep(200);
  assert.ok(!d.querySelector('#app').textContent.includes('Locked')); ok('results unlock for Chad after close');
  d.querySelector('[data-tab=wrapped]').click(); await sleep(100);
  assert.ok(d.querySelector('#app').textContent.includes('breakdown')); ok('real wrapped renders for two voters');
  d.querySelector('[data-tab=vote]').click(); await sleep(30);
  assert.ok(d.querySelector('#app').textContent.includes('Voting is closed')); ok('voting disabled after close');

  d.querySelector('#outbtn').click(); await sleep(100);
  assert.ok(d.querySelector('#app').textContent.includes('Sign in')); ok('sign out');
  console.log('UI tests passed:', n); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });

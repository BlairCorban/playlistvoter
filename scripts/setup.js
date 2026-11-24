#!/usr/bin/env node
// Creates the tables and the voter accounts, and prints each new voter's passphrase ONCE.
//   DATABASE_URL=... node scripts/setup.js              create tables + any missing voters
//   DATABASE_URL=... node scripts/setup.js --reset Chad  new passphrase for one voter
// Passphrases are never stored or committed anywhere. Only a salted hash goes in the database.
const crypto = require('crypto');
const { query } = require('../lib/db');
const { hashPassword } = require('../lib/auth');
const schema = require('../lib/schema');
const { VOTERS } = require('../lib/config');

const C = 'bdfghjklmnprstvz', V = 'aeiou';
const pick = (s) => s[crypto.randomInt(s.length)];
const syl = () => [C, V, C, V, C].map(pick).join('');
const passphrase = () => [syl(), syl(), syl()].join('-');

(async () => {
  for (const stmt of schema) await query(stmt);
  const resetIdx = process.argv.indexOf('--reset');
  const resetName = resetIdx > -1 ? (process.argv[resetIdx + 1] || '').toLowerCase() : null;
  const out = [];
  for (const v of VOTERS) {
    const rows = await query('SELECT id FROM users WHERE lower(name) = lower($1)', [v.name]);
    const wantsReset = resetName && resetName === v.name.toLowerCase();
    if (rows[0] && !wantsReset) {
      await query('UPDATE users SET is_admin = $2 WHERE id = $1', [rows[0].id, !!v.admin]);
      continue;
    }
    const pw = passphrase();
    const hash = hashPassword(pw);
    if (rows[0]) await query('UPDATE users SET pass_hash = $2, is_admin = $3, failed_attempts = 0, locked_until = NULL WHERE id = $1', [rows[0].id, hash, !!v.admin]);
    else await query('INSERT INTO users (name, pass_hash, is_admin) VALUES ($1, $2, $3)', [v.name, hash, !!v.admin]);
    out.push([v.name, pw]);
  }
  console.log('Tables ready.');
  if (!out.length) console.log('No new voters to create. (Use --reset NAME to issue a new passphrase.)');
  else {
    console.log('\nPassphrases (shown once, copy them now):\n');
    for (const [n, p] of out) console.log(n.padEnd(12) + p);
    console.log('');
  }
})().catch((e) => { console.error(e.message); process.exit(1); });

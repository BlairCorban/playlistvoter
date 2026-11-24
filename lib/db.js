let impl = null;
let sql = null;

// Tests swap in an in-memory Postgres (PGlite) through this.
function setQueryImpl(fn) { impl = fn; }

async function query(text, params = []) {
  if (impl) return impl(text, params);
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (!sql) {
    const { neon } = require('@neondatabase/serverless');
    sql = neon(url);
  }
  return sql.query(text, params); // resolves to an array of row objects
}

module.exports = { query, setQueryImpl };

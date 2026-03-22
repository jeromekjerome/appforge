import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function query(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

// Tagged template literal helper so callers can use sql`...` syntax.
// Interpolated values are extracted into a parameterised query ($1, $2, ...).
export function sql(strings, ...values) {
  let text = '';
  strings.forEach((str, i) => {
    text += str;
    if (i < values.length) text += ['$', i + 1].join('');
  });
  return query(text, values);
}

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS leads (
      id            SERIAL PRIMARY KEY,
      name          TEXT,
      email         TEXT NOT NULL,
      context       TEXT DEFAULT 'personal',
      spec_markdown TEXT NOT NULL,
      transcript    JSONB DEFAULT '[]',
      status        TEXT DEFAULT 'new',
      notes         TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

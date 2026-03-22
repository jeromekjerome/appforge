import { neon } from '@neondatabase/serverless';

export const sql = neon(process.env.DATABASE_URL);

export async function initDb() {
  await sql`
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
  `;
}

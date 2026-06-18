import pg from 'pg';
const { Client } = pg;

const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const client = new Client({
  host: 'db.rqquvtjdmugpigbndmne.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: key,
  ssl: { rejectUnauthorized: false }
});

try {
  await client.connect();
  console.log('Connected to Supabase PostgreSQL');

  const check = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'annie%' ORDER BY table_name"
  );
  console.log('Existing annie tables:', check.rows.map(r => r.table_name));

  if (check.rows.length > 0) {
    console.log('Annie tables already exist, skipping migration');
    await client.end();
    process.exit(0);
  }

  const fs = await import('node:fs');
  const sql = new URL('../supabase/migrations/005_annie_log.sql', import.meta.url).pathname;
  const migration = fs.readFileSync(sql, 'utf-8');

  await client.query(migration);
  console.log('Migration 005_annie_log.sql applied successfully');

  const verify = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'annie%' ORDER BY table_name"
  );
  console.log('Created tables:', verify.rows.map(r => r.table_name));

  await client.end();
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}

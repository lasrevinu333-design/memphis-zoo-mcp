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
    console.log('Annie tables already exist, skipping DDL migration');
  } else {
    const fs = await import('node:fs');
    const sql = new URL('../supabase/migrations/005_annie_log.sql', import.meta.url).pathname;
    const migration = fs.readFileSync(sql, 'utf-8');
    await client.query(migration);
    console.log('Migration 005_annie_log.sql applied successfully');
  }

  // Now migrate data from local JSON
  const logFs = await import('node:fs');
  const logPath = '/home/eric/.hermes/profiles/annie/data/annies_log.json';
  const contactsPath = '/home/eric/.hermes/profiles/annie/data/annie_contacts.json';

  let notes = [], reminders = [], contacts = [];

  try {
    const raw = JSON.parse(logFs.readFileSync(logPath, 'utf-8'));
    notes = raw.notes || [];
    reminders = raw.reminders || raw.completedReminders || [];
  } catch (e) {
    console.log('Note: Could not read annies_log.json:', e.message);
  }

  try {
    const raw = JSON.parse(logFs.readFileSync(contactsPath, 'utf-8'));
    contacts = raw.contacts || raw || [];
  } catch (e) {
    console.log('Note: Could not read annie_contacts.json:', e.message);
  }

  console.log(`Migrating: ${notes.length} notes, ${reminders.length} reminders, ${contacts.length} contacts`);

  for (const note of notes) {
    const id = note.id || ('note_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    await client.query(
      'INSERT INTO annie_log_notes (id, content, created_at, updated_at) VALUES ($1, $2, $3, $3) ON CONFLICT (id) DO NOTHING',
      [id, note.content || '', note.createdAt || note.created_at || new Date().toISOString()]
    );
  }

  for (const rem of reminders) {
    const id = rem.id || ('rem_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    await client.query(
      'INSERT INTO annie_log_reminders (id, content, due, fingerprint, done, done_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT (id) DO NOTHING',
      [
        id,
        rem.content || '',
        rem.due || '',
        rem.fingerprint || '',
        rem.done || false,
        rem.doneAt || rem.done_at || null,
        rem.createdAt || rem.created_at || new Date().toISOString()
      ]
    );
  }

  for (const c of contacts) {
    const id = c.id || ('c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8));
    await client.query(
      'INSERT INTO annie_contacts (id, name, phone, email, notes, source, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $7) ON CONFLICT (id) DO NOTHING',
      [
        id,
        c.name || '',
        c.phone || '',
        c.email || '',
        c.notes || '',
        c.source || 'import',
        c.createdAt || c.created_at || new Date().toISOString()
      ]
    );
  }

  // Verify
  const verify = await client.query(
    "SELECT 'annie_log_notes' as tbl, count(*) as cnt FROM annie_log_notes UNION ALL SELECT 'annie_log_reminders', count(*) FROM annie_log_reminders UNION ALL SELECT 'annie_contacts', count(*) FROM annie_contacts"
  );
  console.log('Migration complete. Row counts:');
  for (const row of verify.rows) {
    console.log(`  ${row.tbl}: ${row.cnt}`);
  }

  await client.end();
  console.log('Done.');
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}

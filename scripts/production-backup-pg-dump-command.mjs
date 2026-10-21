const TASK_LOCAL_PRODUCTION_DATABASE_HOST = "db.rqquvtjdmugpigbndmne.supabase.co";

// Fixed application capture scope, not a caller-selected schema allowlist.
// custodial_dr is the non-restored control plane and remains excluded.
export const productionBackupDataSchemas = Object.freeze(["public", "auth", "storage", "custodial_release_identity"]);
// Signed per-table representation, not archive/restore/custody authorization.
export const productionBackupDataEncoding = "postgres-json-text-line.v1";
// New typed-column DATA representation. Each non-NULL SQL value is captured
// through its native text output; SQL NULL alone is JSON null. Unlike v1,
// a json/jsonb value of null is therefore the STRING "null", not SQL NULL.
// This codec is not archive admission or a restore/target capability. The
// normal producer and SQL consumers must be joined before selecting v2.
export const productionBackupTextColumnsDataEncoding = "postgres-text-columns-line.v2";
export const productionBackupSnapshotStatements = Object.freeze([
  "begin isolation level repeatable read read only deferrable",
  // This does NOT bypass RLS: PostgreSQL refuses reads that would apply a
  // policy, rather than silently signing a filtered/empty original ledger.
  "set local row_security = off",
]);

// Compare the independently enumerated private relation scope to the normal
// table catalog from the SAME read-only snapshot before any table export.
export function requireProductionBackupDataScope(namespaces, privateRelations, catalog) {
  if (!Array.isArray(namespaces) || namespaces.length !== productionBackupDataSchemas.length
      || new Set(namespaces.map(row=>row?.schema_name)).size !== namespaces.length
      || namespaces.some(row=>!productionBackupDataSchemas.includes(row?.schema_name) || row.usage_allowed !== true)
      || !Array.isArray(privateRelations) || privateRelations.length === 0 || !Array.isArray(catalog)) {
    throw new Error("Complete accessible backup schema scope is required.");
  }
  const keys = new Set();
  for (const row of catalog) {
    if (!row || !productionBackupDataSchemas.includes(row.schema_name) || typeof row.table_name !== "string" || !row.table_name
        || !Array.isArray(row.primary_key) || !Array.isArray(row.columns) || row.columns.length === 0
        || keys.has(JSON.stringify([row.schema_name,row.table_name]))) {
      throw new Error("Backup table catalog scope is missing, duplicated or unsupported.");
    }
    keys.add(JSON.stringify([row.schema_name,row.table_name]));
  }
  const privateNames = new Set();
  for (const row of privateRelations) {
    // ONLY parent exports cannot preserve partition/foreign table DATA. Fail
    // closed if this application private scope ever acquires those shapes.
    if (!row || typeof row.table_name !== "string" || !row.table_name || row.relation_kind !== "r" || row.is_partition !== false
        || privateNames.has(row.table_name) || !keys.has(JSON.stringify(["custodial_release_identity",row.table_name]))) {
      throw new Error("Original private backup relation scope is incomplete or unsupported.");
    }
    privateNames.add(row.table_name);
  }
  if (catalog.filter(row=>row.schema_name === "custodial_release_identity").length !== privateNames.size) {
    throw new Error("Original private backup catalog does not match the snapshot relation scope.");
  }
}

export function productionBackupRowCount(result) {
  const value = result?.rows?.[0]?.row_count;
  if (result?.rowCount !== 1 || result.rows.length !== 1 || typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)
      || !Number.isSafeInteger(Number(value))) {
    throw new Error("Exact bounded backup row count is required.");
  }
  return Number(value);
}

function requireRawPostgresJsonObject(rawText) {
  if (typeof rawText !== "string") throw new Error("Backup data requires untouched PostgreSQL JSON text.");
  let shape;
  try { shape = JSON.parse(rawText); } catch { throw new Error("Backup PostgreSQL JSON text is malformed."); }
  if (shape === null || typeof shape !== "object" || Array.isArray(shape)) {
    throw new Error("Backup PostgreSQL JSON text must describe one row object.");
  }
  // Shape only. Never use this lossy parsed value as DATA or reserialize it.
}

export function encodeProductionBackupDataRow(rawText) {
  requireRawPostgresJsonObject(rawText);
  // Escape only the STRING envelope for one JSONL record. The inner original
  // whitespace, numeric tokens, nested JSON and bytea/text remain untouched.
  return JSON.stringify(rawText);
}

function requireNativeTextColumnsRow(rawText) {
  requireRawPostgresJsonObject(rawText);
  const shape = JSON.parse(rawText);
  const validUnicode = value => {
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const low = value.charCodeAt(++i);
        if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
    }
    return true;
  };
  for (const [key, value] of Object.entries(shape)) {
    if (!validUnicode(key) || value !== null && (typeof value !== "string" || !validUnicode(value))) {
      throw new Error("Native text-column backup requires exact text or SQL NULL fields.");
    }
  }
  // JSON.parse is shape validation only. Also refuse duplicate decoded keys
  // (including escaped aliases), rather than silently retaining the last one.
  // The closed value grammar here is only strings and null, not nested JSON.
  let i = 0;
  const whitespace = () => { while (/[\x20\t\r\n]/.test(rawText[i] || "\0")) i++; };
  const stringEnd = start => {
    let end = start + 1;
    while (end < rawText.length) {
      if (rawText[end] === "\\") { end += 2; continue; }
      if (rawText[end] === '"') return end + 1;
      end++;
    }
    throw new Error("Malformed native text-column backup row.");
  };
  whitespace(); i++; whitespace();
  const keys = new Set();
  while (rawText[i] !== "}") {
    const end = stringEnd(i), key = JSON.parse(rawText.slice(i, end));
    if (keys.has(key)) throw new Error("Duplicate native text-column backup column.");
    keys.add(key); i = end; whitespace(); i++; whitespace();
    i = rawText[i] === '"' ? stringEnd(i) : i + 4;
    whitespace();
    if (rawText[i] !== ",") break;
    i++; whitespace();
  }
}

export function encodeProductionBackupTextColumnsDataRow(rawText) {
  requireNativeTextColumnsRow(rawText);
  return JSON.stringify(rawText); // Never normalize/rebuild the inner DATA.
}

export function decodeProductionBackupTextColumnsDataRow(line) {
  if (typeof line !== "string" || line.length === 0) throw new Error("Native text-column backup line is invalid.");
  let rawText;
  try { rawText = JSON.parse(line); }
  catch { throw new Error("Native text-column backup envelope is invalid."); }
  if (typeof rawText !== "string") throw new Error("Native text-column backup envelope must contain text.");
  requireNativeTextColumnsRow(rawText);
  return rawText; // DATA only; this does not admit v2 to a legacy SQL consumer.
}

export function requireProductionBackupPage(result, {offset, rowCount, pageSize}) {
  if (![offset,rowCount,pageSize].every(Number.isSafeInteger) || offset < 0 || offset >= rowCount || pageSize < 1
      || !Array.isArray(result?.rows) || !Number.isSafeInteger(result.rowCount) || result.rowCount !== result.rows.length
      || result.rowCount !== Math.min(pageSize,rowCount-offset)
      || result.rows.some(item=>!item || typeof item.row !== "string")) {
    throw new Error("Backup page does not preserve the complete counted snapshot rows.");
  }
  for (const item of result.rows) requireRawPostgresJsonObject(item.row);
  // Do not coerce, normalize or reconstruct the original row values.
  return result.rows;
}

export function productionBackupPgDumpDockerArgs({
  caPath,
  databaseHost,
  databaseName,
  databasePort,
  databaseUsername,
  exportedSnapshot,
  inventoryDir,
  networkHost = false,
  executionMode = "github-actions",
  pgDumpImage,
  uid = 1000,
  gid = 1000,
}) {
  const pgDumpHost = String(databaseHost || "").trim();
  const normalizedHost = pgDumpHost.toLowerCase();
  if (networkHost && (executionMode !== "task-local" || normalizedHost !== TASK_LOCAL_PRODUCTION_DATABASE_HOST)) {
    throw new Error(`Docker host networking is restricted to explicit task-local backup access for ${TASK_LOCAL_PRODUCTION_DATABASE_HOST}.`);
  }
  return [
    "run", "--rm", "--entrypoint", "pg_dump",
    ...(networkHost ? ["--network", "host"] : []),
    "--user", `${uid}:${gid}`,
    "-e", "PGPASSWORD", "-e", "PGOPTIONS=-c default_transaction_read_only=on",
    "-e", "PGSSLMODE=verify-full", "-e", "PGSSLROOTCERT=/cert/prod-ca.crt",
    "-v", `${caPath}:/cert/prod-ca.crt:ro`,
    "-v", `${inventoryDir}:/backup:rw`,
    pgDumpImage,
    "--host", pgDumpHost,
    "--port", databasePort,
    "--username", databaseUsername,
    "--dbname", databaseName,
    "--no-password",
    "--schema-only", "--clean", "--if-exists", `--snapshot=${exportedSnapshot}`,
    "--file=/backup/application-schema.sql",
  ];
}

// Evidence only. These fixed files do not select or authorize a restore path.
export const productionBackupSchemaSections = Object.freeze([
  Object.freeze({ section: "pre-data", path: "inventory/application-schema-pre-data.sql" }),
  Object.freeze({ section: "post-data", path: "inventory/application-schema-post-data.sql" }),
]);

export function productionBackupPgDumpSectionDockerArgs(options, section) {
  const profile = productionBackupSchemaSections.find(entry => entry.section === section);
  if (!profile) throw new Error("Unsupported fixed schema evidence section.");
  // Reuse the unchanged normal transport, identity and owner/ACL defaults.
  // Construct a new no-clean profile; never filter or rewrite emitted SQL.
  const fullArgs = productionBackupPgDumpDockerArgs(options);
  return [
    ...fullArgs.slice(0, fullArgs.indexOf("--schema-only")),
    "--schema-only", `--section=${profile.section}`, `--snapshot=${options.exportedSnapshot}`,
    `--file=/backup/${profile.path.slice("inventory/".length)}`,
  ];
}

export function requireProductionBackupSchemaSections(sections) {
  if (!Array.isArray(sections) || sections.length !== productionBackupSchemaSections.length) {
    throw new Error("Complete fixed schema evidence sections are required.");
  }
  return Object.freeze(sections.map((entry, index) => {
    const profile = productionBackupSchemaSections[index];
    if (!entry || Object.keys(entry).sort().join(",") !== "path,section,sha256"
        || entry.section !== profile.section || entry.path !== profile.path
        || typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error("Schema evidence section identity or checksum is invalid.");
    }
    return Object.freeze({ section: entry.section, path: entry.path, sha256: entry.sha256 });
  }));
}

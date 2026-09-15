const TASK_LOCAL_PRODUCTION_DATABASE_HOST = "db.rqquvtjdmugpigbndmne.supabase.co";

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

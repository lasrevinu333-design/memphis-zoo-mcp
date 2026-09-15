import { createHash } from "node:crypto";

const MAX_RESTORE_CHECKS = 512;

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function tableIdentity(schemaName, tableName) {
  return JSON.stringify([String(schemaName), String(tableName)]);
}

function normalizeTargetTables(databaseTables) {
  if (!Array.isArray(databaseTables)) throw new Error("Restore table catalog must be an array.");
  const targets = new Set();
  for (const table of databaseTables) {
    const schemaName = String(table?.schema_name || "");
    const tableName = String(table?.table_name || "");
    if (!schemaName || !tableName || schemaName.length > 63 || tableName.length > 63) {
      throw new Error("Restore table catalog contains an invalid PostgreSQL relation identity.");
    }
    const identity = tableIdentity(schemaName, tableName);
    if (targets.has(identity)) throw new Error(`Restore table catalog repeats ${schemaName}.${tableName}.`);
    targets.add(identity);
  }
  return targets;
}

function normalizeConstraint(row) {
  const constraint = {
    schema_name: String(row?.schema_name || ""),
    table_name: String(row?.table_name || ""),
    constraint_name: String(row?.constraint_name || ""),
    definition: String(row?.definition || ""),
    constraint_comment: row?.constraint_comment == null ? null : String(row.constraint_comment),
  };
  if (!constraint.schema_name || !constraint.table_name || !constraint.constraint_name
      || constraint.schema_name.length > 63 || constraint.table_name.length > 63
      || constraint.constraint_name.length > 63) {
    throw new Error("An unvalidated restore check has an invalid PostgreSQL identity.");
  }
  if (row?.constraint_type !== "c" || row?.validated !== false
      || row?.is_local !== true || Number(row?.inherited_count) !== 0) {
    throw new Error(`Unvalidated restore check ${constraint.schema_name}.${constraint.table_name}.${constraint.constraint_name} is not one local CHECK constraint.`);
  }
  if (!constraint.definition.startsWith("CHECK (")
      || !constraint.definition.endsWith(" NOT VALID")
      || /[;\0]/.test(constraint.definition)) {
    throw new Error(`Unvalidated restore check ${constraint.schema_name}.${constraint.table_name}.${constraint.constraint_name} has an unsafe definition.`);
  }
  return constraint;
}

export function restoreCheckEvidence(constraints) {
  const rows = constraints.map((constraint) => ({
    schema_name: constraint.schema_name,
    table_name: constraint.table_name,
    constraint_name: constraint.constraint_name,
    definition: constraint.definition,
    constraint_comment: constraint.constraint_comment,
  }));
  return {
    count: rows.length,
    sha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
    constraints: rows.map(({ schema_name, table_name, constraint_name }) => ({ schema_name, table_name, constraint_name })),
  };
}

export async function suspendUnvalidatedRestoreChecks(db, databaseTables) {
  const targets = normalizeTargetTables(databaseTables);
  if (!targets.size) return [];
  const schemas = [...new Set(databaseTables.map((table) => String(table.schema_name)))].sort();
  const result = await db.query(`
    select
      n.nspname schema_name,
      c.relname table_name,
      con.conname constraint_name,
      con.contype constraint_type,
      con.convalidated validated,
      con.conislocal is_local,
      con.coninhcount::int inherited_count,
      pg_get_constraintdef(con.oid,true) definition,
      obj_description(con.oid,'pg_constraint') constraint_comment
    from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname=any($1::text[])
      and con.contype='c'
      and not con.convalidated
    order by n.nspname,c.relname,con.conname
  `, [schemas]);
  const constraints = result.rows
    .filter((row) => targets.has(tableIdentity(row.schema_name, row.table_name)))
    .map(normalizeConstraint);
  if (constraints.length > MAX_RESTORE_CHECKS) {
    throw new Error(`Restore target has ${constraints.length} unvalidated CHECK constraints; the supported maximum is ${MAX_RESTORE_CHECKS}.`);
  }
  const identities = new Set();
  for (const constraint of constraints) {
    const identity = JSON.stringify([constraint.schema_name, constraint.table_name, constraint.constraint_name]);
    if (identities.has(identity)) throw new Error("Restore target returned a duplicate unvalidated CHECK constraint identity.");
    identities.add(identity);
    await db.query(
      `alter table ${quoteIdentifier(constraint.schema_name)}.${quoteIdentifier(constraint.table_name)} drop constraint ${quoteIdentifier(constraint.constraint_name)}`,
    );
  }
  return constraints;
}

export async function reinstateUnvalidatedRestoreChecks(db, constraints) {
  if (!Array.isArray(constraints) || constraints.length > MAX_RESTORE_CHECKS) {
    throw new Error("Suspended restore CHECK constraint inventory is malformed.");
  }
  for (const raw of constraints) {
    const constraint = normalizeConstraint({
      ...raw,
      constraint_type: "c",
      validated: false,
      is_local: true,
      inherited_count: 0,
    });
    const relation = `${quoteIdentifier(constraint.schema_name)}.${quoteIdentifier(constraint.table_name)}`;
    await db.query(`alter table ${relation} add constraint ${quoteIdentifier(constraint.constraint_name)} ${constraint.definition}`);
    if (constraint.constraint_comment !== null) {
      await db.query(`comment on constraint ${quoteIdentifier(constraint.constraint_name)} on ${relation} is ${quoteLiteral(constraint.constraint_comment)}`);
    }
    const verified = await db.query(`
      select
        con.contype constraint_type,
        con.convalidated validated,
        con.conislocal is_local,
        con.coninhcount::int inherited_count,
        pg_get_constraintdef(con.oid,true) definition,
        obj_description(con.oid,'pg_constraint') constraint_comment
      from pg_constraint con
      join pg_class c on c.oid=con.conrelid
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname=$1 and c.relname=$2 and con.conname=$3
    `, [constraint.schema_name, constraint.table_name, constraint.constraint_name]);
    if (verified.rowCount !== 1) {
      throw new Error(`Restore CHECK constraint ${constraint.schema_name}.${constraint.table_name}.${constraint.constraint_name} was not reinstated.`);
    }
    const actual = normalizeConstraint({
      ...verified.rows[0],
      schema_name: constraint.schema_name,
      table_name: constraint.table_name,
      constraint_name: constraint.constraint_name,
    });
    if (actual.definition !== constraint.definition || actual.constraint_comment !== constraint.constraint_comment) {
      throw new Error(`Restore CHECK constraint ${constraint.schema_name}.${constraint.table_name}.${constraint.constraint_name} changed while being reinstated.`);
    }
  }
  return restoreCheckEvidence(constraints);
}

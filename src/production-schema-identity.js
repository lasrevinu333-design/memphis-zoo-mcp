import assert from "node:assert/strict";
import { captureSchemaCatalog, fingerprintSchemaCatalog, SCHEMA_CATALOG_NAMES,
  APPLICATION_PRIVATE_DEFAULT_PRIVILEGES_QUERY } from "../scripts/schema-fingerprint-catalog.mjs";
import { withReadOnlySnapshot } from "./supabase/read.js";

// This deliberately calculates the fingerprint from the connected database's
// catalog.  A source-controlled fingerprint is a deployment *target*, never
// evidence that the connected production database reached that target.
export async function observeProductionSchemaIdentity({ pool } = {}) {
  const inventory = await withReadOnlySnapshot(read => captureSchemaCatalog({
    query: async (sql) => {
      // Keep the exact shared predicate, with its SQL keyword supplied as a
      // value to the restricted reader rather than part of the statement.
      const result = sql === APPLICATION_PRIVATE_DEFAULT_PRIVILEGES_QUERY
        ? await read(sql.replace("'CREATE'", "$1::text"), ["CREATE"])
        : await read(sql);
      assert.equal(result.ok, true, "schema identity read failed");
      assert.equal(result.row_limit_truncated, false, "schema identity read was row-truncated");
      assert.equal(result.response_truncated, false, "schema identity read was byte-truncated");
      assert.ok(Array.isArray(result.rows), "schema identity read returned no rows");
      return { rows: result.rows };
    },
  }), { pool, maxRows: 250_000, maxResponseBytes: 100_000_000 });
  const { fingerprint } = fingerprintSchemaCatalog(inventory);
  return Object.freeze({
    observation: "connected_database_catalog.v1",
    fingerprint,
    catalog_sections: SCHEMA_CATALOG_NAMES,
  });
}

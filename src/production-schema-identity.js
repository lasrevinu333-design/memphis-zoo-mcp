import assert from "node:assert/strict";
import { captureSchemaCatalog, fingerprintSchemaCatalog, SCHEMA_CATALOG_NAMES } from "../scripts/schema-fingerprint-catalog.mjs";

// This deliberately calculates the fingerprint from the connected database's
// catalog.  A source-controlled fingerprint is a deployment *target*, never
// evidence that the connected production database reached that target.
export async function observeProductionSchemaIdentity({ runReadOnlySql }) {
  assert.equal(typeof runReadOnlySql, "function", "a read-only database executor is required");
  const inventory = await captureSchemaCatalog({
    query: async (sql) => {
      const result = await runReadOnlySql(sql);
      assert.equal(result.ok, true, "schema identity read failed");
      assert.equal(result.row_limit_truncated, false, "schema identity read was row-truncated");
      assert.equal(result.response_truncated, false, "schema identity read was byte-truncated");
      assert.ok(Array.isArray(result.rows), "schema identity read returned no rows");
      return { rows: result.rows };
    },
  });
  const { fingerprint } = fingerprintSchemaCatalog(inventory);
  return Object.freeze({
    observation: "connected_database_catalog.v1",
    fingerprint,
    catalog_sections: SCHEMA_CATALOG_NAMES,
  });
}

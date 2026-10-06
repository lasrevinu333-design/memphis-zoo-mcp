import assert from 'node:assert/strict';
import pg from 'pg';
import {SCHEMA_CATALOG_QUERIES} from './schema-fingerprint-catalog.mjs';

// A dedicated offline/release reader, not an application SQL endpoint. Query
// text is exclusively the source-controlled catalog inventory below.
export function catalogConnectionOptions({connectionString,caPem}) {
  let url;try{url=new URL(connectionString);}catch{throw Error('A configured PostgreSQL URL is required for catalog preflight.');}
  assert.ok(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname&&url.username&&url.password,'Explicit PostgreSQL catalog connection required');
  assert.match(String(caPem||''),/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/,'Trusted database CA certificate required');
  for(const name of ['sslmode','sslcert','sslkey','sslrootcert','ssl'])url.searchParams.delete(name);
  return {connectionString:url.toString(),ssl:{ca:caPem,rejectUnauthorized:true},
    application_name:'custodial-readonly-schema-preflight',connectionTimeoutMillis:15000,
    statement_timeout:15000,query_timeout:20000};
}

// Exact projection of the existing metadata helper, read with the backup
// account's already granted cron-table access. row_security=off makes a
// filtered/insufficiently privileged read fail instead of passing as empty.
export const NATIVE_CRON_CATALOG_SQL='select j.jobname,j.schedule,j.command,j.database,j.username,j.active from cron.job j order by j.jobname';
export async function captureCatalogFromSnapshot(client) {
  await client.query('set local row_security = off');
  const inventory={};
  for(const [name,sql] of Object.entries(SCHEMA_CATALOG_QUERIES)){
    const response=await client.query(name==='cron_jobs'?NATIVE_CRON_CATALOG_SQL:sql);
    assert.ok(Array.isArray(response?.rows),`Catalog result unavailable: ${name}`);
    inventory[name]=response.rows.map(row=>{if(!Object.hasOwn(row,'object_comment'))return row;const next={...row,comment:row.object_comment};delete next.object_comment;return next;});
  }
  return inventory;
}

export async function readCatalogReadOnly({connectionString,caPem,Client=pg.Client}) {
  const client=new Client(catalogConnectionOptions({connectionString,caPem}));let connected=false;
  try{
    await client.connect();connected=true;
    await client.query('begin isolation level repeatable read read only deferrable');
    const state=await client.query("select current_setting('transaction_read_only') as read_only");
    assert.equal(state.rows?.[0]?.read_only,'on','The catalog reader must enter a database-enforced read-only transaction');
    const inventory=await captureCatalogFromSnapshot(client);
    await client.query('rollback');return inventory;
  }catch(error){
    if(connected)await client.query('rollback').catch(()=>{});
    // Do not expose credentials embedded in driver connection errors.
    const failure=new Error('Read-only catalog preflight failed; no migration was applied.');
    failure.code=/^[A-Z0-9_]{1,32}$/.test(String(error?.code||''))?error.code:'CATALOG_READ_FAILED';throw failure;
  }finally{await client.end().catch(()=>{});}
}

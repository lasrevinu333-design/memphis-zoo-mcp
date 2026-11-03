import {readFileSync,writeFileSync} from 'node:fs';
import {SCHEMA_CATALOG_QUERIES,RECOVERY_SCHEMA_OWNERS_QUERY,APPLICATION_PRIVATE_SCHEMA_OWNERS_QUERY,
 APPLICATION_PRIVATE_DEFAULT_PRIVILEGES_QUERY,APPLICATION_PRIVATE_DOMAIN_CONSTRAINTS_QUERY,
 UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY,UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY,
 captureSchemaCatalog,fingerprintSchemaCatalog} from './schema-fingerprint-catalog.mjs';
const queries={...SCHEMA_CATALOG_QUERIES,recovery_owner:RECOVERY_SCHEMA_OWNERS_QUERY,private_owners:APPLICATION_PRIVATE_SCHEMA_OWNERS_QUERY,
 private_defaults:APPLICATION_PRIVATE_DEFAULT_PRIVILEGES_QUERY,private_domains:APPLICATION_PRIVATE_DOMAIN_CONSTRAINTS_QUERY,
 unsupported_relations:UNSUPPORTED_PUBLIC_RELATION_CLASSES_QUERY,unsupported_types:UNSUPPORTED_PUBLIC_TYPE_CLASSES_QUERY};
if(process.argv[2]==='--sql'){
 process.stdout.write('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n');
 for(const [name,sql] of Object.entries(queries))process.stdout.write(`SELECT jsonb_build_object('name','${name}','rows',coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb)) FROM (${sql}) q;\n`);
 process.stdout.write('ROLLBACK;\n');
}else if(process.argv[2]==='--from-recorded'){
 const lines=readFileSync(process.argv[3],'utf8').trim().split('\n').map(l=>JSON.parse(l)),byName=new Map(lines.map(x=>[x.name,x.rows]));
 const bySql=new Map(Object.entries(queries).map(([name,sql])=>[sql,byName.get(name)]));
 if(lines.length!==Object.keys(queries).length||byName.size!==lines.length)throw Error('Complete single-snapshot source query set required');
 const inventory=await captureSchemaCatalog({async query(sql){const rows=bySql.get(sql);if(!Array.isArray(rows))throw Error('Unknown/missing source catalog query');return{rows};}});
 writeFileSync(process.argv[4],JSON.stringify({scope:'OWNED_FRESH_NO_AUTO_CANDIDATE_METADATA_NOT_PRODUCTION_OR_RELEASE_ADMISSION',schema_fingerprint:fingerprintSchemaCatalog(inventory).fingerprint,counts:Object.fromEntries(Object.entries(inventory).map(([k,v])=>[k,v.length])),catalog:inventory},null,2)+'\n');
}else throw Error('Choose --sql or --from-recorded RAW_JSONL OUTPUT_JSON');

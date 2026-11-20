// Fixed offline successor and exact whole-predecessor inverse. No target port.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const serial=value=>JSON.stringify(value,null,2)+'\n';
const priorPin='6f35188dc390ec414f55270dbe6f472ea7887a7c028b777528916e6dff029661';
const marker='-- Current postgres locked catalog stability; no DATA or new admission authority.\n';
function fixedInverse(){
 const raw=readFileSync(new URL('../release/installed-source/20261120_locked_catalog_context_inverse.json',import.meta.url),'utf8');
 assert.equal(sha(raw),'9dc12726c44a3841ce8627c29ae6d76e43e6a4da0ae607f2efd43e60dff860e0');
 const inverse=JSON.parse(raw);assert.equal(inverse.format,'custodial.current-catalog-stability-program-inverse.v1');
 assert.equal(inverse.previousProgramSha256,priorPin);assert.equal(inverse.hunks.length,6);
 const helper=readFileSync(new URL('../proposals/immutable-current-catalog-stability.sql',import.meta.url),'utf8');
 assert.equal(sha(helper),'3a21db2c1856e2311b4c29e29f8ce258ce21483b7cb45257c34c70b73002e3b5');
 assert.equal(sha(helper),inverse.helperSqlSha256);assert.ok(helper.startsWith(marker));
 assert.equal(inverse.hunks.at(-1).after,helper+'\nCOMMIT;\n');return inverse;
}
export function extendCurrentCatalogStability(prior){
 assert.equal(arguments.length,1);assert.equal(sha(serial(prior)),priorPin);
 const inverse=fixedInverse(),program=structuredClone(prior),statement=program.statements[0];
 assert.equal(sha(statement.sql),inverse.previousStatementSha256);
 for(const hunk of inverse.hunks){assert.equal(statement.sql.split(hunk.before).length,2);statement.sql=statement.sql.replace(hunk.before,()=>hunk.after);}
 statement.sourceSha256=sha(statement.sql);assert.equal(statement.sourceSha256,inverse.currentStatementSha256);
 assert.deepEqual(removeCurrentCatalogStability(program),prior);return program;
}
export function removeCurrentCatalogStability(current){
 assert.equal(arguments.length,1);const program=structuredClone(current),statement=program.statements[0];
 if(!statement.sql.includes(marker))return program;
 const inverse=fixedInverse();assert.equal(sha(statement.sql),statement.sourceSha256);
 assert.equal(statement.sourceSha256,inverse.currentStatementSha256);
 for(const hunk of inverse.hunks){assert.equal(statement.sql.split(hunk.after).length,2);statement.sql=statement.sql.replace(hunk.after,()=>hunk.before);}
 statement.sourceSha256=sha(statement.sql);assert.equal(statement.sourceSha256,inverse.previousStatementSha256);
 assert.equal(sha(serial(program)),priorPin,'Entire catalog-stability predecessor must remain exact');return program;
}

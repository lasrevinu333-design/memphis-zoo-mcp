// Historical source-lineage proof only; not imported by a database executor.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const sha=s=>createHash('sha256').update(s).digest('hex');
const prior=[
 ['3ad9148af807267bbf0ea00b893a720b760114244b92c97f6d76ea1805f77e8f','d63717c9f843bd5ddf2134ff37c50c8183bdd8a75b847a4a298248ec2ae323be'],
 ['0213f2b256bcac7b8db623758ef26807583ea27074a7c362af259122d4275dca','c47b1d5e1718eaefd9c6a628fd2cc0ffb6e4c5099b40435af6fe306df2deb17f'],
];
export function reverseCurrent310ProductionRoleOrderOnly(sql,order) {
 const i=order-176;assert.ok(i===0||i===1);
 const blocks=sql.match(new RegExp(` -- BEGIN FINITE CURRENT31${i} PRODUCTION ROLE ORDER\\n[\\s\\S]*? -- END FINITE CURRENT31${i} PRODUCTION ROLE ORDER\\n`,'g'))||[];
 assert.equal(blocks.length,1);
 let original=sql.replace(blocks[0],'')
  .replace(`\n expected_inventory text:='${prior[i][0]}';`,'')
  .replace(' IF actual IS DISTINCT FROM expected_inventory THEN',` IF actual IS DISTINCT FROM '${prior[i][0]}' THEN`);
 if(i===0){
  const temp=original.match(/-- BEGIN FINITE CURRENT310 POSTCONDITION SELECTION\n[\s\S]*?-- END FINITE CURRENT310 POSTCONDITION SELECTION\n/g)||[];
  assert.equal(temp.length,1);original=original.replace(temp[0],'')
   .replace('IF actual IS DISTINCT FROM (SELECT expected_post FROM q310_role_order_profile) THEN',`IF actual IS DISTINCT FROM '${prior[1][0]}' THEN`);
 }
 assert.equal(sha(original),prior[i][1]);return original;
}

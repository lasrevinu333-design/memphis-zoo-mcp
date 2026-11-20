import assert from 'node:assert/strict';
// Counts are consequences of exact accepted bytes, never an operator-selected
// number or a substitute for assignment, lunch and hard-constraint validation.
const profiles=new Map([
 ['eeff371f1510c6e4a079bde3ba17136dc10f64b100c7562d9b139fd14805a1c8',{staff:8,assignments:346,lunches:40}],
 ['85ad93db39597cffc033992ec74d5eea98612ce9a8388a9e93f5566f4e38bc4c',{staff:8,assignments:327,lunches:40}],
 ['fe0257dbd8cb4dd2f63c4da1997342067945e87a6ce516aee0698debef5d9a58',{staff:7,assignments:323,lunches:35}],
]);
for(const value of profiles.values())Object.freeze(value);
export function acceptedManualPatternProfile(manualDataDigest){
 assert.ok(profiles.has(manualDataDigest),'Exact admitted manual policy required');
 return profiles.get(manualDataDigest);
}

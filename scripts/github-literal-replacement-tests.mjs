import assert from 'node:assert/strict';
import {replaceManyInFile,replaceTextInFile} from '../src/github/write.js';
import {previewTextReplacement} from '../src/github/patch.js';
let cases=0;
const oldSha='1'.repeat(40),original='before TARGET middle TARGET after';
for(const replacement of ['literal:$&','literal:$$','literal:$`',"literal:$'",'literal:$1:$<name>:\\n']) {
 for(const occurrence of ['first','all']) {
  const expected=occurrence==='first'?'before '+replacement+' middle TARGET after':'before '+replacement+' middle '+replacement+' after';
  const preview=previewTextReplacement({oldText:original,find:'TARGET',replace:replacement,occurrence,expectedMatches:2});
  assert.equal(preview.newText,expected);cases++;
  for(const fn of [replaceTextInFile,replaceManyInFile]) {
   for(const dry_run of [true,false]) {
    const writes=[];
    const repos={
     getContent:async()=>({data:{type:'file',sha:oldSha,size:Buffer.byteLength(original),content:Buffer.from(original).toString('base64'),encoding:'base64'}}),
     createOrUpdateFileContents:async v=>{writes.push(v);return{data:{content:{sha:'2'.repeat(40)},commit:{html_url:'https://synthetic.invalid/commit'}}};},
    };
    const github={owner:'synthetic-owner',defaultRepo:'synthetic-repo',allowedRepos:['synthetic-repo'],branch:'main',octokit:{rest:{repos}}};
    await fn({github,repo:'synthetic-repo',path:'source.txt',find:'TARGET',replace:replacement,occurrence,replacements:[{find:'TARGET',replace:replacement,occurrence,expected_matches:2}],expected_sha:oldSha,commit_message:'Synthetic literal replacement',dry_run});
    assert.equal(writes.length,dry_run?0:1);
    if(!dry_run)assert.equal(Buffer.from(writes[0].content,'base64').toString(),expected);
    cases++;
   }
  }
 }
}
assert.throws(()=>previewTextReplacement({oldText:original,find:'TARGET',replace:'literal',expectedMatches:1}));cases++;
console.log(JSON.stringify({suite:'literal preview/single/batch replacement',cases,result:'PASS',provider:'synthetic'}));

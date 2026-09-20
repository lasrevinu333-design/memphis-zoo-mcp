import assert from 'node:assert/strict';

const wordStart = (c) => !!c && /[A-Za-z_\u0080-\uffff]/u.test(c);
const wordPart = (c) => !!c && /[A-Za-z0-9_$\u0080-\uffff]/u.test(c);
export const quoteIdentifier = (value) => `"${String(value).replaceAll('"','""')}"`;
const kw = (token, value) => token?.kind === 'identifier' && !token.quoted && token.value === value;

export function splitSchemaStatements(sql) {
  const statements=[], guards=[], skipped=[];
  let i=0, start=0, tokens=[];
  const raw=(a,b)=>{let out='',p=a;for(const [x,y] of skipped){if(x>=a&&y<=b){out+=sql.slice(p,x);p=y;}}return out+sql.slice(p,b);};
  const token=(kind,value,begin,quoted=false)=>tokens.push({kind,value,start:begin,end:i,quoted});
  while(i<sql.length){
    const c=sql[i];
    if(/\s/.test(c)){i++;continue;}
    if(sql.startsWith('--',i)){const n=sql.indexOf('\n',i);i=n<0?sql.length:n+1;continue;}
    if(sql.startsWith('/*',i)){let depth=1;i+=2;while(i<sql.length&&depth){if(sql.startsWith('/*',i)){depth++;i+=2;}else if(sql.startsWith('*/',i)){depth--;i+=2;}else i++;}assert.equal(depth,0,'Unterminated block comment');continue;}
    if(c==='\\'){
      assert.equal(tokens.length,0,'psql command inside SQL statement');
      const n=sql.indexOf('\n',i),end=n<0?sql.length:n+1;
      const match=sql.slice(i,end).trim().match(/^\\(unrestrict|restrict) ([A-Za-z0-9]+)$/);
      assert.ok(match,'Unsupported top-level psql command');guards.push({kind:match[1],value:match[2]});skipped.push([i,end]);i=end;continue;
    }
    if(c==="'"||c==='"'){
      const begin=i,quote=c,esc=quote==="'"&&i>0&&/[eE]/.test(sql[i-1])&&(i<2||!wordPart(sql[i-2]));
      let value='',closed=false;i++;
      while(i<sql.length){if(sql[i]===quote){if(sql[i+1]===quote){value+=quote;i+=2;continue;}i++;closed=true;break;}if(esc&&sql[i]==='\\'){assert.ok(i+1<sql.length);value+=sql.slice(i,i+2);i+=2;continue;}value+=sql[i++];}
      assert.ok(closed,'Unterminated quoted token');token(quote==='"'?'identifier':'literal',value,begin,quote==='"');continue;
    }
    if(c==='$'){
      const tag=sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0];
      if(tag){const begin=i,end=sql.indexOf(tag,i+tag.length);assert.ok(end>=0,'Unterminated dollar body');i=end+tag.length;token('literal',sql.slice(begin,i),begin);continue;}
    }
    if(wordStart(c)){const begin=i++;while(wordPart(sql[i]))i++;token('identifier',sql.slice(begin,i).toLowerCase(),begin);continue;}
    if(c===';'){i++;token('symbol',';',i-1);if(tokens.length>1)statements.push({start,end:i,text:raw(start,i),leading:raw(start,tokens[0].start),tokens});start=i;tokens=[];continue;}
    i++;token('symbol',c,i-1);
  }
  assert.equal(tokens.length,0,'Unterminated final SQL statement');
  assert.ok(guards.length===0||(guards.length===2&&guards[0].kind==='restrict'&&guards[1].kind==='unrestrict'&&guards[0].value===guards[1].value),'Mismatched psql restrict guards');
  return {statements,psqlGuards:guards.length};
}

function reader(tokens){let i=0;return {takeKeyword(v){assert.ok(kw(tokens[i++],v),`Expected keyword ${v}`);},takeSymbol(v){assert.equal(tokens[i++]?.value,v,`Expected symbol ${v}`);},identifier(){const t=tokens[i++];assert.equal(t?.kind,'identifier','Expected SQL identifier');return t.value;},peek(){return tokens[i];},end(){assert.equal(i,tokens.length,'Unexpected trailing event-trigger syntax');}};}
const functionKey=(schema,name)=>JSON.stringify([schema,name]);
function functionOwner(statement){const t=statement.tokens;if(!kw(t[0],'alter')||!kw(t[1],'function'))return null;const r=reader(t);r.takeKeyword('alter');r.takeKeyword('function');const schema=r.identifier();r.takeSymbol('.');const name=r.identifier();r.takeSymbol('(');if(r.peek()?.value!==')')return null;r.takeSymbol(')');if(!kw(r.peek(),'owner'))return null;r.takeKeyword('owner');r.takeKeyword('to');const owner=r.identifier();r.takeSymbol(';');r.end();return {key:functionKey(schema,name),owner};}
function createEvent(statement){const r=reader(statement.tokens);r.takeKeyword('create');r.takeKeyword('event');r.takeKeyword('trigger');const name=r.identifier();r.takeKeyword('on');const event=r.identifier();assert.ok(['ddl_command_start','ddl_command_end','sql_drop','table_rewrite'].includes(event),'Unsupported event');if(kw(r.peek(),'when')){r.takeKeyword('when');r.takeKeyword('tag');r.takeKeyword('in');r.takeSymbol('(');for(;;){assert.equal(r.peek()?.kind,'literal','Expected event tag string');const tag=r.peek().value;assert.equal(typeof tag,'string');r.takeSymbol(tag);if(r.peek()?.value!==',')break;r.takeSymbol(',');}r.takeSymbol(')');}r.takeKeyword('execute');const exec=r.identifier();assert.ok(['function','procedure'].includes(exec),'Unsupported event function invocation');const schema=r.identifier();r.takeSymbol('.');const fn=r.identifier();r.takeSymbol('(');r.takeSymbol(')');r.takeSymbol(';');r.end();const headers=[...statement.leading.matchAll(/^-- Name: (.*); Type: EVENT TRIGGER; Schema: -; Owner: (.*)$/gm)];assert.equal(headers.length,1,'Missing or duplicate event-trigger owner header');const [,headerName,headerOwner]=headers[0];assert.ok([name,quoteIdentifier(name)].includes(headerName),'Event header name mismatch');return {name,schema,fn,key:functionKey(schema,fn),headerOwner};}
function alterEvent(statement){const r=reader(statement.tokens);r.takeKeyword('alter');r.takeKeyword('event');r.takeKeyword('trigger');const name=r.identifier();let owner=null,state=null;if(kw(r.peek(),'owner')){r.takeKeyword('owner');r.takeKeyword('to');owner=r.identifier();}else{state=r.identifier();assert.ok(['enable','disable'].includes(state),'Unsupported event-trigger alteration');if(state==='enable'&&r.peek()?.value!==';'){const mode=r.identifier();assert.ok(['always','replica'].includes(mode));state+=' '+mode;}}r.takeSymbol(';');r.end();return {name,owner,state};}

export function planEventOwnerRestore(sql){
  const {statements,psqlGuards}=splitSchemaStatements(sql),owners=new Map(),commands=[],seen=new Set();
  for(const s of statements){const o=functionOwner(s);if(o){assert.ok(!owners.has(o.key),'Duplicate function owner record');owners.set(o.key,o.owner);}}
  for(let i=0;i<statements.length;i++){
    const s=statements[i],t=s.tokens;
    assert.ok(!(kw(t[0],'set')&&kw(t[1],'role')),'Unexpected global SET ROLE in archive');
    if(kw(t[0],'set')&&kw(t[1],'session')&&kw(t[2],'authorization')){
      assert.equal(t.length,5,'Unsupported archive ACL grantor scope');assert.equal(t[3].kind,'identifier','Expected recorded grantor identifier');const scope=[s];let reset=false;
      while(++i<statements.length){const n=statements[i],nt=n.tokens;scope.push(n);if(kw(nt[0],'reset')&&kw(nt[1],'session')&&kw(nt[2],'authorization')&&nt.length===4){reset=true;break;}assert.ok(kw(nt[0],'grant')||kw(nt[0],'revoke'),'Archive authorization scopes must contain only GRANT/REVOKE, not global owner serialization');}
      assert.ok(reset,'Unterminated archive ACL grantor scope');commands.push({kind:'acl',statements:scope});
    }else if(kw(t[0],'create')&&kw(t[1],'event')&&kw(t[2],'trigger')){
      const e=createEvent(s),block=[s];assert.ok(!seen.has(e.name),'Duplicate event trigger');seen.add(e.name);let owner=null,state=null;
      while(i+1<statements.length){const n=statements[i+1];if(!(kw(n.tokens[0],'alter')&&kw(n.tokens[1],'event')&&kw(n.tokens[2],'trigger')))break;const a=alterEvent(n);assert.equal(a.name,e.name,'Event-trigger ALTER name mismatch');if(a.owner!==null){assert.equal(owner,null,'Duplicate event-trigger owner record');owner=a.owner;}if(a.state!==null){assert.equal(state,null,'Duplicate event-trigger state record');state=a.state;}block.push(n);i++;}
      assert.ok(owner,'Missing owning ALTER EVENT TRIGGER record');assert.ok([owner,quoteIdentifier(owner)].includes(e.headerOwner),'Event owner header mismatch');assert.equal(owners.get(e.key),owner,'Event and function archive owner mismatch');commands.push({kind:'event',...e,owner,statements:block});
    }else{assert.ok(!(kw(t[0],'alter')&&kw(t[1],'event')&&kw(t[2],'trigger')&&kw(t[4],'owner')),'Unmatched event-trigger ownership alteration');commands.push({kind:'sql',statements:[s]});}
  }
  assert.ok(seen.size>0,'No event-trigger restore blocks found');return {commands,statementCount:statements.length,eventCount:seen.size,psqlGuards};
}

export async function executeEventOwnerPlan(client,plan){
  const initial=(await client.query("select current_user, session_user")).rows[0];assert.equal(initial.current_user,'supabase_admin');assert.equal(initial.session_user,'supabase_admin');
  let executed=0,events=0;
  for(const command of plan.commands){
    if(command.kind==='event'){
      const actual=(await client.query("select pg_get_userbyid(p.proowner) owner_name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and p.proname=$2 and p.pronargs=0",[command.schema,command.fn])).rows;
      assert.equal(actual.length,1,'Restored event function is absent or ambiguous');assert.equal(actual[0].owner_name,command.owner,'Restored function owner differs from signed archive');
      await client.query(`SET ROLE ${quoteIdentifier(command.owner)}`);
      try{for(const s of command.statements){await client.query(s.text);executed++;}events++;}finally{await client.query('RESET ROLE');}
      const after=(await client.query('select current_user, session_user')).rows[0];assert.deepEqual(after,initial,'Event owner context leaked');
    }else if(command.kind==='acl'){
      try{for(const s of command.statements){await client.query(s.text);executed++;}}finally{await client.query('RESET SESSION AUTHORIZATION');}
      const after=(await client.query('select current_user, session_user')).rows[0];assert.deepEqual(after,initial,'Archive ACL grantor context leaked');
    }else for(const s of command.statements){await client.query(s.text);executed++;}
  }
  await client.query('RESET ROLE');return {executedStatements:executed,eventBlocks:events,ownerContextReset:true};
}

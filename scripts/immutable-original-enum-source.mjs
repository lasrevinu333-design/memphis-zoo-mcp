// Pure descriptor DATA from the existing authenticated schema SQL. This
// parser grants nothing; only the comparator supplies private archive bytes.
import {splitSchemaStatements} from './isolated-event-owner-schema.mjs';

const unavailable=()=>{throw Object.assign(new Error('Original enum Source is unsupported.'),{
  code:'IMMUTABLE_ORIGINAL_ENUM_SOURCE_UNSUPPORTED',
});};
const kw=(token,value)=>token?.kind==='identifier'&&!token.quoted&&token.value===value;
const identifier=token=>{
  if(token?.kind!=='identifier'||!/^[a-z_][a-z0-9_]*(?![\s\S])/.test(token.value)
    ||Buffer.byteLength(token.value,'utf8')>63)unavailable();
  return token.value;
};
function reader(tokens){
  let i=0;
  return {word(value){if(!kw(tokens[i++],value))unavailable();},symbol(value){
    const token=tokens[i++];if(token?.kind!=='symbol'||token.value!==value)unavailable();
  },id(){return identifier(tokens[i++]);},peek(){return tokens[i];},take(){return tokens[i++];},
  end(){if(i!==tokens.length)unavailable();}};
}

// Narrow supported pg_dump representation: CREATE SCHEMA auth + its explicit
// original owner, CREATE TYPE auth.<id> AS ENUM (standard quoted labels), and
// one explicit ALTER TYPE OWNER per definition. No names/labels are invented.
// The sole official Storage buckettype declaration is separately validated and
// omitted from this AUTH-only result. Other foreign type representations refuse.
export function deriveOriginalAuthEnumDescriptors(schemaSql){
  if(arguments.length!==1||typeof schemaSql!=='string'||!schemaSql.length
    ||Buffer.byteLength(schemaSql,'utf8')>32*1024*1024||schemaSql.includes('\0')
    ||Buffer.from(schemaSql,'utf8').toString('utf8')!==schemaSql)unavailable();
  try {
    const {statements}=splitSchemaStatements(schemaSql),enums=new Map();
    let strings=false,stringDeclarations=0,schemaCreated=false,schemaOwner=null;
    let storageSchemaCreated=false,storageSchemaOwner=null,storageBucketEnum=null;
    for(const statement of statements){
      const t=statement.tokens,r=reader(t);
      if(kw(t[0],'set')&&t.some(token=>token.kind==='identifier'&&token.value==='standard_conforming_strings')){
        r.word('set');r.word('standard_conforming_strings');r.symbol('=');r.word('on');r.symbol(';');r.end();
        if(++stringDeclarations!==1||enums.size)unavailable();strings=true;
      }
      if(kw(t[0],'reset')&&t.some(token=>token.kind==='identifier'
        &&['all','standard_conforming_strings','client_encoding'].includes(token.value)))unavailable();
      if(kw(t[0],'set')&&t.some(token=>token.kind==='identifier'&&token.value==='client_encoding')){
        r.word('set');r.word('client_encoding');r.symbol('=');const value=r.take();
        if(value?.kind!=='literal'||value.value!=='UTF8')unavailable();r.symbol(';');r.end();
      }
      if(kw(t[0],'create')&&kw(t[1],'schema')&&t.some(token=>token.kind==='identifier'&&token.value==='auth')){
        r.word('create');r.word('schema');if(r.id()!=='auth')unavailable();r.symbol(';');r.end();
        if(schemaCreated||enums.size)unavailable();schemaCreated=true;
      }
      if(kw(t[0],'alter')&&kw(t[1],'schema')&&t[2]?.value==='auth'){
        r.word('alter');r.word('schema');r.id();r.word('owner');r.word('to');const owner=r.id();r.symbol(';');r.end();
        if(!schemaCreated||schemaOwner!==null||enums.size||owner!=='supabase_admin')unavailable();schemaOwner=owner;
      }
      if(kw(t[0],'create')&&kw(t[1],'schema')&&t[2]?.value==='storage'){
        r.word('create');r.word('schema');if(r.id()!=='storage')unavailable();r.symbol(';');r.end();
        if(storageSchemaCreated||storageBucketEnum)unavailable();storageSchemaCreated=true;
      }
      if(kw(t[0],'alter')&&kw(t[1],'schema')&&t[2]?.value==='storage'){
        r.word('alter');r.word('schema');r.id();r.word('owner');r.word('to');const owner=r.id();r.symbol(';');r.end();
        if(!storageSchemaCreated||storageSchemaOwner!==null||storageBucketEnum||owner!=='supabase_admin')unavailable();
        storageSchemaOwner=owner;
      }
      if(kw(t[0],'drop')&&kw(t[1],'schema')&&storageSchemaCreated
        &&t.some(token=>token.kind==='identifier'&&token.value==='storage'))unavailable();
      if(kw(t[0],'drop')&&kw(t[1],'schema')&&schemaCreated
        &&t.some(token=>token.kind==='identifier'&&token.value==='auth'))unavailable();
      if(['create','alter','drop'].some(word=>kw(t[0],word))&&kw(t[1],'domain'))unavailable();
      if(kw(t[0],'create')&&kw(t[1],'type')){
        r.word('create');r.word('type');const schema=r.id();r.symbol('.');const name=r.id();
        r.word('as');r.word('enum');r.symbol('(');
        const vendorBucket=schema==='storage'&&name==='buckettype';
        if(!strings||!schemaCreated||schemaOwner!=='supabase_admin'||enums.size>=256
          ||(schema==='auth'?enums.has(name):!vendorBucket||!storageSchemaCreated
            ||storageSchemaOwner!=='supabase_admin'||storageBucketEnum!==null))unavailable();
        const labels=[];
        for(;;){
          const token=r.take();
          // The shared splitter keeps a dollar body verbatim and E/U& string
          // prefixes as separate tokens. Accept ONLY standard single quotes.
          if(token?.kind!=='literal'||schemaSql[token.start]!=="'"
            ||typeof token.value!=='string'||token.value.includes('\0')
            ||Buffer.byteLength(token.value,'utf8')>63||labels.includes(token.value)||labels.length>=4096)unavailable();
          labels.push(token.value);
          if(r.peek()?.value!==',')break;r.symbol(',');
        }
        r.symbol(')');r.symbol(';');r.end();
        if(vendorBucket){
          if(labels.length!==3||labels.some((label,index)=>label!==['STANDARD','ANALYTICS','VECTOR'][index]))unavailable();
          storageBucketEnum={owner_name:null};
        }else enums.set(name,{kind:'e',schema_name:schema,type_name:name,namespace_owner:schemaOwner,owner_name:null,labels});
      }
      if(kw(t[0],'alter')&&kw(t[1],'type')){
        r.word('alter');r.word('type');const schema=r.id();r.symbol('.');const name=r.id();
        r.word('owner');r.word('to');const owner=r.id();r.symbol(';');r.end();
        const vendorBucket=schema==='storage'&&name==='buckettype';
        const entry=schema==='auth'?enums.get(name):vendorBucket?storageBucketEnum:null;
        if(!entry||entry.owner_name!==null||owner!==(vendorBucket?'supabase_storage_admin':'supabase_auth_admin'))unavailable();
        entry.owner_name=owner;
      }
      if(kw(t[0],'drop')&&kw(t[1],'type')&&(enums.size||storageBucketEnum))unavailable();
      // No opaque top-level execution or user cast declaration can change an
      // inferred type after/beside its parsed definition. Function bodies are
      // tokenized as literals, not recursively executed or regex-scanned.
      if(['do','call','execute'].some(word=>kw(t[0],word))
        ||(kw(t[0],'create')&&kw(t[1],'cast')))unavailable();
      if(kw(t[0],'select')){
        // Same sole pg_dump SELECT shape admitted by the existing schema
        // section parser, not a general configurable/opaque SQL evaluator.
        if(!(t.length===12&&kw(t[1],'pg_catalog')&&t[2]?.value==='.'&&kw(t[3],'set_config')
          &&t[4]?.value==='('&&t[5]?.kind==='literal'&&t[5].value==='search_path'
          &&t[6]?.value===','&&t[7]?.kind==='literal'&&t[7].value===''
          &&t[8]?.value===','&&kw(t[9],'false')&&t[10]?.value===')'&&t[11]?.value===';'))unavailable();
      }
    }
    for(const entry of enums.values())if(entry.owner_name===null)unavailable();
    if(storageBucketEnum&&storageBucketEnum.owner_name!=='supabase_storage_admin')unavailable();
    if(storageSchemaCreated&&storageSchemaOwner!=='supabase_admin')unavailable();
    return Object.freeze([...enums.values()].sort((a,b)=>a.type_name<b.type_name?-1:a.type_name>b.type_name?1:0)
      .map(entry=>Object.freeze({...entry,labels:Object.freeze(entry.labels)})));
  }catch{unavailable();}
}

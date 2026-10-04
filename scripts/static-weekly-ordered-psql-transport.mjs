// Test-only replay transport. A single Docker exec carries ordered, hashed
// frames; every frame still starts a NEW psql process with its own stdin.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const DIGEST=/^[a-f0-9]{64}$/;
const MAX_INPUT=16*1024*1024;
const MAX_RECEIPT=64*1024;
const MAX_FRAME_BASE64=2*1024*1024;
// These exact existing replay SQL strings remain the before/after policy for
// each fresh psql, including the three historical default-grant restorers.
export const DEFAULT_GRANTS_QUERY="select count(*) from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where d.defaclnamespace in (0,'public'::regnamespace) and d.defaclrole in ('postgres'::regrole,'supabase_admin'::regrole) and d.defaclobjtype in ('r','S') and a.grantee in (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole)";
export const REMOVE_DEFAULT_GRANTS_SQL=['postgres','supabase_admin'].flatMap(owner=>['',' in schema public'].map(scope=>`alter default privileges for role ${owner}${scope} revoke all on tables from public,anon,authenticated,service_role;alter default privileges for role ${owner}${scope} revoke all on sequences from public,anon,authenticated,service_role;`)).join('\n');
export const ABSENCE_GUARD=`do $absence$begin if (${DEFAULT_GRANTS_QUERY})<>0 then raise exception 'automatic Data API table/sequence grants must be absent'; end if;end$absence$;`;
export const RESTORE_DEFAULT_GRANTS_FILES=new Set([
 '20260718083100_reconstruct_public_grant_hardening.sql',
 '20260729150527_audit_defense_in_depth_hardening.sql',
 '20260815160613_normalize_managed_production_schema_security.sql',
]);
export const ORDERED_PSQL_SHELL=String.raw`set -eu
tmp=$(mktemp -d /tmp/mz-ordered-psql.XXXXXX) || exit 91
cleanup() { rm -f "$tmp/sql" "$tmp/b64" "$tmp/out" "$tmp/err"; rmdir "$tmp"; }
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
tick() { IFS=' ' read -r up ignored < /proc/uptime; printf '%s' "$up"; }
fail() { printf 'FAIL %s %s %s\n' "$expected" "$1" "$(tick)"; exit 92; }
expected=0
target=$1
case "$target" in ''|*[!0-9]*) fail COUNT;; esac
[ "$target" -gt 0 ] && [ "$target" -le 4096 ] || fail COUNT
printf 'READY %s\n' "$(tick)"
while IFS=' ' read -r tag index digest encodedLength || [ -n "$tag" ]; do
  [ "$expected" -lt "$target" ] || fail EXTRA
  [ "$tag" = FRAME ] || fail FRAME
  case "$index" in ''|*[!0-9]*) fail HEADER;; esac
  case "$encodedLength" in ''|*[!0-9]*) fail HEADER;; esac
  case "$digest" in ''|*[!0-9a-f]*) fail DIGEST;; esac
  [ "$index" = "$expected" ] || fail INDEX
  dlen=${'$'}{#digest}
  [ "$dlen" -eq 64 ] || fail DIGEST
  [ "$encodedLength" -gt 0 ] && [ "$encodedLength" -le 2097152 ] || fail LINES
  dd iflag=count_bytes,fullblock count="$encodedLength" of="$tmp/b64" status=none 2> "$tmp/err" || fail EOF
  [ "$(stat -c %s "$tmp/b64")" -eq "$encodedLength" ] || fail EOF
  IFS= read -r separator || fail EOF
  [ -z "$separator" ] || fail SIZE
  LC_ALL=C grep -qzE '^[A-Za-z0-9+/=]+$' "$tmp/b64" || fail BASE64
  base64 -d "$tmp/b64" > "$tmp/sql" 2> "$tmp/err" || fail DECODE
  actual=$(sha256sum "$tmp/sql"); actual=${'$'}{actual%% *}
  [ "$actual" = "$digest" ] || fail HASH
  printf 'BEGIN %s %s\n' "$expected" "$(tick)"
  if (ulimit -f 65536 && psql -X -q -At -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < "$tmp/sql" > "$tmp/out" 2> "$tmp/err"); then
    sizes=$(stat -c %s "$tmp/out" "$tmp/err") || fail SIZE
    set -- $sizes
    [ "$#" -eq 2 ] && [ "$1" -le 33554432 ] && [ "$2" -le 33554432 ] || fail SIZE
    printf 'OK %s %s\n' "$expected" "$(tick)"
  else
    status=$?
    case "$status" in
      1) fail PSQL_EXIT_1;;
      2) fail PSQL_EXIT_2;;
      3) fail PSQL_EXIT_3;;
      *) fail PSQL_EXIT_OTHER;;
    esac
  fi
  expected=$((expected+1))
done
[ "$expected" -eq "$target" ] || fail COUNT
printf 'DONE %s %s\n' "$expected" "$(tick)"`;

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function orderedSqlBatch({absenceGuard,bytes,restoreDefaultsSql=''}){
 assert.ok(typeof absenceGuard==='string'&&absenceGuard.length>0);
 assert.ok(typeof restoreDefaultsSql==='string');
 assert.ok(Buffer.isBuffer(bytes)&&bytes.length>0);
 // The previous per-file call interpolated UTF-8 migration text. Refuse an
 // invalid encoding rather than silently changing those SQL bytes.
 assert.deepEqual(Buffer.from(bytes.toString('utf8')),bytes,'migration UTF-8 bytes');
 return Buffer.concat([Buffer.from(absenceGuard+'\n'),bytes,
  Buffer.from('\n'+restoreDefaultsSql+'\n'+absenceGuard)]);
}
export function orderedPsqlFrames(entries){
 assert.ok(Array.isArray(entries)&&entries.length>0&&entries.length<=4096,'finite ordered migration list');
 let input='';
 let previous='';
 const manifest=entries.map(({file,batch},index)=>{
  assert.match(file,/^[0-9]{14}_[a-z0-9_]+\.sql$/,'migration filename');
  assert.ok(file>previous,'strict migration order and unique filenames');previous=file;
  assert.ok(Buffer.isBuffer(batch)&&batch.length>0,'exact SQL batch bytes');
  const digest=sha(batch),base64=batch.toString('base64');
  assert.ok(base64.length>0&&base64.length<=MAX_FRAME_BASE64,'bounded encoded frame');
  input+=`FRAME ${index} ${digest} ${base64.length}\n${base64}\n`;
  assert.ok(Buffer.byteLength(input)<=MAX_INPUT,'bounded channel input');
  return {file,sha256:digest};
 });
 return {input,manifest};
}

export function parseOrderedPsqlReceipt(output,entries,{allowFailure=false}={}){
 assert.ok(typeof output==='string'&&Buffer.byteLength(output)<=MAX_RECEIPT,'bounded protocol receipt');
 assert.ok(Array.isArray(entries)&&entries.length>0);
 const terminalNewline=output.endsWith('\n');
 const rows=output.trimEnd().split('\n');
 let cursor=0,completed=0,failed=null,incomplete=null,truncatedProtocolLine=false;
 const parseTick=value=>{const n=Number(value);assert.ok(Number.isFinite(n)&&n>=0,'finite monotonic tick');return n;};
 let match=/^READY ([0-9]+(?:\.[0-9]+)?)$/.exec(rows[cursor++]);
 assert.ok(match,'ready receipt');
 const readyTick=parseTick(match[1]),envelopes=[];
 let previousTick=readyTick;
 while(completed<entries.length){
  const row=rows[cursor];
  if(allowFailure&&row?.startsWith('FAIL '))break;
  match=/^BEGIN (\d+) ([0-9]+(?:\.[0-9]+)?)$/.exec(row??'');
  if(!match)break;
  assert.equal(Number(match[1]),completed,'ordered begin');
  const beginTick=parseTick(match[2]);assert.ok(beginTick>=previousTick,'ordered monotonic begin');cursor++;
  if(allowFailure&&(rows[cursor]??'').startsWith('FAIL ')){
   previousTick=beginTick;
   envelopes.push({index:completed,file:entries[completed].file,beginTick,endTick:null,envelopeMilliseconds:null});
   break;
  }
  match=/^OK (\d+) ([0-9]+(?:\.[0-9]+)?)$/.exec(rows[cursor]??'');
  if(!match){incomplete={index:completed,beginTick};break;}
  assert.equal(Number(match[1]),completed,'ordered completion');
  const endTick=parseTick(match[2]);assert.ok(endTick>=beginTick,'nonnegative file envelope');previousTick=endTick;
  envelopes.push({index:completed,file:entries[completed].file,beginTick,endTick,
   envelopeMilliseconds:Math.round((endTick-beginTick)*1000),
   cumulativeSinceChannelReadyMilliseconds:Math.round((endTick-readyTick)*1000)});
  completed++;cursor++;
 }
 match=/^FAIL (\d+) (FRAME|HEADER|INDEX|DIGEST|LINES|EOF|BASE64|SIZE|DECODE|HASH|PSQL_EXIT_1|PSQL_EXIT_2|PSQL_EXIT_3|PSQL_EXIT_OTHER|COUNT|EXTRA) ([0-9]+(?:\.[0-9]+)?)$/.exec(rows[cursor]??'');
 if(match){assert.ok(allowFailure,'failed channel cannot pass');assert.equal(Number(match[1]),completed);
  const tick=parseTick(match[3]);assert.ok(tick>=previousTick,'ordered monotonic failure');failed={index:completed,code:match[2],tick};cursor++;}
 let doneTick=null;
 match=/^DONE (\d+) ([0-9]+(?:\.[0-9]+)?)$/.exec(rows[cursor]??'');
 if(match){assert.equal(Number(match[1]),entries.length);assert.equal(completed,entries.length);assert.equal(failed,null);
  doneTick=parseTick(match[2]);assert.ok(doneTick>=previousTick,'ordered monotonic finish');cursor++;}
 if(!allowFailure)assert.ok(doneTick!==null,'complete protocol required');
 if(allowFailure&&doneTick===null&&failed===null&&cursor===rows.length-1&&!terminalNewline){
  truncatedProtocolLine=true;cursor++;
  incomplete??={index:completed<entries.length?completed:null,beginTick:null};
 }
 if(allowFailure&&doneTick===null&&failed===null)assert.ok(incomplete!==null||cursor===rows.length,'partial protocol only on error');
 assert.equal(cursor,rows.length,'no extra protocol output');
 return {completed,failed,incomplete,truncatedProtocolLine,readyTick,doneTick,envelopes,
  measurement:'container /proc/uptime centisecond envelope; includes fresh psql process and protocol I/O, not exclusive SQL time; stdout buffered by Docker exec'};
}

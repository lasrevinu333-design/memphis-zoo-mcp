import {listSharedEvents} from './events-api.js';
import {readOperationsMailLedger} from './operations-mail-ledger.js';
import {publicOperationsDetails} from './public-dashboard-details.js';
import {runReadOnlySql} from './supabase/read.js';

export const OUTLOOK_PUBLISHED_FEED_SCHEMA='custodial.outlook-published-feed.v1';
const MAX_FEED_BYTES=8*1024*1024; // Existing imported-mail snapshot byte bound.

// The existing dashboard's safe projection, never its raw ledger, source
// correspondence, employee-targeted messages, or native private schedule note.
// No caller SQL, URL, manager identity or source key is accepted here.
export async function readOutlookPublishedFeed({client,signal,assertCurrent,
  readSql=runReadOnlySql,readMail=readOperationsMailLedger,now=()=>new Date()}={}){
  const current=()=>{if(signal?.aborted)throw Error('published_feed_cancelled');assertCurrent?.();};
  const checkedSql=async sql=>{
    current();
    const result=await readSql({sql});
    current();
    if(result?.ok!==true||result.row_limit_truncated!==false||result.response_truncated!==false
      ||!Array.isArray(result.rows)||result.rowCount!==result.rows.length)
      throw Error('published_feed_source_incomplete');
    return result.rows;
  };
  current();
  const [events,mail]=await Promise.all([
    listSharedEvents(checkedSql),
    (async()=>{current();const value=await readMail({client,signal});current();return value;})(),
  ]);
  current();
  const projected=publicOperationsDetails(events,mail,now());
  const result={schema:OUTLOOK_PUBLISHED_FEED_SCHEMA,state:'snapshot',
    generated_at:projected.generated_at,timezone:projected.timezone,
    events:projected.events,schools:projected.schools,
    mailbox_completeness_verified:false,collector_activation_verified:false};
  if(Buffer.byteLength(JSON.stringify(result))>MAX_FEED_BYTES)throw Error('published_feed_snapshot_limit');
  current();
  return result;
}

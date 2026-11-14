import {callOutlookEventSync,outlookSyncSchema} from '../outlook-event-sync.js';
import {registerMcpTool} from './register.js';
import {jsonResponse} from './responses.js';
export function registerOutlookEventTools(server,{includeWrites=true,client,publishedFeedReaders,sourceReceiptReaders}={}){
  if(!includeWrites)return;
  registerMcpTool(server,'custodial_outlook_events_sync',{
    description:'Private source-bound Outlook Events status/apply/cancel/review/checkpoint through the existing writer and exact ledger readback. Optional status include_public_feed:true reads the canonical safe published event/school projection. Optional source_receipt selects protected binding metadata by exact school attachment SHA256, original event message ID or already-established event key, with safe current/ended canonical metadata for bound events; never raw mail, ledger payload, private notes or arbitrary searches. Caller must read original sources/all pages and distinguish staged, published and complete review states. Does not read/send mail, run a scheduler, or edit tickets.',
    inputSchema:outlookSyncSchema,
  },async(args,extra)=>jsonResponse(await callOutlookEventSync(args,extra,{client,signal:extra?.signal,publishedFeedReaders,sourceReceiptReaders})));
}

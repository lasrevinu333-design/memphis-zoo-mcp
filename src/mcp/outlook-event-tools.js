import {callOutlookEventSync,outlookSyncSchema} from '../outlook-event-sync.js';
import {registerMcpTool} from './register.js';
import {jsonResponse} from './responses.js';
export function registerOutlookEventTools(server,{includeWrites=true,client,publishedFeedReaders}={}){
  if(!includeWrites)return;
  registerMcpTool(server,'custodial_outlook_events_sync',{
    description:'Private source-bound Outlook Events status/apply/cancel/review/checkpoint through the existing writer and exact ledger readback. Status observation {include_public_feed:true} also reads the canonical safe published event/school projection with current IDs/revisions; it never exposes raw source/ledger or private notes. Caller must read original mail and all pages before asserting completeness. Does not read/send mail, run a scheduler, or edit tickets.',
    inputSchema:outlookSyncSchema,
  },async(args,extra)=>jsonResponse(await callOutlookEventSync(args,extra,{client,signal:extra?.signal,publishedFeedReaders})));
}

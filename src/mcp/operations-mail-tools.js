import {callOperationsMailSync,operationsMailSyncSchema} from '../operations-mail-sync.js';
import {registerMcpTool} from './register.js';
import {jsonResponse} from './responses.js';
export function registerOperationsMailTools(server,{includeWrites=true,client}={}){
  if(!includeWrites)return;
  registerMcpTool(server,'custodial_outlook_operations_import',{
    description:'Private original school attachment or unquoted Spiceworks notification import through the existing protected ledger; no mailbox activation or external ticket changes.',
    inputSchema:operationsMailSyncSchema,
  },async(args,extra)=>jsonResponse(await callOperationsMailSync(args,extra,{client,signal:extra?.signal})));
}

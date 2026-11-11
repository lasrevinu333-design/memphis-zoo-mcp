import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpServer} from '../src/mcp/create-mcp-server.js';
import {feedbackRelaySchemas} from '../src/feedback-email-relay.js';
import {operationsMailSyncSchema} from '../src/operations-mail-sync.js';
import {advertisedInputSchema} from '../src/mcp/advertised-schema.js';
import {z} from 'zod';
const server=createMcpServer({allowNoAuth:true,oauth:{enabled:true,scopes:['mcp:read','mcp:write'],challenge:'Bearer realm="fixture"'}});
const client=new Client({name:'schema-regression',version:'1'});
const [ct,st]=InMemoryTransport.createLinkedPair();
try {
 await server.connect(st);await client.connect(ct);
 const tools=(await client.listTools()).tools;
 function inspect(node){if(!node||typeof node!=='object')return;if(node.type==='array'){assert.equal(typeof node.items,'object');assert.ok(!Array.isArray(node.items));assert.equal(node.prefixItems,undefined);}for(const v of Object.values(node))if(v&&typeof v==='object')Array.isArray(v)?v.forEach(inspect):inspect(v);}
 tools.forEach(t=>inspect(t.inputSchema));
 for(const name of ['custodial_feedback_relay_receipt','custodial_outlook_events_sync','custodial_outlook_operations_import'])assert.equal(tools.filter(t=>t.name===name).length,1);
 const receipt=tools.find(t=>t.name==='custodial_feedback_relay_receipt').inputSchema.properties.observation.properties;
 assert.deepEqual(receipt.to.items,{type:'string',enum:['eoperle@memphiszoo.org']});assert.equal(receipt.to.minItems,1);assert.equal(receipt.to.maxItems,1);
 for(const field of ['cc','bcc']){assert.equal(receipt[field].maxItems,0);assert.equal(receipt[field].minItems,0);}
 const observation=feedbackRelaySchemas.receipt.shape.observation;
 assert.equal(observation.shape.to.safeParse(['another@example.invalid']).success,false);
 assert.equal(observation.shape.to.safeParse(['eoperle@memphiszoo.org','another@example.invalid']).success,false);
 assert.equal(observation.shape.cc.safeParse(['another@example.invalid']).success,false);
 assert.equal(observation.shape.bcc.safeParse(['another@example.invalid']).success,false);
 const school=operationsMailSyncSchema.shape.request.options.find(x=>x.shape.kind.value==='school');
 const headers=school.shape.observation.shape.headers;
 const original=z.toJSONSchema(headers);const values=original.prefixItems.map(x=>x.const);
 assert.equal(headers.safeParse(values).success,true);assert.equal(headers.safeParse([...values].reverse()).success,false);
 const before=JSON.stringify(original);advertisedInputSchema(original);assert.equal(JSON.stringify(original),before);
 console.log(JSON.stringify({status:'PASS',tools:tools.length,existingCommandValidationPreserved:true,providerCalls:0}));
}finally{await client.close();await server.close();}

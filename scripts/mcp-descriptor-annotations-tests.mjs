import assert from 'node:assert/strict';
import test from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpServer} from '../src/mcp/create-mcp-server.js';

test('actual MCP discovery includes required behavior hints and retains importer authorization',async()=>{
  const server=createMcpServer({allowNoAuth:true,oauth:{enabled:true,scopes:['mcp:read','mcp:write'],challenge:'Bearer realm="fixture"'}});
  const client=new Client({name:'descriptor-contract',version:'1'});
  const [ct,st]=InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);await client.connect(ct);
    const listed=(await client.listTools()).tools;
    assert.equal(listed.length,25);
    for(const tool of listed)for(const field of ['readOnlyHint','destructiveHint','openWorldHint'])assert.equal(typeof tool.annotations?.[field],'boolean',tool.name+':'+field);
    assert.equal(listed.find(t=>t.name==='supabase_sql_read').annotations.readOnlyHint,true);
    assert.equal(listed.find(t=>t.name==='github_delete_file').annotations.destructiveHint,true);
    assert.equal(listed.find(t=>t.name==='custodial_feedback_relay_status').annotations.readOnlyHint,true);
    for(const name of ['custodial_outlook_events_sync','custodial_outlook_operations_import']){
      const descriptor=listed.find(t=>t.name===name);
      assert.equal(descriptor.annotations.readOnlyHint,false);
      assert.equal(descriptor.annotations.openWorldHint,false);
      assert.deepEqual(descriptor._meta.securitySchemes,[{type:'oauth2',scopes:['mcp:read','mcp:write']}]);
    }
    const denied=await client.callTool({name:'custodial_outlook_events_sync',arguments:{contract_version:'custodial.outlook-event-sync-adapter.v1',request:{action:'status',observation:{}}}});
    assert.equal(denied.isError,true);assert.match(denied._meta['mcp/www_authenticate'][0],/mcp:read mcp:write/);
  } finally {await client.close();await server.close();}
});

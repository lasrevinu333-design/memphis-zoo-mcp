import assert from 'node:assert/strict';
import {Duplex} from 'node:stream';
import {spawn,execFileSync} from 'node:child_process';
export function requireOwnedDatabase(cid,owner,runtime){
 assert.match(cid,/^[a-f0-9]{64}$/);assert.match(owner,/^[a-f0-9-]{36}$/);
 const d=JSON.parse(execFileSync('docker',['--host=unix:///var/run/docker.sock','inspect','--format','{{json .}}',cid],{encoding:'utf8',timeout:10000,maxBuffer:1048576}));
 assert.equal(d.Id,cid);assert.equal(d.Config.Labels['custodial.audit.owner'],owner);assert.equal(d.State.Running,true);
 assert.equal(d.HostConfig.Memory,536870912);assert.equal(d.HostConfig.MemorySwap,536870912);assert.equal(d.HostConfig.NetworkMode,'none');assert.equal(d.HostConfig.Privileged,false);assert.equal(d.HostConfig.ReadonlyRootfs,true);
 assert.ok(!d.HostConfig.PortBindings||Object.keys(d.HostConfig.PortBindings).length===0);
 assert.ok(d.Mounts.some(m=>m.Destination==='/var/lib/postgresql/data'&&m.Type==='bind'&&m.Source.startsWith(runtime+'/')));
 assert.equal(d.Image,'sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518');return d;
}
const python=`import os,socket,select\ns=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)\ns.connect('/var/run/postgresql/.s.PGSQL.5432')\ninputs=[0,s]\nwhile inputs:\n ready,_,_=select.select(inputs,[],[],30)\n if not ready: continue\n for source in ready:\n  if source==0:\n   data=os.read(0,65536)\n   if not data:\n    inputs.remove(0)\n    s.shutdown(socket.SHUT_WR)\n   else:s.sendall(data)\n  else:\n   data=s.recv(65536)\n   if not data:\n    s.close()\n    raise SystemExit(0)\n   view=memoryview(data)\n   while view:\n    count=os.write(1,view)\n    view=view[count:]\n`;
export class OwnedDockerPgStream extends Duplex {
 constructor({cid,owner,runtime,relay}){super();Object.assign(this,{cid,owner,runtime,relay});this.child=null;this.stderr='';}
 setNoDelay(){return this;}setKeepAlive(){return this;}ref(){return this;}unref(){return this;}
 connect(){
  requireOwnedDatabase(this.cid,this.owner,this.runtime);
  assert.ok(this.relay&&['python','socat','static'].includes(this.relay.kind)&&/^\/[a-zA-Z0-9_./+-]+$/.test(this.relay.path));
  const command=this.relay.kind==='python'?[this.relay.path,'-u','-c',python]:this.relay.kind==='static'?[this.relay.path]:[this.relay.path,'STDIO','UNIX-CONNECT:/var/run/postgresql/.s.PGSQL.5432'];
  const child=this.child=spawn('docker',['--host=unix:///var/run/docker.sock','exec','--user','100','-i',this.cid,...command],{stdio:['pipe','pipe','pipe']});
  child.stdout.on('data',data=>{if(!this.push(data))child.stdout.pause();});child.stderr.on('data',data=>{this.stderr=(this.stderr+data).slice(-4000);});
  child.once('spawn',()=>this.emit('connect'));child.once('error',e=>this.destroy(e));
  child.once('exit',(code,signal)=>{if(code&& !this.destroyed)this.destroy(Error('Owned fixture relay exited '+code+': '+this.stderr));else{this.push(null);if(!this.destroyed)this.destroy();}});
  child.stdin.on('error',e=>{if(!this.destroyed)this.destroy(e);});return this;
 }
 _read(){this.child?.stdout.resume();}
 _write(data,encoding,callback){if(!this.child)return callback(Error('Owned relay not connected'));this.child.stdin.write(data,encoding,callback);}
 _final(callback){if(this.child?.stdin.writable)this.child.stdin.end(callback);else callback();}
 _destroy(error,callback){const child=this.child;if(child&&child.exitCode===null&&!child.killed)child.kill('SIGTERM');callback(error);}
}

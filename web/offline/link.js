// A "link" carries the host protocol between one client page and the offline host:
// {send(text), onmessage(fn), onclose(fn), close(), buffered()}.
// The tunnel multiplexes HTTP-like requests and sockets over that single link.
const CHUNK=15000;

// Splits large messages: SCTP implementations differ in their maximum message size.
export function framed(raw){
 let nextId=0;const parts=new Map(),listeners=[],closers=[];let closed=false;
 raw.onmessage(text=>{
  if(typeof text!=='string')return;
  if(text[0]==='F'){for(const fn of listeners)fn(text.slice(1));return;}
  const match=/^P(\d+):(\d+):(\d+):/.exec(text);if(!match)return;
  const [head,id,index,total]=match;let entry=parts.get(id);if(!entry){if(Number(total)>2000)return;entry=[];parts.set(id,entry);}
  entry[Number(index)]=text.slice(head.length);
  if(entry.filter(x=>x!==undefined).length===Number(total)){parts.delete(id);const whole=entry.join('');for(const fn of listeners)fn(whole);}
 });
 raw.onclose(()=>{if(closed)return;closed=true;for(const fn of closers)fn();});
 return {
  send(text){if(closed)return;if(text.length<=CHUNK){raw.send('F'+text);return;}const id=nextId++,total=Math.ceil(text.length/CHUNK);for(let i=0;i<total;i++)raw.send('P'+id+':'+i+':'+total+':'+text.slice(i*CHUNK,(i+1)*CHUNK));},
  onmessage(fn){listeners.push(fn);},onclose(fn){if(closed)fn();else closers.push(fn);},
  close(){raw.close();},buffered(){return raw.buffered?.()||0;},get closed(){return closed;}
 };
}

// Two connected in-memory endpoints with asynchronous delivery, like a network.
export function pipe(){
 const make=()=>({listeners:[],closers:[],closed:false});const a=make(),b=make();
 const end=(self,other)=>({
  send(text){if(self.closed)return;setTimeout(()=>{if(!other.closed)for(const fn of other.listeners)fn(text);},0);},
  onmessage(fn){self.listeners.push(fn);},onclose(fn){self.closers.push(fn);},buffered(){return 0;},
  close(){for(const side of [self,other]){if(side.closed)continue;side.closed=true;const fns=side.closers;setTimeout(()=>fns.forEach(fn=>fn()),0);}}
 });
 return [end(a,b),end(b,a)];
}

export function serveLink(host,link){
 const sockets=new Map();
 const send=value=>link.send(JSON.stringify(value));
 link.onmessage(async text=>{
  let m;try{m=JSON.parse(text);}catch{return;}
  if(m.k==='q'){const result=await host.request({method:m.m,path:m.p,token:m.a,body:m.b});send(result.text!==undefined?{k:'r',i:m.i,s:result.status,t:result.text}:{k:'r',i:m.i,s:result.status,b:result.body});return;}
  if(m.k==='o'&&typeof m.s==='number'&&!sockets.has(m.s)){
   const id=m.s;let open=true;
   const conn=host.connect({send:data=>{if(open)send({k:'d',s:id,d:data});},close:(code,reason)=>{if(!open)return;open=false;sockets.delete(id);send({k:'c',s:id,c:code,r:reason});conn.closed();},buffered:()=>link.buffered()});
   sockets.set(id,{conn,close(){if(open){open=false;conn.closed();}}});return;
  }
  if(m.k==='d'){sockets.get(m.s)?.conn.receive(m.d);return;}
  if(m.k==='c'){const s=sockets.get(m.s);sockets.delete(m.s);s?.close();}
 });
 link.onclose(()=>{for(const s of sockets.values())s.close();sockets.clear();});
}

const SocketBase=typeof EventTarget==='function'?EventTarget:class{};
export class VirtualSocket extends SocketBase {
 constructor(tunnel,url){
  super();this.url=url;this.readyState=0;this.bufferedAmount=0;this.protocol='';this.extensions='';this.binaryType='blob';
  this.onopen=this.onmessage=this.onclose=this.onerror=null;this._tunnel=tunnel;this._id=tunnel.attach(this);
 }
 _emit(type,init){const event=type==='message'?new MessageEvent('message',{data:init.data}):type==='close'&&typeof CloseEvent==='function'?new CloseEvent('close',init):Object.assign(new Event(type),init||{});this.dispatchEvent(event);this['on'+type]?.(event);}
 _opened(){if(this.readyState!==0)return;this.readyState=1;this._emit('open');}
 _message(data){if(this.readyState===1)this._emit('message',{data});}
 _closed(code=1006,reason=''){if(this.readyState===3)return;this.readyState=3;this._emit('close',{code,reason,wasClean:code!==1006});}
 send(data){if(this.readyState!==1)throw new DOMException('WebSocket is not open','InvalidStateError');this._tunnel.send(this._id,String(data));}
 close(){if(this.readyState>=2)return;this.readyState=2;this._tunnel.detach(this._id);setTimeout(()=>this._closed(1000,''),0);}
}
for(const [key,value] of Object.entries({CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3})){VirtualSocket[key]=value;VirtualSocket.prototype[key]=value;}

export function tunnelClient(link){
 let nextRequest=1,nextSocket=1;const pending=new Map(),sockets=new Map();let alive=true;
 const send=value=>link.send(JSON.stringify(value));
 link.onmessage(text=>{
  let m;try{m=JSON.parse(text);}catch{return;}
  if(m.k==='r'){const p=pending.get(m.i);pending.delete(m.i);p?.resolve(new Response(m.t!==undefined?m.t:JSON.stringify(m.b),{status:m.s,headers:{'Content-Type':'application/json'}}));}
  else if(m.k==='d')sockets.get(m.s)?._message(m.d);
  else if(m.k==='c'){const s=sockets.get(m.s);sockets.delete(m.s);s?._closed(m.c||1000,m.r||'');}
 });
 link.onclose(()=>{alive=false;for(const p of pending.values())p.reject(new TypeError('Offline connection lost'));pending.clear();for(const s of sockets.values())s._closed(4100,'Offline connection lost');sockets.clear();});
 const tunnel={
  attach(socket){const id=nextSocket++;sockets.set(id,socket);if(!alive){setTimeout(()=>{sockets.delete(id);socket._closed(4100,'Offline connection lost');},0);return id;}send({k:'o',s:id});setTimeout(()=>socket._opened(),0);return id;},
  send(id,data){send({k:'d',s:id,d:data});},
  detach(id){if(sockets.delete(id)&&alive)send({k:'c',s:id});}
 };
 return {
  get alive(){return alive;},
  fetch(path,{method='GET',headers={},body}={}){
   if(!alive)return Promise.reject(new TypeError('Offline connection lost'));
   const i=nextRequest++,auth=(headers.Authorization||headers.authorization||'').replace(/^Bearer /,'')||undefined;
   return new Promise((resolve,reject)=>{pending.set(i,{resolve,reject});send({k:'q',i,m:method,p:path,a:auth,b:body?JSON.parse(body):undefined});});
  },
  socket(url){return new VirtualSocket(tunnel,url);}
 };
}

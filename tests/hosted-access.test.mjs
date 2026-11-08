import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import {createHostedAccess} from '../server/hosted-access.mjs';
const TOKEN='test-only-operator-token-123456789';
async function setup(t,options={}){
 const app=express(),access=createHostedAccess({hosted:true,origin:'http://localhost:9999',token:TOKEN,port:9999,...options});app.use(access.middleware);app.use(express.json());access.installSession(app);app.all('/api/protected',(req,res)=>res.json({worked:true}));app.get('/preview/example/file.js',(req,res)=>res.send('source'));const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});t.after(()=>new Promise(resolve=>server.close(resolve)));return server;
}
async function request(server,url,{method='GET',headers={},body}={}){
 const payload=body==null?undefined:JSON.stringify(body);return new Promise((resolve,reject)=>{const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:url,method,headers:{Host:'localhost:9999',...(payload?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}:{}),...headers}},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>{const text=Buffer.concat(chunks).toString();let data;try{data=JSON.parse(text);}catch{data=text;}resolve({status:res.statusCode,headers:res.headers,data});});});req.on('error',reject);req.end(payload);});
}
test('hosted mode fails closed unless a long token and exact HTTPS or loopback origin are configured',()=>{
 for(const options of [{},{token:'short',origin:'https://sift.example'},{token:TOKEN,origin:'http://sift.example'},{token:TOKEN,origin:'https://sift.example/path'}])assert.throws(()=>createHostedAccess({hosted:true,...options}),/requires/);
 assert.equal(createHostedAccess({hosted:false}).hosted,false);
});
test('protected API/source require operator session; login is HttpOnly, scoped, signed and expiring',async t=>{
 let now=1000000;const server=await setup(t,{now:()=>now});assert.equal((await request(server,'/healthz')).status,200);assert.equal((await request(server,'/api/protected')).status,401);const login=await request(server,'/');assert.equal(login.status,401);assert.match(login.data,/operator access token/);assert.match(login.headers['content-security-policy'],/nonce-/);
 assert.deepEqual((await request(server,'/api/session')).data,{hosted:true,authenticated:false,operatorOnly:true});assert.equal((await request(server,'/api/session',{method:'POST',body:{token:'wrong'}})).status,401);
 const authenticated=await request(server,'/api/session',{method:'POST',body:{token:TOKEN}});assert.equal(authenticated.status,200);const cookie=authenticated.headers['set-cookie'][0];assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.doesNotMatch(cookie,new RegExp(TOKEN));const headers={Cookie:cookie.split(';')[0]};
 assert.equal((await request(server,'/api/protected',{headers})).status,200);assert.equal((await request(server,'/preview/example/file.js',{headers:{...headers,Origin:'null'}})).status,200);assert.equal((await request(server,'/api/protected',{headers:{Cookie:headers.Cookie+'broken'}})).status,401);
 assert.equal((await request(server,'/api/protected',{headers:{Authorization:`Bearer ${TOKEN}`}})).status,200);assert.equal((await request(server,'/api/protected',{headers:{Authorization:'Bearer wrong'}})).status,401);
 assert.equal((await request(server,'/api/session',{method:'DELETE',headers,body:{}})).status,200);now+=8*3600000+1;assert.equal((await request(server,'/api/protected',{headers})).status,401);
});
test('host/origin checks and content type guard protect authenticated actions',async t=>{
 const server=await setup(t),auth={Authorization:`Bearer ${TOKEN}`};assert.equal((await request(server,'/api/protected',{headers:{...auth,Host:'attacker.example'}})).status,403);assert.equal((await request(server,'/api/protected',{headers:{...auth,Origin:'https://attacker.example'}})).status,403);assert.equal((await request(server,'/api/protected',{method:'POST',headers:{...auth,Origin:'null'},body:{}})).status,403);assert.equal((await request(server,'/api/protected',{method:'POST',headers:auth})).status,415);assert.equal((await request(server,'/api/protected',{method:'POST',headers:{...auth,Origin:'http://localhost:9999'},body:{}})).status,200);
});
test('login attempts are bounded while local development retains authenticated behavior',async t=>{
 let now=1000;const server=await setup(t,{now:()=>now});for(let i=0;i<12;i++)assert.equal((await request(server,'/api/session',{method:'POST',body:{token:'wrong'}})).status,401);assert.equal((await request(server,'/api/session',{method:'POST',body:{token:TOKEN}})).status,429);now+=60001;assert.equal((await request(server,'/api/session',{method:'POST',body:{token:TOKEN}})).status,200);
 const local=await setup(t,{hosted:false});assert.equal((await request(local,'/api/protected')).status,200);assert.equal((await request(local,'/api/session')).data.authenticated,true);
});
test('platform liveness probes work with internal hosts without exposing protected state',async t=>{
 const server=await setup(t);
 const health=await request(server,'/healthz',{headers:{Host:'internal-platform-probe'}});
 assert.equal(health.status,200);assert.deepEqual(health.data,{ok:true,mode:'operator-hosted'});
 assert.equal((await request(server,'/api/protected',{headers:{Host:'internal-platform-probe'}})).status,403);
});

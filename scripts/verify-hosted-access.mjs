/** Local hosted-mode HTTP preflight. Does not build/run uploaded source or call models. */
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve('.'), data=await fs.mkdtemp(path.join(root,'.frameshift/hosted-preflight-'));
const port=4338,origin=`http://127.0.0.1:${port}`,token=crypto.randomBytes(32).toString('hex');
const child=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'production',EARL_HOSTED:'1',EARL_PUBLIC_ORIGIN:origin,EARL_ADMIN_TOKEN:token,FRAMESHIFT_DATA_DIR:data,PORT:String(port)},stdio:['ignore','ignore','pipe']});
let errors='';child.stderr.on('data',b=>errors=(errors+b).slice(-2000));
try {
 let ready=false;for(let i=0;i<80;i++){try{if((await fetch(origin+'/healthz')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,'hosted HTTP preflight failed to start: '+errors);
 assert.equal((await fetch(origin+'/api/state')).status,401);
 assert.equal((await fetch(origin+'/')).status,401);
 const login=await fetch(origin+'/api/session',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({token})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
 assert.equal((await fetch(origin+'/api/state',{headers:{cookie}})).status,200);
 const cross=await fetch(origin+'/api/session',{method:'POST',headers:{'content-type':'application/json',origin:'https://example.invalid',cookie},body:'{}'});assert.equal(cross.status,403);
 const outside=await fetch(origin+'/api/inspect',{method:'POST',headers:{'content-type':'application/json',origin,cookie},body:JSON.stringify({path:root})});assert.equal(outside.status,400);
 console.log(JSON.stringify({passed:true,unauthenticatedBlocked:true,signedCookieLogin:true,authenticatedState:true,crossOriginBlocked:true,arbitraryLocalPathBlocked:true,modelCalls:0,uploadedCodeExecuted:false,scope:'Local hosted HTTP preflight; not Docker/HTTPS deployment verification'}));
}finally{child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await fs.rm(data,{recursive:true,force:true});}

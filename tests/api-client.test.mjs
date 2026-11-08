import test from 'node:test';
import assert from 'node:assert/strict';
import { readApiResponse } from '../src/api-client.mjs';
import { PENDING_OPTIMIZATION_KEY, readPendingOptimization, savePendingOptimization, clearPendingOptimization, pendingProfile } from '../src/pending-optimization.mjs';
test('plain text 403 reports the server error instead of a JSON parser exception',async()=>{
 await assert.rejects(readApiResponse(new Response('Trusted project approval is required',{status:403})),/Trusted project approval is required/);
});
test('HTML 500 gives an actionable runner error without printing HTML',async()=>{
 await assert.rejects(readApiResponse(new Response('<html><body>Proxy failure</body></html>',{status:500,headers:{'Content-Type':'text/html'}})),error=>error.message.includes('error page (500)')&&!error.message.includes('<html>'));
});
test('malformed JSON 200 does not masquerade as a successful response',async()=>{
 await assert.rejects(readApiResponse(new Response('{invalid',{status:200,headers:{'Content-Type':'application/json'}})),/unexpected response instead of JSON/);
});
test('structured JSON errors retain the useful backend reason',async()=>{
 await assert.rejects(readApiResponse(Response.json({error:'Model access denied'},{status:403})),/Model access denied/);
});
test('empty response cannot silently count as a successful API action',async()=>{
 await assert.rejects(readApiResponse(new Response(null,{status:204})),/empty or invalid response/);
});
test('valid JSON passes through unchanged',async()=>{
 assert.deepEqual(await readApiResponse(Response.json({id:'real-job',status:'queued'})),{id:'real-job',status:'queued'});
});
test('pending Optimize survives tab reload and keeps the requested mission',()=>{
 const values=new Map();const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const intent={projectId:'p2',profileRunId:'profile2',mission:'Keep individual picking'};
 assert.equal(savePendingOptimization(intent,storage),true);
 assert.deepEqual(readPendingOptimization(storage),intent);
 const runs=[{id:'profile1',projectId:'p2',kind:'profile',status:'completed'},{id:'profile2',projectId:'p1',kind:'profile',status:'completed'},{id:'profile2',projectId:'p2',kind:'profile',status:'running'}];
 assert.equal(pendingProfile(intent,runs).status,'running');
 clearPendingOptimization(storage);assert.equal(values.has(PENDING_OPTIMIZATION_KEY),false);assert.equal(readPendingOptimization(storage),null);
});
test('invalid or unavailable pending storage cannot create an optimization intent',()=>{
 assert.equal(readPendingOptimization({getItem:()=>'{bad'}),null);
 assert.equal(readPendingOptimization({getItem:()=>JSON.stringify({projectId:'p'})}),null);
 assert.equal(readPendingOptimization({getItem:()=>{throw Error('blocked')}}),null);
});

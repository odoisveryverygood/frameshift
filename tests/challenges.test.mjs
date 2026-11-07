import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeChallenge,challengeVerdict} from '../server/challenges.mjs';
const camera={position:[0,0,10],quaternion:[0,0,0,1],projection:Array(16).fill(0),up:[0,1,0]};
const input={context:{selectedId:'robot-1',time:2,camera},expectedSelection:'robot-1',scenario:{events:[{type:'click',x:.5,y:.5,at:0}]}};
test('selection challenges require explicit observed identity, camera and bounded replay events',()=>{
 const c=normalizeChallenge(input);assert.equal(c.expectedSelection,'robot-1');
 assert.throws(()=>normalizeChallenge({...input,expectedSelection:'invented'}),/actual scene object/);
 assert.throws(()=>normalizeChallenge({...input,scenario:{events:[]}}),/Record at least one click/);
 assert.throws(()=>normalizeChallenge({...input,context:{...input.context,camera:{...camera,position:[NaN,0,0]}}}),/camera/);
 assert.throws(()=>normalizeChallenge({...input,scenario:{events:[{type:'click',x:2,y:.5,at:0}]}}),/normalized/);
});
test('challenge acceptance needs actual reference and candidate target, state and application behavior',()=>{
 const c=normalizeChallenge(input),state={items:[['robot-1',1,2,3]],picks:['robot-1']};
 const ref={selected:'robot-1',errors:[],state,interaction:{selected:'robot-1',dom:[]}};
 assert.equal(challengeVerdict(c,ref,ref).status,'passed');
 assert.equal(challengeVerdict(c,{...ref,selected:null},ref).status,'inconclusive');
 assert.equal(challengeVerdict(c,ref,{...ref,selected:'robot-2'}).status,'rejected');
 assert.equal(challengeVerdict(c,ref,{...ref,state:{...state,items:[]}}).status,'rejected');
 assert.equal(challengeVerdict(c,ref,{...ref,interaction:{selected:'robot-1',dom:['broken']}}).status,'rejected');
});

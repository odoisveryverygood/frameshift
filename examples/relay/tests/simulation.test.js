import test from 'node:test';
import assert from 'node:assert/strict';
import {robotPose,indexFromId,ROBOT_COUNT,ROUTE_LENGTH} from '../src/simulation.js';
test('all 2,000 robots have finite, deterministic poses and stay in the warehouse',()=>{
 for(const time of [0,.6,3,6,80,1000])for(let i=0;i<ROBOT_COUNT;i++){
  const pose=robotPose(i,time);assert.deepEqual(pose,robotPose(i,time));
  assert.ok([pose.x,pose.z,pose.heading].every(Number.isFinite));assert.ok(Math.abs(pose.x)<40&&Math.abs(pose.z)<34);assert.ok(pose.route>=1&&pose.route<=20);
 }
});
test('routes close without a position jump and robots really move',()=>{
 for(let i=0;i<ROBOT_COUNT;i+=100){const start=robotPose(i,0),end=robotPose(i,ROUTE_LENGTH/start.speed),moved=robotPose(i,1);assert.ok(Math.hypot(start.x-end.x,start.z-end.z)<1e-8);assert.ok(Math.hypot(start.x-moved.x,start.z-moved.z)>1);}
});
test('invalid identities and times cannot select other objects',()=>{
 assert.equal(indexFromId('robot-1187'),1187);for(const id of ['robot-2000','robot--1','robot-NaN','shelf-0',null,undefined])assert.equal(indexFromId(id),null);
 assert.throws(()=>robotPose(-1,0));assert.throws(()=>robotPose(0,NaN));assert.throws(()=>robotPose(0,-1));
});

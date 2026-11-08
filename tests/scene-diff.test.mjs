import test from 'node:test';
import assert from 'node:assert/strict';
import { diffSceneSnapshots, validateSceneSnapshot } from '../src/scene-diff.mjs';

const matrix = x => [1,0,0,0,0,1,0,0,0,0,1,0,x,0,0,1];
const node = (id, x=0, batch=id, extra={}) => ({ key:'semantic:'+id, semanticId:id, geometryId:'triangle', materialId:'grey', matrix:matrix(x), batchId:batch, ...extra });
const snapshot = (nodes, extra={}) => ({ version:1, time:0, counts:{drawCalls:new Set(nodes.map(n=>n.batchId)).size}, geometries:[{id:'triangle',position:[0,0,0,1,0,0,0,1,0],index:null}], materials:[{id:'grey',color:[.5,.5,.5],opacity:1,roughness:.7,metalness:0,side:2}], nodes, batches:[...new Set(nodes.map(n=>n.batchId))].map(id=>({id,kind:'mesh'})), truncated:false, warnings:[], ...extra });

test('instancing preserves every actual object while identifying changed render batches', () => {
  const before=snapshot([node('a'),node('b',2),node('c',4)]);
  const after=snapshot([node('a',0,'all'),node('b',2,'all'),node('c',4,'all')],{batches:[{id:'all',kind:'instanced',instances:3}]});
  const diff=diffSceneSnapshots(before,after);
  assert.equal(diff.pairs.length,3);assert.deepEqual(diff.added,[]);assert.deepEqual(diff.removed,[]);
  assert.deepEqual(diff.counts,{unchanged:0,moved:0,modified:0,regrouped:3,added:0,removed:0});
  assert.equal(diff.timeMatched,true);assert.equal(diff.before.nodes.length,diff.after.nodes.length);
});

test('reports actual additions, removals, movement and changed geometry even if adapter IDs remain equal', () => {
  const before=snapshot([node('stay'),node('move'),node('remove')]);
  const after=snapshot([node('stay'),node('move',2),node('add',7)],{geometries:[{id:'triangle',position:[0,0,0,2,0,0,0,1,0],index:null}],time:2});
  const diff=diffSceneSnapshots(before,after);
  assert.equal(diff.counts.added,1);assert.equal(diff.added[0].semanticId,'add');
  assert.equal(diff.counts.removed,1);assert.equal(diff.removed[0].semanticId,'remove');
  assert.equal(diff.counts.moved,1);assert.equal(diff.pairs.find(p=>p.moved).after.semanticId,'move');
  assert.equal(diff.counts.modified,2);assert.equal(diff.timeMatched,false);
});

test('matches exact captured appearance when batching changes nonsemantic structural keys', () => {
  const before=snapshot([node(null,0,'one',{key:'old-path',semanticId:null})]);
  const after=snapshot([node(null,0,'two',{key:'new-path',semanticId:null})]);
  const diff=diffSceneSnapshots(before,after);
  assert.equal(diff.pairs.length,1);assert.equal(diff.counts.added,0);assert.equal(diff.counts.removed,0);
  assert.ok(diff.warnings.some(s=>s.includes('not semantic part identity')));
});

test('does not disguise missing or unsupported geometry as a complete comparison', () => {
  const good=snapshot([node('a')]);
  assert.throws(()=>validateSceneSnapshot({...good,nodes:[node('a',0,'a',{geometryId:'absent'})]}),/references/);
  assert.throws(()=>validateSceneSnapshot({...good,nodes:[node('a',0,'a',{matrix:matrix(Infinity)})]}),/references/);
  assert.throws(()=>validateSceneSnapshot({...good,nodes:[node('a'),node('a')]}),/references/);
  const diff=diffSceneSnapshots(good,{...good,truncated:true,warnings:['A textured mesh was omitted.']});
  assert.equal(diff.partial,true);assert.ok(diff.warnings.includes('A textured mesh was omitted.'));assert.match(diff.warnings[0],/Partial geometry snapshot/);
});

test('a replacement with a different known identity remains an addition and removal at the same pose', () => {
  const diff=diffSceneSnapshots(snapshot([node('old')]),snapshot([node('new')]));
  assert.equal(diff.pairs.length,0);assert.equal(diff.counts.added,1);assert.equal(diff.counts.removed,1);
});

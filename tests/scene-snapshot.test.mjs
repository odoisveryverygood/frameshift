import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {captureSceneSnapshot, installSpatialBridge, validSnapshotRequestId} from '../sdk/spatial.mjs';
const identify = object => object.userData.semanticId ?? null;
const renderer = {info:{render:{calls:17}},domElement:{addEventListener(){},getBoundingClientRect(){return{left:0,top:0,width:100,height:100}}}};
function fixture(){const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();return{scene,camera};}
function capture(scene,options={}){return captureSceneSnapshot(THREE,{scene,renderer,identify,time:2.5,...options});}
function mesh(id){const value=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial({color:new THREE.Color(.5,.6,.7),roughness:.4,metalness:.3}));if(id)value.userData.semanticId=id;return value;}
function close(actual,expected){actual.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-6,`${n} vs ${expected[i]}`));}
test('snapshot captures exact indexed geometry, parent/instance world matrices, semantic identities and multiplied linear colors',()=>{
 const {scene}=fixture(),parent=new THREE.Group();parent.position.set(4,5,6);parent.rotation.z=.2;scene.add(parent);
 const material=new THREE.MeshStandardMaterial({color:new THREE.Color(.5,.6,.7),roughness:.4,metalness:.3,opacity:.8,transparent:true,side:THREE.DoubleSide});
 const geometry=new THREE.BoxGeometry(2,3,4),instances=new THREE.InstancedMesh(geometry,material,2);instances.position.y=2;instances.userData.semanticIds=['robot-a','robot-b'];parent.add(instances);
 instances.setMatrixAt(0,new THREE.Matrix4().makeTranslation(1,0,0));instances.setMatrixAt(1,new THREE.Matrix4().makeTranslation(3,1,0));instances.setColorAt(0,new THREE.Color(.2,.3,.4));instances.setColorAt(1,new THREE.Color(.8,.7,.6));
 const before=instances.instanceMatrix.array.slice(),snapshot=capture(scene);assert.equal(snapshot.version,1);assert.equal(snapshot.time,2.5);assert.equal(snapshot.counts.drawCalls,17);assert.equal(snapshot.counts.instances,2);assert.equal(snapshot.counts.meshes,1);assert.equal(snapshot.counts.triangles,24);assert.equal(snapshot.nodes.length,2);assert.equal(snapshot.geometries.length,1);assert.equal(snapshot.batches[0].kind,'instanced');assert.equal(snapshot.batches[0].instances,2);assert.equal(snapshot.truncated,false);
 assert.deepEqual(snapshot.geometries[0].position,Array.from(geometry.attributes.position.array));assert.deepEqual(snapshot.geometries[0].index,Array.from(geometry.index.array));
 for(let i=0;i<2;i++){const node=snapshot.nodes[i],instance=new THREE.Matrix4();instances.getMatrixAt(i,instance);close(node.matrix,new THREE.Matrix4().multiplyMatrices(instances.matrixWorld,instance).elements);assert.equal(node.key,`semantic:robot-${i?'b':'a'}`);assert.equal(node.semanticId,`robot-${i?'b':'a'}`);assert.equal(node.batchId,snapshot.batches[0].id);const m=snapshot.materials.find(m=>m.id===node.materialId);close(m.color,i?[.4,.42,.42]:[.1,.18,.28]);assert.equal(m.roughness,.4);assert.equal(m.metalness,.3);assert.equal(m.side,THREE.DoubleSide);assert.equal(m.opacity,.8);}
 assert.deepEqual(instances.instanceMatrix.array,before);assert.deepEqual(capture(scene),snapshot);
});
test('equivalent independent geometries/materials and unnamed node identities deduplicate by content rather than UUID',()=>{
 const a=new THREE.Scene(),b=new THREE.Scene();for(const scene of [a,b]){const first=mesh(),second=mesh();second.position.x=3;scene.add(first,second);}
 const sa=capture(a),sb=capture(b);assert.equal(sa.geometries.length,1);assert.equal(sa.materials.length,1);assert.equal(sa.nodes.length,2);assert.equal(new Set(sa.nodes.map(n=>n.key)).size,2);assert.deepEqual(sa,sb);
 a.children[0].geometry.attributes.position.setX(0,2);assert.notDeepEqual(capture(a).geometries.map(g=>g.id),sa.geometries.map(g=>g.id));
});
test('geometry/index/draw range is real and unsupported deformation/material features are skipped explicitly',()=>{
 const scene=new THREE.Scene(),partial=mesh('partial');partial.geometry.setDrawRange(3,6);scene.add(partial);
 const hidden=mesh('hidden');hidden.visible=false;scene.add(hidden);const ignored=mesh('ignored');ignored.userData.frameshiftIgnore=true;scene.add(ignored);
 const morph=mesh('morph');morph.geometry.morphAttributes.position=[morph.geometry.attributes.position.clone()];scene.add(morph);
 const multi=mesh('multi');multi.material=[multi.material];scene.add(multi);
 const skin=new THREE.SkinnedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial());scene.add(skin);
 const texture=mesh('textured');texture.material.map=new THREE.Texture();scene.add(texture);
 const line=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial());scene.add(line);
 const snapshot=capture(scene);assert.equal(snapshot.nodes.length,1);assert.equal(snapshot.nodes[0].semanticId,'partial');assert.deepEqual(snapshot.geometries[0].index,Array.from(partial.geometry.index.array).slice(3,9));assert.equal(snapshot.counts.triangles,2);assert.equal(snapshot.truncated,true);assert.match(snapshot.warnings.join(' '),/morph-target/);assert.match(snapshot.warnings.join(' '),/textured/);assert.match(snapshot.warnings.join(' '),/Line/);
});
test('node, geometry and output limits explicitly truncate without sampling or inventing geometry',()=>{
 const scene=new THREE.Scene(),many=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial(),8);for(let i=0;i<8;i++)many.setMatrixAt(i,new THREE.Matrix4().makeTranslation(i,0,0));scene.add(many);
 const capped=capture(scene,{limits:{maxNodes:3}});assert.equal(capped.nodes.length,3);assert.equal(capped.batches[0].instances,3);assert.equal(capped.truncated,true);assert.match(capped.warnings.join(' '),/Node budget/);assert.equal(capped.geometries[0].position.length,many.geometry.attributes.position.array.length);
 const noGeometry=capture(scene,{limits:{maxGeometryFloats:10}});assert.equal(noGeometry.nodes.length,0);assert.equal(noGeometry.truncated,true);
 const bytes=capture(scene,{limits:{maxOutputBytes:2048}});assert.equal(bytes.truncated,true);assert.ok(Buffer.byteLength(JSON.stringify(bytes))<=2048);
 const nan=mesh();nan.geometry.attributes.position.setX(0,NaN);const invalid=new THREE.Scene();invalid.add(nan);assert.equal(capture(invalid).nodes.length,0);assert.match(capture(invalid).warnings.join(' '),/Non-finite/);
});
test('standalone bridge validates request identity/source/origin and blocks captures during active benchmarks',async t=>{
 const oldWindow=globalThis.window,oldLocation=globalThis.location;const listeners={},messages=[],parent={postMessage:(value,origin)=>messages.push({value,origin})};
 globalThis.window={parent,addEventListener:(type,listener)=>listeners[type]=listener};globalThis.location={search:'?__frameshift=1',origin:'http://127.0.0.1:4310'};t.after(()=>{globalThis.window=oldWindow;globalThis.location=oldLocation});
 const {scene,camera}=fixture();scene.add(mesh('robot-1'));let finish;const api={pause(){},step(){},sample(){return new Promise(resolve=>finish=resolve)}};
 installSpatialBridge(THREE,{api,renderer,getScene:()=>scene,getCamera:()=>camera,getTime:()=>1,identify});assert.equal(typeof api.sceneSnapshot,'function');assert.equal(api.sceneSnapshot().nodes.length,1);assert.equal(messages.length,0);
 const request=(data,source=parent,origin=location.origin)=>listeners.message({source,origin,data});
 for(const requestId of [undefined,'','bad id','x'.repeat(81),{},'../wrong'])request({type:'frameshift:scene-snapshot',requestId});request({type:'frameshift:scene-snapshot',requestId:'good'},{});request({type:'frameshift:scene-snapshot',requestId:'good'},parent,'https://attacker.test');assert.equal(messages.length,0);
 request({type:'frameshift:scene-snapshot',requestId:'snapshot:request-1'});assert.equal(messages.length,1);assert.equal(messages[0].value.type,'frameshift:scene-snapshot-result');assert.equal(messages[0].value.requestId,'snapshot:request-1');assert.equal(messages[0].value.snapshot.nodes[0].semanticId,'robot-1');assert.equal(messages[0].origin,location.origin);
 const sampling=api.sample();assert.throws(()=>api.sceneSnapshot(),/active benchmarks/);request({type:'frameshift:scene-snapshot',requestId:'blocked'});assert.match(messages.at(-1).value.error,/active benchmarks/);assert.equal(messages.at(-1).value.snapshot,undefined);finish({frames:[1]});await sampling;assert.equal(api.sceneSnapshot().nodes.length,1);
 assert.equal(validSnapshotRequestId('abc_1-2.3:4'),true);assert.equal(validSnapshotRequestId('bad space'),false);
});

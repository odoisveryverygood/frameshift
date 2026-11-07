import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {resolveSelection,snapshotCamera,validCamera,restoreCamera} from '../sdk/spatial.mjs';
const identify = o => o.userData.semanticId ?? (o.name || null);
function fixture() {
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(45,1,.1,100);
  camera.position.set(0,0,12);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  return {scene,camera};
}
test('scene selection is exact, projects a real world point and rejects unknown semantic ids',()=>{
  const {scene,camera}=fixture();
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
  mesh.userData.semanticId='robot-42';mesh.position.set(1,2,0);scene.add(mesh);
  const selected=resolveSelection(THREE,scene,camera,'robot-42',identify);
  assert.equal(selected.id,'robot-42');assert.deepEqual(selected.worldPosition,[1,2,0]);
  assert.ok(selected.anchor.x>.5&&selected.anchor.y<.5&&selected.anchor.visible);
  assert.equal(selected.groupInstanceCount,1);
  assert.equal(resolveSelection(THREE,scene,camera,'robot-41',identify),null);
});
test('instance selection preserves semantic id, instance index and moving-parent world transform',()=>{
  const {scene,camera}=fixture();const parent=new THREE.Group();parent.position.x=3;scene.add(parent);
  const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),2);
  mesh.userData.semanticIds=['robot-a','robot-b'];
  mesh.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-1,0,0));
  mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(2,1,0));parent.add(mesh);
  const selected=resolveSelection(THREE,scene,camera,'robot-b',identify);
  assert.equal(selected.instanceId,1);assert.equal(selected.meshId,'group/robot-a');
  assert.equal(selected.groupInstanceCount,2);assert.deepEqual(selected.worldPosition,[5,1,0]);
  assert.equal(resolveSelection(THREE,scene,camera,'invented',identify),null);
});
test('camera synchronization preserves orientation and projection and rejects nonfinite state',()=>{
  const {camera}=fixture(),other=new THREE.PerspectiveCamera(70,2,.01,500);
  camera.position.set(4,6,8);camera.lookAt(1,2,3);camera.updateMatrixWorld();
  const snapshot=snapshotCamera(camera);assert.ok(validCamera(snapshot));restoreCamera(other,snapshot);
  assert.deepEqual(snapshotCamera(other),snapshot);
  assert.equal(validCamera({...snapshot,position:[NaN,0,0]}),false);
  assert.throws(()=>restoreCamera(other,{position:[0,0,0]}),/Invalid/);
});

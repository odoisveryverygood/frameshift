/** Explicit generated-viewer browser check, no model calls. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'vite';
import {writeStlViewer} from '../server/stl/viewer-template.mjs';
import {withPage} from '../server/benchmark.mjs';
const folder=path.resolve('.frameshift/stl-viewer-live');await fs.mkdir(folder,{recursive:true});
const tetra=[0,0,0,2,0,0,0,3,0,0,0,0,0,0,3,2,0,0,0,0,0,0,3,0,0,0,3,2,0,0,0,0,3,0,3,0];
const positions=new Float32Array([...tetra,...tetra.map((n,i)=>i%3===0?n+5:n)]),ids=new Uint32Array([0,0,0,0,1,1,1,1]);
await writeStlViewer(folder,{positions,componentIds:ids,units:'mm',name:'Two inferred fixture shells',originalPositions:new Float32Array([...positions,...tetra]),originalComponentIds:new Uint32Array([...ids,0,0,0,0])});
try{await fs.symlink(path.resolve('node_modules'),path.join(folder,'node_modules'),'dir')}catch{}
const compile=()=>build({root:folder,base:'./',logLevel:'warn',build:{outDir:'dist',emptyOutDir:true}});
await compile();
let baseline;
await withPage(path.join(folder,'dist'),undefined,async(page,errors)=>{
 const state=await page.evaluate(()=>window.__frameshift.step(0,0));assert.equal(state.items.length,2);assert.equal(state.triangles,8);
 baseline=await page.evaluate(()=>window.__frameshift.meshFingerprint());assert.equal(baseline.components.length,2);assert.ok(baseline.components.every(c=>c.triangles===4));
 await page.evaluate(()=>window.__frameshift.spatialSelect('shell-0'));const context=await page.evaluate(()=>window.__frameshift.spatialContext());assert.ok(context.selection.anchor.visible);
 await page.evaluate(()=>window.__frameshift.spatialSelect(null));await page.mouse.click(context.selection.anchor.x*960,context.selection.anchor.y*640);
 assert.equal(await page.evaluate(()=>window.__frameshift.interactionState().selected),'shell-0');assert.deepEqual(errors,[]);
 await page.goto(page.url()+'&variant=source',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__frameshift?.ready===true);const sourceState=await page.evaluate(()=>window.__frameshift.step(0,0));assert.equal(sourceState.triangles,12);assert.equal(await page.evaluate(()=>window.__frameshift.metadata.stl.triangles),12);
});
const source=await fs.readFile(path.join(folder,'src/scene.js'),'utf8');
const batched=source.replace('  return {update(){},root};',`  const originals=[...root.children];const batch=new THREE.InstancedMesh(originals[0].geometry,originals[0].material,originals.length);batch.userData.semanticIds=originals.map(o=>o.userData.semanticId);for(let i=0;i<originals.length;i++){originals[i].updateMatrix();batch.setMatrixAt(i,originals[i].matrix);root.remove(originals[i]);}batch.instanceMatrix.needsUpdate=true;batch.frustumCulled=false;root.add(batch);\n  return {update(){},root};`);
await fs.writeFile(path.join(folder,'src/scene.js'),batched);await compile();
await withPage(path.join(folder,'dist'),undefined,async(page,errors)=>{
 const state=await page.evaluate(()=>window.__frameshift.step(0,0));assert.equal(state.calls,1);assert.deepEqual(await page.evaluate(()=>window.__frameshift.meshFingerprint()),baseline);assert.deepEqual(errors,[]);
});
await fs.writeFile(path.join(folder,'src/scene.js'),source.replace('    geometry.computeVertexNormals();','    if(component===0) geometry.attributes.position.setX(0,geometry.attributes.position.getX(0)+0.1);\n    geometry.computeVertexNormals();'));await compile();
await withPage(path.join(folder,'dist'),undefined,async page=>{await page.evaluate(()=>window.__frameshift.step(0,0));assert.notDeepEqual(await page.evaluate(()=>window.__frameshift.meshFingerprint()),baseline);});
const evidence={passed:true,at:new Date().toISOString(),checks:['generated viewer loads exact binary geometry and finite original preview','two inferred shell IDs and actual click selection','canonical geometry fingerprints survive compatible instancing','geometry mutation changes independent signature'],baseline};
await fs.writeFile(path.join(folder,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));

/** Explicit browser smoke; not part of the lightweight default Node suite. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {build} from 'vite';
import {buildInstrumented} from '../server/integration.mjs';
import {withPage} from '../server/benchmark.mjs';
const root=path.resolve('.'),base=path.join(root,'.frameshift/spatial-live');
await fs.mkdir(base,{recursive:true});
const results=[];
for(const [name,source,auto,target] of [['automatic','tests/fixtures/plain-three',true,'cell-12'],['manual-warehouse','examples/warehouse',false,'robot-820']]) {
 const folder=path.join(base,name);await fs.mkdir(folder,{recursive:true});
 await fs.cp(path.join(root,source),folder,{recursive:true});
 try{await fs.symlink(path.join(root,'node_modules'),path.join(folder,'node_modules'),'dir')}catch{}
 if(auto)await buildInstrumented(folder,{outputDir:'dist'});
 else await build({root:folder,base:'./',logLevel:'warn',build:{outDir:'dist',emptyOutDir:true}});
 await withPage(path.join(folder,'dist'),new AbortController().signal,async(page,errors)=>{
   const before=await page.evaluate(()=>window.__frameshift.step(0,0));
   const selected=await page.evaluate(id=>{window.__frameshift.spatialSelect(id);return window.__frameshift.spatialContext()},target);
   assert.equal(selected.selectedId,target);assert.ok(selected.selected.anchor.visible);assert.ok(selected.metrics.calls>0);
   await page.evaluate(()=>window.__frameshift.spatialSelect(null));
   await page.mouse.click(selected.selected.anchor.x*960,selected.selected.anchor.y*640);
   const actual=await page.evaluate(()=>({context:window.__frameshift.spatialContext(),interaction:window.__frameshift.interactionState()}));
   assert.equal(actual.context.selectedId,target);assert.equal(actual.interaction.selected,target);
   if(auto)assert.ok(actual.interaction.dom.some(item=>item.label==='selection'&&item.text===target));
   const camera=actual.context.cameraState;
   const after=await page.evaluate(camera=>window.__frameshift.step(1,2,camera),camera);
   assert.deepEqual(after.cameraState,camera);
   assert.equal(await page.locator('[data-earl-inspector]').count(),0,'benchmark page cannot contain inspector markers');
   assert.equal(after.calls,before.calls,'inspection cannot add WebGL submissions');
   assert.deepEqual(errors,[]);
   results.push({name,target,actualClick:true,selected:actual.interaction.selected,cameraSynchronized:true,benchmarkOverlayDisabled:true,calls:after.calls,objects:after.items.length});
 });
}
await fs.writeFile(path.join(base,'evidence.json'),JSON.stringify({passed:true,at:new Date().toISOString(),checks:results},null,2));
console.log(JSON.stringify({passed:true,checks:results},null,2));

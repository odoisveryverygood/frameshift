import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {hasProjectDependencies,projectModules} from '../server/project-dependencies.mjs';
async function fixture(t,pkg){const base=await fs.mkdtemp(path.join(os.tmpdir(),'sift-deps-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));const source=path.join(base,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'package.json'),JSON.stringify(pkg));return {base,source,options:{root:path.join(base,'sift'),data:path.join(base,'data')}}}
test('a random project does not silently borrow Sift dependencies; cached installs deduplicate',async t=>{
 const {source,options}=await fixture(t,{dependencies:{three:'0.181.2'},devDependencies:{vite:'7.3.7'}});let installs=0;
 options.installer=async folder=>{installs++;for(const name of ['three','vite']){await fs.mkdir(path.join(folder,'node_modules',name),{recursive:true});await fs.writeFile(path.join(folder,'node_modules',name,'package.json'),'{}')}};
 const [a,b]=await Promise.all([projectModules(source,options),projectModules(source,options)]);assert.equal(a,b);assert.equal(installs,1);assert.ok(a.startsWith(options.data));assert.equal(await projectModules(source,options),a);assert.equal(installs,1);
});
test('prepared local dependencies are used without invoking install',async t=>{
 const {source,options}=await fixture(t,{dependencies:{three:'^0.181.0'}});await fs.mkdir(path.join(source,'node_modules/three'),{recursive:true});await fs.writeFile(path.join(source,'node_modules/three/package.json'),'{}');options.installer=()=>assert.fail('must not install');assert.equal(await projectModules(source,options),path.join(source,'node_modules'));
});
test('missing packages are detected; unsupported local-reference installs fail clearly',async t=>{
 const {source,options}=await fixture(t,{dependencies:{three:'file:../private'}});assert.equal(await hasProjectDependencies(path.join(source,'node_modules'),{dependencies:{three:'*'}}),false);await assert.rejects(projectModules(source,options),/registry packages only/);
});
test('failed installs never create a reusable ready cache',async t=>{
 const {source,options}=await fixture(t,{dependencies:{three:'0.181.2'}});let attempts=0;options.installer=async()=>{attempts++;throw Error('network unavailable')};await assert.rejects(projectModules(source,options),/network unavailable/);await assert.rejects(projectModules(source,options),/network unavailable/);assert.equal(attempts,2);
});

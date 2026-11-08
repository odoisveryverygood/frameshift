import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {buildInstrumented} from '../server/integration.mjs';

test('automatic build preserves aliases and runs existing Vite plugins once',async t=>{
 const base=path.resolve('.frameshift/integration-config-test');await fs.mkdir(base,{recursive:true});t.after(()=>fs.rm(base,{recursive:true,force:true}));
 await fs.writeFile(path.join(base,'package.json'),JSON.stringify({type:'module'}));await fs.symlink(path.resolve('node_modules'),path.join(base,'node_modules'),'dir').catch(()=>{});
 await fs.writeFile(path.join(base,'index.html'),'<script type="module" src="/main.js"></script>');
 await fs.writeFile(path.join(base,'color.js'),'export const color=0xabcdef');
 await fs.writeFile(path.join(base,'main.js'),`import {Scene,PerspectiveCamera,WebGLRenderer,Mesh,BoxGeometry,MeshBasicMaterial} from 'three';import {color} from '@color';const r=new WebGLRenderer();r.setSize(100,100);document.body.append(r.domElement);const s=new Scene();s.add(new Mesh(new BoxGeometry(),new MeshBasicMaterial({color})));r.render(s,new PerspectiveCamera());`);
 await fs.writeFile(path.join(base,'vite.config.mjs'),`import {fileURLToPath} from 'node:url';let visits=0;export default {resolve:{alias:{'@color':fileURLToPath(new URL('./color.js',import.meta.url))}},plugins:[{name:'single-transform',transform(code,id){if(id.endsWith('/main.js')&&++visits>1)throw Error('project plugin executed twice')}}]}`);
 const logs=[];const dist=await buildInstrumented(base,{outputDir:'dist'},{onLog:line=>logs.push(line)});assert.ok((await fs.stat(path.join(dist,'index.html'))).isFile());assert.ok(logs.some(l=>l.includes('Instrumented')));
});

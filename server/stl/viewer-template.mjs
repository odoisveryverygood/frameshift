/** Generate a local, source-inspectable viewer for an imported triangle mesh. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT } from '../core.mjs';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const unitsSet = new Set(['mm','cm','m','in']);

export async function writeStlViewer(workspace, {positions, componentIds, units='mm', name='Imported robot', sourceHash=null, report=null, originalPositions=null, originalComponentIds=null}={}) {
  if(!unitsSet.has(units))throw Error('Choose explicit STL units: mm, cm, m or in.');
  if(!(positions instanceof Float32Array) && !Array.isArray(positions))throw Error('STL viewer requires repaired vertex positions.');
  if(!positions.length || positions.length%9 || positions.length>200000*9)throw Error('STL viewer supports 1–200000 complete triangles.');
  const values=new Float32Array(positions);
  if(!values.every(Number.isFinite))throw Error('STL viewer cannot render non-finite positions.');
  const triangles=values.length/9;
  const previewOnly=report?.previewOnly===true;
  const fullMeshTriangles=previewOnly?report.outputTriangles:triangles;
  if(previewOnly&&(!Number.isSafeInteger(fullMeshTriangles)||fullMeshTriangles<triangles))throw Error('Overview needs the full repaired mesh triangle count.');
  if(componentIds && componentIds.length!==triangles)throw Error('STL component map does not match triangle count.');
  const ids=new Uint32Array(triangles);
  const distinct=new Set();
  for(let i=0;i<triangles;i++){
    const value=componentIds?.[i]??0;
    if(!Number.isInteger(value)||value<0||value>triangles)throw Error('Invalid inferred shell identity.');
    ids[i]=value;distinct.add(value);
  }
  const grouped=distinct.size>512;
  if(grouped||previewOnly)ids.fill(0);
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<values.length;i++){const axis=i%3;min[axis]=Math.min(min[axis],values[i]);max[axis]=Math.max(max[axis],values[i]);}
  const dimensions=max.map((v,i)=>v-min[i]);
  const extent=Math.max(...dimensions);if(!Number.isFinite(extent)||extent<=0)throw Error('STL mesh has no usable spatial extent.');
  const positionsBytes=Buffer.alloc(values.length*4),idsBytes=Buffer.alloc(ids.length*4);
  for(let i=0;i<values.length;i++)positionsBytes.writeFloatLE(values[i],i*4);
  for(let i=0;i<ids.length;i++)idsBytes.writeUInt32LE(ids[i],i*4);
  const baseName=String(name).replace(/[\x00-\x1f\x7f]/g,'').slice(0,150)||'Imported robot';
  const metadata={version:1,name:baseName+(previewOnly?' · mesh overview':''),units,triangles,previewOnly,largeMesh:previewOnly||Boolean(report?.largeMesh),fullMeshTriangles,
    boundsScope:previewOnly?'Sampled overview geometry only':'Complete rendered mesh geometry',
    limitation:previewOnly?'This is a sampled display overview. It is not the complete repaired mesh, an identified assembly, or proof that full geometry is correct.':null,
    sourceHash,positionsSha256:sha(positionsBytes),componentMapSha256:sha(idsBytes),inferredShellCount:previewOnly?null:distinct.size,renderGroups:grouped||previewOnly?1:distinct.size,
    componentsGroupedForDisplay:grouped,bounds:{min,max,dimensions,center:min.map((v,i)=>(v+max[i])/2)},displayScale:10/extent,
    identityScope:previewOnly?'Display overview only; sampled triangles are not identified robot parts or complete geometry.':grouped?'Whole triangle mesh; disconnected shells grouped for display.':'Connected geometric shells inferred from STL topology, not named robot parts or joints.',
    repairSummary:report?{status:report.status||null,requiresReview:Boolean(report.requiresReview)}:null};
  let originalAssets = null;
  if(originalPositions){
    if(!(originalPositions instanceof Float32Array)&&!Array.isArray(originalPositions))throw Error('Invalid finite source preview positions.');
    const original=new Float32Array(originalPositions);
    if(!original.length||original.length%9||original.length>200000*9||!original.every(Number.isFinite))throw Error('Source preview supports complete finite triangles only.');
    const originalCount=original.length/9;
    if(originalComponentIds&&originalComponentIds.length!==originalCount)throw Error('Invalid source preview shell map.');
    const sourceIds=new Uint32Array(originalCount);
    for(let i=0;i<originalCount;i++){const id=originalComponentIds?.[i]??0;if(!Number.isInteger(id)||id<0||id>originalCount)throw Error('Invalid source shell identity.');sourceIds[i]=id;}
    const sourceGroups=new Set(sourceIds);if(sourceGroups.size>512||previewOnly)sourceIds.fill(0);
    const sourcePositionsBytes=Buffer.alloc(original.length*4),sourceIdsBytes=Buffer.alloc(sourceIds.length*4);
    for(let i=0;i<original.length;i++)sourcePositionsBytes.writeFloatLE(original[i],i*4);
    for(let i=0;i<sourceIds.length;i++)sourceIdsBytes.writeUInt32LE(sourceIds[i],i*4);
    metadata.sourcePreview={triangles:originalCount,positionsSha256:sha(sourcePositionsBytes),componentMapSha256:sha(sourceIdsBytes),positionsAsset:'source-mesh.bin',componentsAsset:'source-components.bin',inferredShellCount:previewOnly?null:sourceGroups.size,renderGroups:sourceGroups.size>512||previewOnly?1:sourceGroups.size,componentsGroupedForDisplay:sourceGroups.size>512,identityScope:previewOnly?metadata.identityScope:'Finite source facets only; unreadable/non-finite facets cannot be rendered. Not a repaired or manufacturing-validated model.'};
    originalAssets={positions:sourcePositionsBytes,ids:sourceIdsBytes};
  }
  await fs.mkdir(path.join(workspace,'src'),{recursive:true});await fs.mkdir(path.join(workspace,'public'),{recursive:true});
  const rootPackage=JSON.parse(await fs.readFile(path.join(ROOT,'package.json'),'utf8'));
  await fs.writeFile(path.join(workspace,'package.json'),JSON.stringify({name:'earl-imported-stl',private:true,type:'module',scripts:{build:'vite build --base=./'},dependencies:{three:rootPackage.dependencies.three,vite:rootPackage.dependencies.vite}},null,2)+'\n');
  await fs.writeFile(path.join(workspace,'index.html'),'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Earl / imported STL</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#e9eeec}canvas{display:block}#mesh-label{position:fixed;bottom:14px;left:16px;pointer-events:none;color:#61716a;font:11px system-ui;letter-spacing:.02em}</style></head><body><div id="mesh-label"></div><script type="module" src="./src/main.js"></script></body></html>\n');
  const config={name:metadata.name,buildCommand:['npm','run','build'],outputDir:'dist',editableFiles:['src/scene.js'],requireMeshFingerprint:true,previewOnly,autoInstrument:false,adapter:'__frameshift',metric:'submitP95',samples:60,repeats:3,minImprovement:.08,maxVisualDifference:.01};
  await fs.writeFile(path.join(workspace,'frameshift.config.json'),JSON.stringify(config,null,2)+'\n');
  if(originalAssets){await fs.writeFile(path.join(workspace,'public','source-mesh.bin'),originalAssets.positions);await fs.writeFile(path.join(workspace,'public','source-components.bin'),originalAssets.ids);}
  await fs.writeFile(path.join(workspace,'public','mesh.bin'),positionsBytes);await fs.writeFile(path.join(workspace,'public','components.bin'),idsBytes);
  await fs.writeFile(path.join(workspace,'src','mesh-metadata.json'),JSON.stringify(metadata)+'\n');
  await fs.copyFile(path.join(ROOT,'sdk','spatial.mjs'),path.join(workspace,'src','earl-spatial.js'));
  await fs.writeFile(path.join(workspace,'src','scene.js'),sceneSource);
  await fs.writeFile(path.join(workspace,'src','main.js'),mainSource);
  return {workspace,config,metadata};
}

const sceneSource = String.raw`// These are inferred geometric shells. STL does not provide robot joints or part names.
// Preserve every triangle, shell identity and original world-space position.
export function createWorld(THREE, scene, data) {
  const root = new THREE.Group();
  root.name = 'Imported STL representation';
  root.scale.setScalar(data.metadata.displayScale);
  scene.add(root);
  const material = new THREE.MeshStandardMaterial({color:0x6e9390,roughness:.52,metalness:.12,side:THREE.DoubleSide});
  const buckets = new Map();
  for (let i=0;i<data.componentIds.length;i++) {
    const id=data.componentIds[i];
    if(!buckets.has(id))buckets.set(id,[]);
    buckets.get(id).push(i);
  }
  const center=data.metadata.bounds.center;
  for(const [component,facets] of [...buckets.entries()].sort((a,b)=>a[0]-b[0])) {
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const facet of facets)for(let i=0;i<9;i++){const axis=i%3,v=data.positions[facet*9+i];min[axis]=Math.min(min[axis],v);max[axis]=Math.max(max[axis],v);}
    const localCenter=min.map((v,i)=>(v+max[i])/2);
    const positions=new Float32Array(facets.length*9);let cursor=0;
    for(const facet of facets)for(let i=0;i<9;i++)positions[cursor++]=data.positions[facet*9+i]-localCenter[i%3];
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
    const mesh=new THREE.Mesh(geometry,material);
    mesh.userData.semanticId='shell-'+component;
    mesh.name=data.metadata.previewOnly?'Mesh overview':data.metadata.componentsGroupedForDisplay?'Whole STL mesh':'Inferred shell '+(component+1);
    mesh.position.set(...localCenter.map((v,i)=>v-center[i]));
    if(data.metadata.previewOnly){
      // A sparse facet subset is hard to see. These points mark sampled vertices;
      // they do not fill the gaps or invent replacement surfaces.
      const points=new THREE.Points(geometry,new THREE.PointsMaterial({color:0x386b65,size:.025,sizeAttenuation:true}));
      points.userData.frameshiftIgnore=true;mesh.add(points);
    }
    root.add(mesh);
  }
  return {update(){},root};
}
`;

const mainSource = String.raw`import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {installSpatialBridge,snapshotCamera,restoreCamera} from './earl-spatial.js';
import fileMetadata from './mesh-metadata.json';
const sourceView=new URLSearchParams(location.search).get('variant')==='source';
const metadata=sourceView&&fileMetadata.sourcePreview?{...fileMetadata,...fileMetadata.sourcePreview,name:fileMetadata.name+' · finite source preview'}:fileMetadata;
import {createWorld} from './scene.js';
const hex=bytes=>[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
async function digest(bytes){if(!crypto.subtle)throw Error('Secure mesh integrity checks require a localhost or HTTPS browser context.');return hex(await crypto.subtle.digest('SHA-256',bytes));}
async function load(name,expected){const response=await fetch(new URL(name,document.baseURI));if(!response.ok)throw Error('Mesh asset could not be loaded: '+name);const bytes=await response.arrayBuffer();if(await digest(bytes)!==expected)throw Error('Mesh asset integrity check failed: '+name);return bytes;}
const [positionBytes,componentBytes]=await Promise.all([load(metadata.positionsAsset||'mesh.bin',metadata.positionsSha256),load(metadata.componentsAsset||'components.bin',metadata.componentMapSha256)]);
const positions=new Float32Array(positionBytes),componentIds=new Uint32Array(componentBytes);
if(positions.length!==metadata.triangles*9||componentIds.length!==metadata.triangles)throw Error('Mesh asset length changed.');
const data={positions,componentIds,metadata};
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);renderer.setClearColor(0xe9eeec);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x80938c,2.4));const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(8,12,9);scene.add(key);const fill=new THREE.DirectionalLight(0xdce8ff,1.5);fill.position.set(-8,2,-5);scene.add(fill);
const camera=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.01,200);const views=[[13,9,15],[-14,7,13],[1,18,8]];camera.position.set(...views[0]);camera.lookAt(0,0,0);camera.updateMatrixWorld();
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,0);controls.enableDamping=true;
const world=createWorld(THREE,scene,data);let paused=new URLSearchParams(location.search).get('__frameshift')==='1',time=0,selected=null,last=performance.now();const frames=[],submit=[];const ray=new THREE.Raycaster();
const label=document.querySelector('#mesh-label');label.textContent=metadata.previewOnly?metadata.name+' · '+metadata.triangles.toLocaleString()+' of '+metadata.fullMeshTriangles.toLocaleString()+' triangles · overview only':metadata.name+(sourceView?' · reference bounds ':' · ')+metadata.bounds.dimensions.map(n=>Number(n.toPrecision(5))).join(' × ')+' '+metadata.units+' · '+metadata.triangles.toLocaleString()+' triangles';
function render(t){world.update?.(t);renderer.render(scene,camera);}
function semanticObjects(){const out=[];scene.updateMatrixWorld(true);const local=new THREE.Matrix4();scene.traverse(mesh=>{if(!mesh.isMesh||mesh.userData.frameshiftIgnore)return;if(mesh.isInstancedMesh&&Array.isArray(mesh.userData.semanticIds)){for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,local);local.premultiply(mesh.matrixWorld);out.push({id:String(mesh.userData.semanticIds[i]),mesh,matrix:local.clone()});}}else if(mesh.userData.semanticId!=null)out.push({id:String(mesh.userData.semanticId),mesh,matrix:mesh.matrixWorld.clone()});});return out.sort((a,b)=>a.id.localeCompare(b.id));}
function items(){return semanticObjects().map(o=>[o.id,...o.matrix.elements.map(n=>Number(n.toFixed(6)))]);}
function pick(x,y){ray.setFromCamera(new THREE.Vector2(x,y),camera);const hit=ray.intersectObjects(scene.children,true).find(h=>h.object.isMesh&&(h.object.userData.semanticId!=null||Array.isArray(h.object.userData.semanticIds)));return hit?(hit.object.isInstancedMesh?String(hit.object.userData.semanticIds[hit.instanceId]):String(hit.object.userData.semanticId)):null;}
function interactionState(){return {selected,dom:[]};}
function step(t=0,view=0,override=null){if(!Number.isFinite(t)||t<0)throw Error('Invalid mesh scene time');paused=true;time=t;camera.position.set(...views[Math.max(0,Math.min(2,Math.trunc(view)||0))]);camera.lookAt(0,0,0);if(override)restoreCamera(camera,override);camera.updateMatrixWorld();render(t);return {items:items(),picks:[[-.5,-.2],[0,0],[.3,.1],[.6,-.3],[-.2,.4]].map(([x,y])=>pick(x,y)),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,cameraState:snapshotCamera(camera),time,interactionState:interactionState()};}
async function sample(n=60){paused=true;for(let i=0;i<20;i++){render(0);await new Promise(requestAnimationFrame);}const intervals=[],cpu=[];let previous=await new Promise(requestAnimationFrame);for(let i=0;i<n;i++){const now=await new Promise(requestAnimationFrame);intervals.push(now-previous);previous=now;const start=performance.now();render(0);cpu.push(performance.now()-start);}const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {frames:intervals,submit:cpu,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,longTasks:[],renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};}
async function gpuSample(){paused=true;const gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)return {supported:false,times:[]};const times=[];for(let i=0;i<8;i++){const q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q);render(0);gl.endQuery(ext.TIME_ELAPSED_EXT);for(let j=0;j<30;j++){await new Promise(requestAnimationFrame);if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)){if(!gl.getParameter(ext.GPU_DISJOINT_EXT))times.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);break;}}gl.deleteQuery(q);}return {supported:times.length>0,times};}
// Protected actual-scene geometry signature. Canonical world triangles make order
// changes and compatible instancing comparable, while changed geometry fails.
async function meshFingerprint(){
 const results=[];const vertex=new THREE.Vector3();let seenTriangles=0;
 scene.traverse(mesh=>{if(mesh.isMesh&&!mesh.userData.frameshiftIgnore&&mesh.userData.semanticId==null&&!(mesh.isInstancedMesh&&Array.isArray(mesh.userData.semanticIds)))throw Error('Rendered mesh has no preserved shell identity');});
 for(const object of semanticObjects()){
  const geometry=object.mesh.geometry,position=geometry.getAttribute('position'),index=geometry.index;
  if(!position||position.itemSize!==3)throw Error('Missing rendered STL geometry');
  const total=index?index.count:position.count,start=Math.max(0,geometry.drawRange.start||0),count=Math.min(total-start,geometry.drawRange.count);
  seenTriangles+=count/3;
  if(start%3||count%3||!Number.isFinite(count)||count<3||seenTriangles>200000)throw Error('Invalid rendered mesh triangle range');
  const records=new Int32Array(count*3),bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};let cursor=0;
  for(let i=start;i<start+count;i+=3){const corners=[];for(let k=0;k<3;k++){const v=index?index.getX(i+k):i+k;vertex.fromBufferAttribute(position,v).applyMatrix4(object.matrix);const xyz=[vertex.x,vertex.y,vertex.z];if(xyz.some(n=>!Number.isFinite(n)||Math.abs(n)>2000))throw Error('Rendered mesh coordinates exceed protected bounds');for(let axis=0;axis<3;axis++){bounds.min[axis]=Math.min(bounds.min[axis],xyz[axis]);bounds.max[axis]=Math.max(bounds.max[axis],xyz[axis]);}corners.push(xyz.map(n=>Math.round(n*1e6)));}corners.sort((a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]);for(const corner of corners)for(const n of corner)records[cursor++]=n;}
  const order=Array.from({length:count/3},(_,i)=>i);order.sort((a,b)=>{for(let k=0;k<9;k++){const d=records[a*9+k]-records[b*9+k];if(d)return d;}return 0;});const sorted=new Int32Array(records.length);for(let i=0;i<order.length;i++)sorted.set(records.subarray(order[i]*9,order[i]*9+9),i*9);
  results.push({id:object.id,triangles:count/3,bounds:{min:bounds.min.map(n=>Number(n.toFixed(6))),max:bounds.max.map(n=>Number(n.toFixed(6)))},sha256:await digest(sorted.buffer)});
 }
 return {version:1,quantization:1e-6,space:'normalized viewer world coordinates',scope:metadata.previewOnly?'Sampled overview geometry only':'Complete rendered mesh geometry',sourcePositionsSha256:metadata.positionsSha256,components:results};
}
window.__frameshift={ready:true,metadata:{engine:THREE.REVISION,backend:'WebGL2',pixelRatio:1,stl:metadata},pause(){paused=true;},resume(){paused=false;last=performance.now();},step,sample,gpuSample,pick,interactionState,meshFingerprint,geometryFingerprint:meshFingerprint,telemetry(){return {frames:frames.slice(-100),submit:submit.slice(-100),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};},assetIntegrity:{positionsSha256:metadata.positionsSha256,componentMapSha256:metadata.componentMapSha256}};
installSpatialBridge(THREE,{api:window.__frameshift,renderer,getScene:()=>scene,getCamera:()=>camera,getTime:()=>time,getSelected:()=>selected,setSelected:id=>{selected=id;},identify:mesh=>mesh.userData.semanticId??(mesh.name||null),recordInteractions:true,deterministicTime:true});
window.__frameshift.listObjects=()=>window.__frameshift.spatialContext()?.objects||[];
window.addEventListener('message',event=>{if(event.source!==window.parent||event.origin!==location.origin)return;const d=event.data;if(d?.type==='frameshift:pause')paused=true;if(d?.type==='frameshift:resume'){paused=false;last=performance.now();}if(d?.type==='frameshift:step')step(d.time,d.view||0,d.cameraState||d.camera||null);});
controls.addEventListener('change',()=>{if(paused)render(time);});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);render(time);});
render(0);
requestAnimationFrame(function tick(now){if(!paused){time+=Math.min(.05,(now-last)/1000);controls.update();const start=performance.now();render(time);submit.push(performance.now()-start);frames.push(now-last);if(submit.length>150)submit.shift();if(frames.length>150)frames.shift();}last=now;requestAnimationFrame(tick);});
setInterval(()=>{if(window.parent!==window)window.parent.postMessage({type:'frameshift:telemetry',...window.__frameshift.telemetry()},location.origin);},700);
`;

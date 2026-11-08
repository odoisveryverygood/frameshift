import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFleet } from './fleet.js';
import { createWarehouse } from './warehouse.js';
import { robotPose, indexFromId, ROBOT_COUNT, ROUTE_LENGTH, STRAIGHT } from './simulation.js';
import { installSpatialBridge, snapshotCamera, restoreCamera } from './earl-spatial.js';
import './style.css';

const $ = id => document.getElementById(id);
const controlled = new URLSearchParams(location.search).get('__frameshift') === '1';
if(controlled)document.documentElement.dataset.controlled='true';
if(window.parent!==window)document.documentElement.dataset.embedded='true';
let renderer;
try {renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});}
catch(error){$('fatal').hidden=false;$('fatal').textContent='WebGL could not start. Enable hardware acceleration and open this project in Chrome.';throw error;}
renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight);
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
$('viewport').appendChild(renderer.domElement);
const scene=new THREE.Scene();createWarehouse(THREE,scene);
const camera=new THREE.PerspectiveCamera(40,innerWidth/innerHeight,.1,350);
const views=[[80,75,98],[-84,66,88],[3,115,28]];
const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,0,0);controls.enableDamping=true;controls.maxPolarAngle=Math.PI/2-.08;controls.minDistance=4;controls.maxDistance=190;
function setView(view=0){camera.position.set(...views[view%views.length]);controls.target.set(0,0,0);camera.lookAt(0,0,0);camera.updateMatrixWorld();controls.update();}
setView();
const fleet=createFleet(THREE,scene), ray=new THREE.Raycaster();
let time=0,running=true,profiling=controlled,speed=1,selected=null,last=performance.now(),lastHud=0;
const timings=[],submits=[];
const assignments=new Map();
function renderAt(t){fleet.update(t);renderer.render(scene,camera);}
function items(){scene.updateMatrixWorld(true);const result=[],matrix=new THREE.Matrix4();scene.traverse(mesh=>{
  if(!mesh.isMesh)return;
  if(mesh.isInstancedMesh&&Array.isArray(mesh.userData.semanticIds)){
    for(let i=0;i<mesh.count;i++){const id=mesh.userData.semanticIds[i];if(indexFromId(id)===null)continue;mesh.getMatrixAt(i,matrix);matrix.premultiply(mesh.matrixWorld);result.push([String(id),...matrix.elements.map(n=>Number(n.toFixed(5)))]);}
  }else if(indexFromId(mesh.userData.semanticId)!==null){result.push([String(mesh.userData.semanticId),...mesh.matrixWorld.elements.map(n=>Number(n.toFixed(5)))]);}
});return result.sort((a,b)=>a[0].localeCompare(b[0]));}
function pick(x,y){scene.updateMatrixWorld(true);camera.updateMatrixWorld();ray.setFromCamera(new THREE.Vector2(x,y),camera);const hit=ray.intersectObjects(scene.children,true).find(h=>indexFromId(h.object.isInstancedMesh?h.object.userData.semanticIds?.[h.instanceId]:h.object.userData.semanticId)!==null);return hit?(hit.object.isInstancedMesh?hit.object.userData.semanticIds[hit.instanceId]:hit.object.userData.semanticId):null;}
function select(id){selected=indexFromId(id)!==null?String(id):null;updateInspector();}
function updateInspector(){const index=indexFromId(selected);$('dispatch').disabled=index===null;if(index===null){$('robot-name').textContent='Select a robot';$('robot-description').textContent='Choose any vehicle in the scene, or locate a unit below.';for(const id of ['assignment','route','position','battery'])$(id).textContent='—';return;}
 const pose=robotPose(index,time);$('robot-name').textContent='AMR '+String(index+1).padStart(4,'0');$('robot-description').textContent='Autonomous mobile robot / online';const task=assignments.get(index);$('assignment').textContent=task?(time>=task.finishAt?'Packing / delivered':'Packing / en route'):pose.assignment;$('route').textContent='Loop '+String(pose.route).padStart(2,'0');$('position').textContent=`${pose.x.toFixed(1)}, ${pose.z.toFixed(1)} m`;$('battery').textContent=pose.battery+'%';}
function updateHud(now){updateInspector();$('clock').textContent=String(Math.floor(time/60)).padStart(2,'0')+':'+String(Math.floor(time%60)).padStart(2,'0');$('run-state').textContent=profiling?'Controlled replay':running?'Simulation running':'Simulation paused';
 const sorted=timings.slice(-90).sort((a,b)=>a-b),cpu=submits.slice(-90).sort((a,b)=>a-b);$('fps').textContent=sorted.length?Math.round(1000/sorted[Math.floor(sorted.length/2)]):'—';$('cpu').textContent=cpu.length?cpu[Math.floor(cpu.length*.95)].toFixed(1):'—';$('calls').textContent=renderer.info.render.calls.toLocaleString();lastHud=now;}
function tick(now){const elapsed=Math.max(0,now-last);last=now;if(!profiling){if(running)time+=Math.min(elapsed/1000,.1)*speed;controls.update();const start=performance.now();renderAt(time);submits.push(performance.now()-start);if(elapsed>0)timings.push(elapsed);if(submits.length>180)submits.shift();if(timings.length>180)timings.shift();if(now-lastHud>300)updateHud(now);}requestAnimationFrame(tick);}
renderAt(0);updateHud(performance.now());requestAnimationFrame(tick);
$('dispatch').addEventListener('click',()=>{const index=indexFromId(selected);if(index===null)return;const pose=robotPose(index,time);const offset=(index%100)*ROUTE_LENGTH/100;const phase=(offset+time*pose.speed)%ROUTE_LENGTH;const distance=(STRAIGHT-phase+ROUTE_LENGTH)%ROUTE_LENGTH;assignments.set(index,{finishAt:time+distance/pose.speed});updateInspector();});
$('play').addEventListener('click',()=>{profiling=false;running=!running;$('play').textContent=running?'Ⅱ Pause':'▶ Resume';$('play').setAttribute('aria-label',running?'Pause simulation':'Resume simulation');updateHud(performance.now());});
$('reset').addEventListener('click',()=>{time=0;speed=1;assignments.clear();running=true;profiling=false;$('speed').value='1';selected=null;$('play').textContent='Ⅱ Pause';$('play').setAttribute('aria-label','Pause simulation');setView();renderAt(0);updateHud(performance.now());});
$('speed').addEventListener('change',()=>{speed=Number($('speed').value);});
$('find-form').addEventListener('submit',event=>{event.preventDefault();const index=Number($('robot-id').value)-1;if(!Number.isInteger(index)||index<0||index>=ROBOT_COUNT)return;const pose=robotPose(index,time);controls.target.set(pose.x,0,pose.z);camera.position.set(pose.x+6,9,pose.z+10);controls.update();window.__frameshift.spatialSelect('robot-'+index);renderAt(time);});
renderer.domElement.addEventListener('click',event=>{const r=renderer.domElement.getBoundingClientRect();select(pick((event.clientX-r.left)/r.width*2-1,1-(event.clientY-r.top)/r.height*2));});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderAt(time);});
const nextFrame=()=>new Promise(requestAnimationFrame);
async function sample(n=80){profiling=true;for(let i=0;i<20;i++){renderAt(i/60);await nextFrame();}const frames=[],submit=[];let previous=await nextFrame();for(let i=0;i<n;i++){const now=await nextFrame();frames.push(now-previous);previous=now;const start=performance.now();renderAt(i/60);submit.push(performance.now()-start);}return {frames,submit,calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,longTasks:[],renderer:renderer.getContext().getParameter(renderer.getContext().RENDERER)};}
async function gpuSample(){profiling=true;const gl=renderer.getContext(),ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)return {supported:false,times:[]};const times=[];for(let i=0;i<8;i++){const query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query);renderAt(i/60);gl.endQuery(ext.TIME_ELAPSED_EXT);for(let poll=0;poll<40;poll++){await nextFrame();if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){if(!gl.getParameter(ext.GPU_DISJOINT_EXT))times.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);break;}}gl.deleteQuery(query);}return {supported:times.length>0,times};}
const api=window.__frameshift={ready:true,metadata:{engine:THREE.REVISION,backend:'WebGL2',pixelRatio:1,simulation:'deterministic kinematic warehouse',robots:ROBOT_COUNT},pause(){profiling=true;},resume(){profiling=false;},step(t=0,view=0,override=null){if(!Number.isFinite(t)||t<0)throw Error('Invalid replay time');profiling=true;time=t;setView(view);if(override)restoreCamera(camera,override);renderAt(time);updateInspector();return {time,items:items(),picks:[[-.5,-.2],[0,0],[.3,.1],[.6,-.3],[-.2,.4]].map(([x,y])=>pick(x,y)),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,cameraState:snapshotCamera(camera),interactionState:api.interactionState()};},sample,gpuSample,pick,interactionState(){return {selected,dom:[{selector:'#robot-name',text:$('robot-name').textContent},{selector:'#assignment',text:$('assignment').textContent}]};},telemetry(){return {frames:timings.slice(-90),submit:submits.slice(-90),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};}};
installSpatialBridge(THREE,{api,renderer,getScene:()=>scene,getCamera:()=>camera,getTime:()=>time,getSelected:()=>selected,setSelected:select,identify:mesh=>mesh.userData.semanticId??null,recordInteractions:true,deterministicTime:true});
window.addEventListener('message',event=>{if(event.source!==window.parent||event.origin!==location.origin)return;if(event.data?.type==='frameshift:pause')api.pause();if(event.data?.type==='frameshift:resume')api.resume();if(event.data?.type==='frameshift:step')api.step(event.data.time,event.data.view||0,event.data.cameraState||event.data.camera||null);});
setInterval(()=>{if(window.parent!==window)window.parent.postMessage({type:'frameshift:telemetry',...api.telemetry()},location.origin);},700);

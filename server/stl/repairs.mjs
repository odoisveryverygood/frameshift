/** Local repair plans are immutable source-bound proposals; agents cannot approve exports. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {ROOT,id,json,save} from '../core.mjs';
import {getStlImport,stlImportDirectory} from './imports.mjs';
import {solveRigidAlignment} from './repair-geometry.mjs';
import {validateRepairBounds} from './repair-measure.mjs';
const exec=promisify(execFile),pending=new Map();
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId=value=>{if(!/^[a-zA-Z0-9-]{1,80}$/.test(value||''))throw Error('Invalid repair identity.');return value;};
export const repairDirectory=importId=>path.join(stlImportDirectory(importId),'repair');
async function source(importId){const record=await getStlImport(importId);if(record.status!=='review'||!record.repairedSha256)throw Error('Inspect this STL before starting a repair.');return {record,filename:path.join(stlImportDirectory(importId),'repaired.stl')};}
async function worker(importId,request,{signal}={}){
 const directory=path.join(repairDirectory(importId),'jobs',id());await fs.mkdir(directory,{recursive:true,mode:0o700});
 await save(path.join(directory,'request.json'),request);
 try{await exec(process.execPath,['--max-old-space-size=384',path.join(ROOT,'server/stl/repair-worker.mjs'),path.join(directory,'request.json')],{cwd:ROOT,timeout:180000,maxBuffer:8192,env:{PATH:process.env.PATH||''},signal});}
 catch(error){const detail=await json(path.join(directory,'error.json'),null);throw Error(detail?.error||'The bounded repair worker stopped or exceeded its limit. No verified export was published.');}
 return {directory,result:await json(path.join(directory,'result.json'))};
}
export async function getRepairData(importId,{signal}={}){
 const {record,filename}=await source(importId),directory=path.join(repairDirectory(importId),'overview');
 const metadataFile=path.join(directory,'overview-metadata.json');let metadata=await json(metadataFile,null);
 if(!metadata||metadata.sourceSha256!==record.repairedSha256||metadata.cacheVersion!==2){
  if(!pending.has(importId))pending.set(importId,(async()=>{
   const job=await worker(importId,{operation:'overview',source:filename,directory},{signal});
   const value={...job.result.metadata,cacheVersion:2,sourceSha256:record.repairedSha256,units:record.units,totalTriangles:record.report.outputTriangles};
   await save(metadataFile,value);return value;
  })().finally(()=>pending.delete(importId)));
  metadata=await pending.get(importId);
 }
 const suggestions=await findSeparatedRegions(importId,metadata,{signal});
 return {positionsUrl:`/api/stl/imports/${importId}/repair-assets/positions.bin`,metadata,regionSuggestions:suggestions.regions,filename:record.filename,provider:{name:'Gemini',model:'gemini-4-argon',configured:Boolean(process.env.GEMINI_API_KEY)}};
}
async function findSeparatedRegions(importId,metadata,{signal}={}){
 const file=path.join(repairDirectory(importId),'separated-regions.json');const cached=await json(file,null);if(cached?.sourceSha256===metadata.sourceSha256)return cached;
 const raw=await fs.readFile(path.join(repairDirectory(importId),'overview','overview-positions.bin'));const positions=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));let best=null;
 for(let axis=0;axis<3;axis++){
  const intervals=[];for(let i=0;i<positions.length;i+=9)intervals.push([Math.min(positions[i+axis],positions[i+3+axis],positions[i+6+axis]),Math.max(positions[i+axis],positions[i+3+axis],positions[i+6+axis])]);
  intervals.sort((a,b)=>a[0]-b[0]);if(!intervals.length)continue;let hi=intervals[0][1];const extent=metadata.bounds.max[axis]-metadata.bounds.min[axis];
  for(const interval of intervals){const gap=interval[0]-hi;if(gap>extent*.03&&(!best||gap/extent>best.score))best={axis,midpoint:(interval[0]+hi)/2,gap,score:gap/extent};hi=Math.max(hi,interval[1]);}
 }
 const regions=[];
 if(best){
  for(const side of ['lower','upper']){
   const bounds={min:metadata.bounds.min.map(n=>n-1e-4),max:metadata.bounds.max.map(n=>n+1e-4)};bounds[side==='lower'?'max':'min'][best.axis]=best.midpoint;
   const measurement=await measureRepairSelection(importId,bounds,{signal});
   if(measurement.selectedTriangles&&measurement.unselectedTriangles&&!measurement.boundaryCrossingFacets)regions.push({label:`${side==='upper'?'Upper':'Lower'} ${['X','Y','Z'][best.axis]} group`,bounds,triangles:measurement.selectedTriangles,measuredGap:best.gap,scope:'Geometrically separated region; confirm which group is the intake. Not a named CAD component.'});
  }
 }
 const result={sourceSha256:metadata.sourceSha256,regions:regions.sort((a,b)=>a.triangles-b.triangles),method:'Overview gap hypothesis checked against every full-resolution triangle.'};await save(file,result);return result;
}
export async function measureRepairSelection(importId,bounds,{signal}={}){
 const {filename}=await source(importId);return (await worker(importId,{operation:'measure',source:filename,bounds:validateRepairBounds(bounds)},{signal})).result;
}
export async function createRepairPlan(importId,input,{signal}={}){
 const {record}=await source(importId),bounds=validateRepairBounds(input.bounds);
 if(!Array.isArray(input.sourcePoints)||input.sourcePoints.some(p=>!Array.isArray(p)||p.length!==3||p.some((n,i)=>!Number.isFinite(n)||n<bounds.min[i]||n>bounds.max[i])))throw Error('Source mounting points must lie inside the selected moving region.');
 const scale={mm:.001,cm:.01,m:1,in:.0254}[record.units];
 const alignment=solveRigidAlignment(input.sourcePoints,input.targetPoints,{maxResidual:.0005/scale});
 const measurement=await measureRepairSelection(importId,bounds,{signal});
 if(!measurement.selectedTriangles||!measurement.unselectedTriangles)throw Error('Select a nonempty detached region, leaving the rest of the robot unchanged.');
 if(measurement.boundaryCrossingFacets)throw Error(`The region cuts through ${measurement.boundaryCrossingFacets} triangles. Adjust it to enclose a complete detached part before alignment.`);
 const plan={id:id(),importId,createdAt:new Date().toISOString(),sourceSha256:record.repairedSha256,...alignment,units:record.units,bounds,measurement,intent:'User-supplied mounting correspondences; intended mechanical placement requires human review.',verificationScope:'Rigid alignment and exact file transformation; collision, fastener compatibility and mechanical suitability unassessed.'};
 plan.sha256=digest(plan);await save(path.join(repairDirectory(importId),'plans',plan.id+'.json'),plan);return plan;
}
export async function createGapRepairPlan(importId,input,{signal}={}){
 const {record}=await source(importId),bounds=validateRepairBounds(input.bounds),data=await getRepairData(importId,{signal});
 const same=(a,b)=>['min','max'].every(k=>a[k].every((n,i)=>Math.abs(n-b[k][i])<1e-5));
 const moving=data.regionSuggestions.find(s=>same(s.bounds,bounds)),fixed=data.regionSuggestions.find(s=>!same(s.bounds,bounds));
 if(!moving||!fixed||data.regionSuggestions.length!==2)throw Error('Select one of the two measured separated groups to propose closing its axial gap.');
 const measurement=await measureRepairSelection(importId,bounds,{signal}),reference=await measureRepairSelection(importId,fixed.bounds,{signal});
 if(measurement.boundaryCrossingFacets||reference.boundaryCrossingFacets||!measurement.selectedBounds||!reference.selectedBounds)throw Error('The separated groups changed. Inspect the source again.');
 let choice;
 for(let axis=0;axis<3;axis++){
  const a=measurement.selectedBounds,b=reference.selectedBounds;
  const delta=a.min[axis]>b.max[axis]?b.max[axis]-a.min[axis]:a.max[axis]<b.min[axis]?b.min[axis]-a.max[axis]:0;
  if(delta&&(!choice||Math.abs(delta)>choice.gap))choice={axis,delta,gap:Math.abs(delta)};
 }
 if(!choice)throw Error('No positive axial separation was measured. Mounting correspondences are required.');
 const matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];matrix[12+choice.axis]=choice.delta;
 const translation=matrix.slice(12,15),plan={id:id(),importId,kind:'gap-closure-proposal',createdAt:new Date().toISOString(),sourceSha256:record.repairedSha256,units:record.units,bounds,matrix,translation,axis:['X','Y','Z'][choice.axis],gap:choice.gap,rmsError:null,maxError:null,sourcePoints:[],targetPoints:[],measurement,fixedRegion:reference.selectedBounds,intent:'Unconfirmed placement proposal: translate the selected group until its measured axial bounds touch the other group. No mounting-hole correspondence is inferred.',verificationScope:'Execution of the proposed axial gap closure. Mounting fit, physical intent and general collision suitability remain unassessed.'};
 plan.sha256=digest(plan);await save(path.join(repairDirectory(importId),'plans',plan.id+'.json'),plan);return plan;
}
export async function getRepairCandidate(importId,candidateId){const value=await json(path.join(repairDirectory(importId),'candidates',validId(candidateId)+'.json'),null);if(!value)throw Error('Repair candidate not found.');return value;}
export async function getRepairPlan(importId,planId){const plan=await json(path.join(repairDirectory(importId),'plans',validId(planId)+'.json'),null);if(!plan||plan.importId!==importId)throw Error('Repair plan not found.');const {sha256,...content}=plan;if(digest(content)!==sha256)throw Error('Saved repair plan changed.');return plan;}
export async function createRepairCandidate(importId,{planId,confirmPlacement},{signal}={}){
 if(confirmPlacement!==true)throw Error('Review the candidate placement and confirm it before exporting.');
 const {record,filename}=await source(importId),plan=await json(path.join(repairDirectory(importId),'plans',validId(planId)+'.json'),null);
 if(!plan||plan.importId!==importId||plan.sourceSha256!==record.repairedSha256)throw Error('The repair plan is missing or stale. Recalculate against this STL.');
 const {sha256,...content}=plan;if(digest(content)!==sha256)throw Error('The saved repair plan changed. Calculate a fresh alignment.');
 const disk=await fs.statfs(repairDirectory(importId));if(disk.bavail*disk.bsize<(await fs.stat(filename)).size+150*1024*1024)throw Error('Clear more disk space before exporting the full candidate STL.');
 const candidateId=id(),metadataFile=path.join(repairDirectory(importId),'candidates',candidateId+'.json');
 let candidate={id:candidateId,importId,planId:plan.id,planSha256:sha256,status:'building',verified:false,createdAt:new Date().toISOString()};await save(metadataFile,candidate);
 try{
  const job=await worker(importId,{operation:'candidate',source:filename,bounds:plan.bounds,matrix:plan.matrix,expectedSourceSha256:plan.sourceSha256},{signal});
  if(job.result.verification?.pass!==true)throw Error('Independent verification did not pass. No download was approved.');
  if(plan.kind==='gap-closure-proposal'){
   const axis=['X','Y','Z'].indexOf(plan.axis),a=job.result.verification.bounds.selectedAfter,b=job.result.verification.bounds.unselected;
   const remainingGap=Math.max(a.min[axis]-b.max[axis],b.min[axis]-a.max[axis]);
   if(Math.abs(remainingGap)>1e-4)throw Error('The exported mesh did not close the measured axial gap as proposed.');
   job.result.verification.gapClosure={axis:plan.axis,before:plan.gap,after:remainingGap,pass:true,scope:'Axial bounds touch; mounting alignment and physical fit unassessed.'};
  }
  candidate={...candidate,status:'verified',verified:true,completedAt:new Date().toISOString(),artifactDirectory:path.basename(job.directory),verification:job.result.verification,transformation:job.result.transformation,measurement:job.result.measurement,previewMetadata:job.result.previewMetadata,previewPositionsUrl:`/api/stl/imports/${importId}/repair-candidates/${candidateId}/preview.bin`,downloadUrl:`/api/stl/imports/${importId}/repair-candidates/${candidateId}/download`,scope:plan.verificationScope};
  await save(metadataFile,candidate);return candidate;
 }catch(error){candidate={...candidate,status:'failed',error:String(error.message).slice(0,1600)};await save(metadataFile,candidate);throw error;}
}
export async function candidateFile(importId,candidateId){const c=await getRepairCandidate(importId,candidateId);if(!c.verified||c.status!=='verified')throw Error('A verified repair export is not available.');return path.join(repairDirectory(importId),'jobs',validId(c.artifactDirectory),'candidate.stl');}

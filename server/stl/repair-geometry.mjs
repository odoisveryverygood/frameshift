/** Proper rigid alignment and independently checked, whole-facet binary STL region transforms. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Matrix, SingularValueDecomposition } from 'ml-matrix';
const MAX_BYTES=768*1024*1024,MAX_TRIANGLES=15_000_000,FACETS_PER_CHUNK=20_000;
const digest=()=>crypto.createHash('sha256');
const limits=Object.freeze({maxBytes:MAX_BYTES,maxTriangles:MAX_TRIANGLES,chunkBytes:FACETS_PER_CHUNK*50});
const selectionRule='A facet is selected only when all three original vertices are inside the inclusive source-coordinate AABB. A partial-vertex boundary crossing blocks export.';
const limitations=[
 'This verifies execution of an explicitly supplied rigid transform, not that the chosen pose repairs the robot.',
 'Landmarks, AABB and matrix use raw STL source coordinates and units, not centered or scaled viewer coordinates.',
 'AABB selection does not identify a complete CAD part; wholly outside facets intersecting the box geometrically are not classified as partial-vertex crossings.',
 'Collisions, self-intersections, clearances, mechanism behavior, structural integrity and manufacturing suitability are unassessed.',
];
function fail(message,report){const error=Error(message);error.code='STL_REGION_VERIFICATION_FAILED';if(report)error.report=report;throw error;}
function determinant(r){return r[0][0]*(r[1][1]*r[2][2]-r[1][2]*r[2][1])-r[0][1]*(r[1][0]*r[2][2]-r[1][2]*r[2][0])+r[0][2]*(r[1][0]*r[2][1]-r[1][1]*r[2][0]);}
function points(value,label){
 if(!Array.isArray(value)||value.length<3||value.length>32||value.some(p=>!Array.isArray(p)||p.length!==3||!p.every(Number.isFinite)))throw Error(`${label} needs 3–32 finite 3D landmark points.`);
 if(new Set(value.map(p=>JSON.stringify(p))).size!==value.length)throw Error(`${label} landmarks must be distinct.`);
 return value.map(p=>[...p]);
}
function normalizedLandmarks(list,label){
 const center=[0,1,2].map(axis=>list.reduce((sum,p)=>sum+p[axis]/list.length,0));
 const extent=Math.max(...[0,1,2].map(axis=>Math.max(...list.map(p=>p[axis]))-Math.min(...list.map(p=>p[axis]))));
 if(!Number.isFinite(extent)||extent<=0||!center.every(Number.isFinite))throw Error(`${label} landmarks have an invalid span.`);
 const rows=list.map(p=>p.map((v,axis)=>(v-center[axis])/extent));
 const svd=new SingularValueDecomposition(new Matrix(rows),{autoTranspose:true});
 if(!svd.diagonal.every(Number.isFinite)||svd.diagonal[1]<=svd.diagonal[0]*1e-8)throw Error(`${label} landmarks are collinear or ill-conditioned. Choose three noncollinear points.`);
 return {center,rows,singular:svd.diagonal};
}
export function solveRigidAlignment(sourcePoints,targetPoints,{maxResidual=.5}={}){
 const source=points(sourcePoints,'Source'),target=points(targetPoints,'Target');
 if(source.length!==target.length)throw Error('Source and target landmark counts must match.');
 if(!Number.isFinite(maxResidual)||maxResidual<0)throw Error('Maximum residual must be a nonnegative finite distance in source units.');
 const a=normalizedLandmarks(source,'Source'),b=normalizedLandmarks(target,'Target');
 const covariance=new Matrix(a.rows).transpose().mmul(new Matrix(b.rows));
 const svd=new SingularValueDecomposition(covariance,{autoTranspose:true}),u=svd.leftSingularVectors,v=svd.rightSingularVectors;
 let rotation=v.mmul(u.transpose()),det=determinant(rotation.to2DArray());
 if(det<0){
  if(a.singular[2]>a.singular[0]*1e-8&&b.singular[2]>b.singular[0]*1e-8)throw Error('Landmark correspondences require a reflection or are inconsistent; reflection is not permitted.');
  const correction=Matrix.eye(3);correction.set(2,2,-1);rotation=v.mmul(correction).mmul(u.transpose());
 }
 const r=rotation.to2DArray();det=determinant(r);
 const translation=b.center.map((value,row)=>value-r[row].reduce((sum,n,col)=>sum+n*a.center[col],0));
 const matrix=[r[0][0],r[1][0],r[2][0],0,r[0][1],r[1][1],r[2][1],0,r[0][2],r[1][2],r[2][2],0,...translation,1];
 validateMatrix(matrix);
 let sum=0,maxError=0;
 for(let i=0;i<source.length;i++){
  const errors=[0,1,2].map(row=>r[row].reduce((value,n,col)=>value+n*source[i][col],translation[row])-target[i][row]);
  const error=Math.hypot(...errors);if(!Number.isFinite(error))throw Error('Alignment overflowed; inspect landmark scale and units.');sum+=error*error;maxError=Math.max(maxError,error);
 }
 const rmsError=Math.sqrt(sum/source.length);
 if(maxError>Math.max(maxResidual,1e-9))throw Error(`Rigid alignment residual ${maxError} exceeds the allowed ${maxResidual} source units. No scale was fitted.`);
 return {matrix,rmsError,maxError,determinant:det,sourcePoints:source,targetPoints:target,maxResidual,scale:1,reflection:false,units:'raw STL source-coordinate units',poseCorrectness:'not-assessed'};
}
function validateMatrix(value){
 if(!Array.isArray(value)||value.length!==16||!value.every(Number.isFinite))throw Error('A finite 16-value column-major rigid matrix is required.');
 if(Math.abs(value[3])>1e-9||Math.abs(value[7])>1e-9||Math.abs(value[11])>1e-9||Math.abs(value[15]-1)>1e-9)throw Error('Perspective transforms are not permitted.');
 const r=[[value[0],value[4],value[8]],[value[1],value[5],value[9]],[value[2],value[6],value[10]]];
 for(let a=0;a<3;a++)for(let b=0;b<3;b++){
  const dot=r[0][a]*r[0][b]+r[1][a]*r[1][b]+r[2][a]*r[2][b];if(Math.abs(dot-(a===b?1:0))>1e-6)throw Error('Matrix contains scale or shear; only a rigid rotation and translation are permitted.');
 }
 const det=determinant(r);if(Math.abs(det-1)>1e-6)throw Error('Matrix contains a reflection; determinant must be +1.');
 return [...value];
}
function validateBounds(value){
 if(!value||!Array.isArray(value.min)||!Array.isArray(value.max)||value.min.length!==3||value.max.length!==3||!value.min.every(Number.isFinite)||!value.max.every(Number.isFinite)||value.min.some((n,i)=>n>value.max[i]))throw Error('Region bounds need finite ordered min/max vectors.');
 return {min:[...value.min],max:[...value.max]};
}
function emptyBounds(){return {min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};}
function extend(bounds,x,y,z){bounds.min[0]=Math.min(bounds.min[0],x);bounds.min[1]=Math.min(bounds.min[1],y);bounds.min[2]=Math.min(bounds.min[2],z);bounds.max[0]=Math.max(bounds.max[0],x);bounds.max[1]=Math.max(bounds.max[1],y);bounds.max[2]=Math.max(bounds.max[2],z);}
function finishedBounds(value){return value.min[0]===Infinity?null:{...value,size:value.max.map((n,i)=>n-value.min[i])};}
function inside(x,y,z,b){return x>=b.min[0]&&x<=b.max[0]&&y>=b.min[1]&&y<=b.max[1]&&z>=b.min[2]&&z<=b.max[2];}
async function readFully(file,buffer,length,position,signal){let offset=0;while(offset<length){signal?.throwIfAborted();const r=await file.read(buffer,offset,length-offset,position+offset);if(!r.bytesRead)throw Error('Binary STL became truncated during processing.');offset+=r.bytesRead;}}
async function writeFully(file,buffer,length,signal){let offset=0;while(offset<length){signal?.throwIfAborted();const r=await file.write(buffer,offset,length-offset,null);if(!r.bytesWritten)throw Error('Could not write the complete binary STL.');offset+=r.bytesWritten;}}
async function binaryInfo(file,signal){
 const stat=await file.stat({bigint:true});if(!stat.isFile()||stat.size<84n||stat.size>BigInt(MAX_BYTES))throw Error('Binary STL must be a regular file between 84 bytes and 768 MiB.');
 const header=Buffer.alloc(84);await readFully(file,header,84,0,signal);const count=header.readUInt32LE(80);
 if(!count||count>MAX_TRIANGLES)throw Error('Binary STL must contain 1–15,000,000 facets.');
 if(Number(stat.size)!==84+count*50)throw Error('Binary STL length does not match its declared facet count.');
 return {stat,header,count};
}
async function unchanged(file,info,filePath){const current=await file.stat({bigint:true}),name=await fs.stat(filePath,{bigint:true});if(info.stat.size!==current.size||info.stat.mtimeNs!==current.mtimeNs||info.stat.ino!==name.ino||info.stat.size!==name.size||info.stat.mtimeNs!==name.mtimeNs)throw Error('STL changed during processing; verification must be repeated.');}
function requireFinite(buffer,at){for(let i=0;i<12;i++)if(!Number.isFinite(buffer.readFloatLE(at+i*4)))throw Error('STL has non-finite coordinates or normals. Normalize it before applying a region transform.');}
function selection(buffer,at,bounds){let n=0;for(let i=0;i<3;i++){const p=at+12+i*12;if(inside(buffer.readFloatLE(p),buffer.readFloatLE(p+4),buffer.readFloatLE(p+8),bounds))n++;}return n;}
function selectionGate(selected,unselected,crossing){
 const report={selectedTriangles:selected,unselectedTriangles:unselected,boundaryCrossingFacets:crossing,selectionRule};
 if(crossing)fail(`${crossing} facets cross the region boundary. Expand or adjust the region to avoid cutting connected geometry before export.`,report);
 if(!selected)fail('The region selects no whole facets. Choose a nonempty region.',report);
 if(!unselected)fail('The region selects the entire model. A regional repair must leave some facets unchanged.',report);
}
function hashes(){return {source:digest(),output:digest(),selectedSource:digest(),selectedOutput:digest(),unselectedSource:digest(),unselectedOutput:digest()};}
function finishHashes(h){return {inputSha256:h.source.digest('hex'),outputSha256:h.output.digest('hex'),selectedInputSha256:h.selectedSource.digest('hex'),selectedOutputSha256:h.selectedOutput.digest('hex'),unselectedInputSha256:h.unselectedSource.digest('hex'),unselectedOutputSha256:h.unselectedOutput.digest('hex')};}
export async function transformBinaryRegion(inputPath,{outputPath,bounds,matrix,signal}={}){
 const box=validateBounds(bounds),m=validateMatrix(matrix);signal?.throwIfAborted();
 if(typeof inputPath!=='string'||!inputPath||typeof outputPath!=='string'||!outputPath)throw Error('Input and output paths are required.');
 const sourcePath=path.resolve(inputPath),targetPath=path.resolve(outputPath);if(sourcePath===targetPath)throw Error('Region output must not overwrite the original.');
 const input=await fs.open(sourcePath,'r');let output=null,temp=null;
 try{
  const info=await binaryInfo(input,signal);
  if(await fs.lstat(targetPath).catch(e=>{if(e.code==='ENOENT')return null;throw e;}))throw Error('Region output already exists and was not overwritten.');
  await fs.mkdir(path.dirname(targetPath),{recursive:true});temp=path.join(path.dirname(targetPath),`.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`);output=await fs.open(temp,'wx',0o600);
  await writeFully(output,info.header,84,signal);const h=hashes();h.source.update(info.header);h.output.update(info.header);
  const chunk=Buffer.allocUnsafe(FACETS_PER_CHUNK*50),before=emptyBounds(),after=emptyBounds(),outside=emptyBounds(),wholeBefore=emptyBounds(),wholeAfter=emptyBounds();
  let selectedTriangles=0,unselectedTriangles=0,boundaryCrossingFacets=0;
  for(let first=0;first<info.count;first+=FACETS_PER_CHUNK){
   const count=Math.min(FACETS_PER_CHUNK,info.count-first),bytes=count*50;await readFully(input,chunk,bytes,84+first*50,signal);h.source.update(chunk.subarray(0,bytes));
   for(let face=0;face<count;face++){
    const at=face*50;requireFinite(chunk,at);const included=selection(chunk,at,box),selected=included===3;if(included>0&&included<3)boundaryCrossingFacets++;
    const original=chunk.subarray(at,at+50);if(selected){selectedTriangles++;h.selectedSource.update(original);}else{unselectedTriangles++;h.unselectedSource.update(original);}
    for(let vertex=0;vertex<3;vertex++){
     const p=at+12+vertex*12,x=chunk.readFloatLE(p),y=chunk.readFloatLE(p+4),z=chunk.readFloatLE(p+8);extend(wholeBefore,x,y,z);
     if(selected){
      extend(before,x,y,z);const tx=m[0]*x+m[4]*y+m[8]*z+m[12],ty=m[1]*x+m[5]*y+m[9]*z+m[13],tz=m[2]*x+m[6]*y+m[10]*z+m[14];
      if(![tx,ty,tz].every(v=>Number.isFinite(Math.fround(v))))throw Error('Rigid transform exceeds STL float32 coordinate range.');
      chunk.writeFloatLE(tx,p);chunk.writeFloatLE(ty,p+4);chunk.writeFloatLE(tz,p+8);extend(after,Math.fround(tx),Math.fround(ty),Math.fround(tz));extend(wholeAfter,Math.fround(tx),Math.fround(ty),Math.fround(tz));
     }else{extend(outside,x,y,z);extend(wholeAfter,x,y,z);}
    }
    if(selected){const x=chunk.readFloatLE(at),y=chunk.readFloatLE(at+4),z=chunk.readFloatLE(at+8);chunk.writeFloatLE(m[0]*x+m[4]*y+m[8]*z,at);chunk.writeFloatLE(m[1]*x+m[5]*y+m[9]*z,at+4);chunk.writeFloatLE(m[2]*x+m[6]*y+m[10]*z,at+8);requireFinite(chunk,at);h.selectedOutput.update(chunk.subarray(at,at+50));}
    else h.unselectedOutput.update(chunk.subarray(at,at+50));
   }
   h.output.update(chunk.subarray(0,bytes));await writeFully(output,chunk,bytes,signal);
  }
  selectionGate(selectedTriangles,unselectedTriangles,boundaryCrossingFacets);await unchanged(input,info,sourcePath);await output.sync();await output.close();output=null;signal?.throwIfAborted();
  const report={version:1,status:'transformed-pending-verification',triangleCount:info.count,inputTriangles:info.count,outputTriangles:info.count,selectedTriangles,unselectedTriangles,boundaryCrossingFacets,selectionBounds:box,matrix:m,determinant:determinant([[m[0],m[4],m[8]],[m[1],m[5],m[9]],[m[2],m[6],m[10]]]),selectionRule,...finishHashes(h),bounds:{selectedBefore:finishedBounds(before),selectedAfter:finishedBounds(after),unselected:finishedBounds(outside),wholeBefore:finishedBounds(wholeBefore),wholeAfter:finishedBounds(wholeAfter)},headerPreserved:true,attributesPreserved:true,collisionAssessment:'not-assessed',poseCorrectness:'not-assessed',verification:{pass:false,status:'pending-independent-pass'},limits,limitations};
  await fs.link(temp,targetPath);await fs.unlink(temp);temp=null;return report;
 }finally{await output?.close().catch(()=>{});await input.close();if(temp)await fs.unlink(temp).catch(()=>{});}
}
export async function verifyBinaryRegion(originalPath,candidatePath,{bounds,matrix,expected,signal}={}){
 const box=validateBounds(bounds),m=validateMatrix(matrix);signal?.throwIfAborted();
 if(typeof originalPath!=='string'||typeof candidatePath!=='string'||path.resolve(originalPath)===path.resolve(candidatePath))throw Error('Verification requires distinct source and candidate STL paths.');
 const original=await fs.open(originalPath,'r');let candidate;
 try{
  candidate=await fs.open(candidatePath,'r');const source=await binaryInfo(original,signal),target=await binaryInfo(candidate,signal);
  if(source.count!==target.count||!source.header.equals(target.header))fail('Candidate facet count or header differs from the original.');
  const a=Buffer.allocUnsafe(FACETS_PER_CHUNK*50),b=Buffer.allocUnsafe(FACETS_PER_CHUNK*50),h=hashes();h.source.update(source.header);h.output.update(target.header);
  let selectedTriangles=0,unselectedTriangles=0,boundaryCrossingFacets=0,maxPositionError=0,maxNormalError=0;
  const before=emptyBounds(),after=emptyBounds(),outside=emptyBounds(),wholeBefore=emptyBounds(),wholeAfter=emptyBounds();
  for(let first=0;first<source.count;first+=FACETS_PER_CHUNK){
   const count=Math.min(FACETS_PER_CHUNK,source.count-first),bytes=count*50;await readFully(original,a,bytes,84+first*50,signal);await readFully(candidate,b,bytes,84+first*50,signal);h.source.update(a.subarray(0,bytes));h.output.update(b.subarray(0,bytes));
   for(let face=0;face<count;face++){
    const at=face*50;requireFinite(a,at);requireFinite(b,at);const included=selection(a,at,box),selected=included===3;if(included>0&&included<3)boundaryCrossingFacets++;
    if(selected){selectedTriangles++;h.selectedSource.update(a.subarray(at,at+50));h.selectedOutput.update(b.subarray(at,at+50));if(a.readUInt16LE(at+48)!==b.readUInt16LE(at+48))fail('Selected facet attribute bytes changed.');}
    else{unselectedTriangles++;h.unselectedSource.update(a.subarray(at,at+50));h.unselectedOutput.update(b.subarray(at,at+50));if(!a.subarray(at,at+50).equals(b.subarray(at,at+50)))fail('A facet outside the selected region changed.');}
    for(let vertex=0;vertex<3;vertex++){
     const p=at+12+vertex*12,point=[a.readFloatLE(p),a.readFloatLE(p+4),a.readFloatLE(p+8)],actual=[b.readFloatLE(p),b.readFloatLE(p+4),b.readFloatLE(p+8)];extend(wholeBefore,...point);extend(wholeAfter,...actual);
     if(selected){extend(before,...point);extend(after,...actual);for(let row=0;row<3;row++){
       let value=0;for(let col=0;col<3;col++)value+=m[col*4+row]*point[col];value+=m[12+row];
       const error=Math.abs(actual[row]-Math.fround(value)),tolerance=1e-6;maxPositionError=Math.max(maxPositionError,error);if(!Number.isFinite(error)||error>tolerance)fail('Selected facet position does not match the supplied rigid transform.');
      }}else extend(outside,...point);
    }
    if(selected){const normal=[a.readFloatLE(at),a.readFloatLE(at+4),a.readFloatLE(at+8)];for(let row=0;row<3;row++){
      let value=0;for(let col=0;col<3;col++)value+=m[col*4+row]*normal[col];const error=Math.abs(b.readFloatLE(at+row*4)-Math.fround(value));maxNormalError=Math.max(maxNormalError,error);if(!Number.isFinite(error)||error>1e-6)fail('Selected facet normal does not match the supplied rigid rotation.');
    }}
   }
  }
  selectionGate(selectedTriangles,unselectedTriangles,boundaryCrossingFacets);await unchanged(original,source,originalPath);await unchanged(candidate,target,candidatePath);
  const results=finishHashes(h),checks={sameFacetCount:true,headerUnchanged:true,unselectedBytesUnchanged:true,selectedPositionsMatch:true,selectedNormalsMatch:true,attributesUnchanged:true,finite:true,selectionNonempty:true,selectionNotWholeModel:true,boundaryDoesNotCutFacets:true};
  const result={version:1,pass:true,passed:true,status:'verified-transform-execution',triangleCount:source.count,inputTriangles:source.count,outputTriangles:target.count,selectedTriangles,unselectedTriangles,boundaryCrossingFacets,...results,bounds:{selectedBefore:finishedBounds(before),selectedAfter:finishedBounds(after),unselected:finishedBounds(outside),wholeBefore:finishedBounds(wholeBefore),wholeAfter:finishedBounds(wholeAfter)},selectionBounds:box,matrix:m,selectionRule,maxPositionError,maxNormalError,tolerances:{positions:'1e-6 source units around float32-quantized expected coordinates',normals:'1e-6 around float32-quantized expected rotated normals'},checks,verification:{pass:true,checks,scope:'Transform execution fidelity only; intended pose and collision suitability unassessed.'},collisionAssessment:'not-assessed',poseCorrectness:'not-assessed',limits,limitations};
  if(expected!=null){
   if(typeof expected!=='object')throw Error('Expected verification metadata must be an object.');
   for(const key of ['selectedTriangles','unselectedTriangles','boundaryCrossingFacets','inputSha256','outputSha256','selectedInputSha256','selectedOutputSha256','unselectedInputSha256','unselectedOutputSha256'])if(expected[key]!=null&&expected[key]!==result[key])fail(`Independent region verification does not match expected ${key}.`);
  }
  return result;
 }finally{await candidate?.close().catch(()=>{});await original.close();}
}

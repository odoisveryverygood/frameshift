/** STL imports preserve original bytes and require explicit use of the repair. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {createWriteStream,constants} from 'node:fs';
import {ROOT,DATA,id,json,save,dependencies,command} from '../core.mjs';
import {writeStlViewer} from './viewer-template.mjs';
const exec=promisify(execFile);
export const STL=path.join(DATA,'stl-imports');
export function stlImportDirectory(value){if(!/^[a-zA-Z0-9-]{1,80}$/.test(value||''))throw Error('Invalid STL import identity');return path.join(STL,value);}
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
export async function getStlImport(importId){const record=await json(path.join(stlImportDirectory(importId),'import.json'),null);if(!record)throw Error('STL import not found');return record;}
export async function createStlImport(bytes,{filename,units,signal}={}){
 if(!Buffer.isBuffer(bytes)||bytes.length<15||bytes.length>40*1024*1024)throw Error('Choose a nonempty STL smaller than 40 MB.');
 if(typeof filename!=='string'||filename.length>250||!filename.toLowerCase().endsWith('.stl')||/[\x00-\x1f]/.test(filename))throw Error('Choose an .stl file.');
 if(!['mm','cm','m','in'].includes(units))throw Error('Select the measurement units used when exporting this STL.');
 const importId=id(),directory=stlImportDirectory(importId);
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 await fs.writeFile(path.join(directory,'original.stl'),bytes,{mode:0o600});
 let record={id:importId,filename:path.basename(filename),units,status:'processing',createdAt:new Date().toISOString(),inputSha256:digest(bytes),inputBytes:bytes.length,originalDownloadUrl:`/api/stl/imports/${importId}/original.stl`};
 await save(path.join(directory,'import.json'),record);
 try {
  try {await exec(process.execPath,['--max-old-space-size=512',path.join(ROOT,'server/stl/process.mjs'),directory,units],{cwd:ROOT,env:{PATH:process.env.PATH||'',LANG:'en_US.UTF-8'},timeout:90000,maxBuffer:8192,signal});}
  catch(error){const detail=await json(path.join(directory,'error.json'),null);throw Error(detail?.error||'STL inspection exceeded its memory/time limit or stopped. Export a smaller binary STL and retry.');}
  const report=await json(path.join(directory,'report.json'));
  const floats=async name=>{const bytes=await fs.readFile(path.join(directory,name));return new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));};
  const integers=async name=>{const bytes=await fs.readFile(path.join(directory,name));return new Uint32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));};
  const workspace=path.join(directory,'viewer');
  await writeStlViewer(workspace,{positions:await floats('positions.bin'),componentIds:await integers('component-ids.bin'),originalPositions:await floats('source-positions.bin'),originalComponentIds:await integers('source-component-ids.bin'),units,name:record.filename,sourceHash:record.inputSha256,report});
  await dependencies(workspace,ROOT);
  await command([process.execPath,path.join(ROOT,'node_modules/vite/bin/vite.js'),'build','--base=./'],workspace,{isolate:true,signal,timeout:120000});
  record={...record,status:'review',report,repairedSha256:digest(await fs.readFile(path.join(directory,'repaired.stl'))),repairedDownloadUrl:`/api/stl/imports/${importId}/repaired.stl`,reportUrl:`/api/stl/imports/${importId}`,previewUrl:`/stl-preview/${importId}/index.html`};
  await save(path.join(directory,'import.json'),record);return record;
 } catch(error){record={...record,status:'failed',error:String(error.message).slice(0,1600)};await save(path.join(directory,'import.json'),record);throw Error(record.error);}
}
export async function markStlConnected(importId,projectId){const record=await getStlImport(importId);record.projectId=projectId;record.connectedAt=new Date().toISOString();await save(path.join(stlImportDirectory(importId),'import.json'),record);return record;}

export const MAX_STL_UPLOAD_BYTES=768*1024*1024;
function validateImportOptions(filename,units){
 if(typeof filename!=='string'||filename.length>250||!filename.toLowerCase().endsWith('.stl')||/[\x00-\x1f]/.test(filename))throw Error('Choose an .stl file.');
 if(!['mm','cm','m','in'].includes(units))throw Error('Select the STL export units.');
}
/** Request bodies go to disk; large meshes never become an Express raw Buffer. */
export async function receiveStlImport(request,{filename,units,signal}={}){
 validateImportOptions(filename,units);
 const length=Number(request.headers['content-length']||0);
 if(length>MAX_STL_UPLOAD_BYTES)throw Error('STL exceeds the 768 MiB upload limit.');
 await fs.mkdir(STL,{recursive:true});
 const disk=await fs.statfs(STL);
 if(disk.bavail*disk.bsize<(length||MAX_STL_UPLOAD_BYTES)*2+256*1024*1024)throw Error('Not enough disk space to retain the original and repaired STL. Clear more space and retry.');
 const temporary=path.join(STL,`upload-${id()}.part`);let size=0;
 const bound=new Transform({transform(chunk,encoding,callback){size+=chunk.length;callback(size>MAX_STL_UPLOAD_BYTES?Error('STL exceeds the 768 MiB upload limit.'):null,chunk);}});
 try{
  await pipeline(request,bound,createWriteStream(temporary,{flags:'wx',mode:0o600}),{signal});
  if(size<15)throw Error('Choose a nonempty STL.');
  return await createStlImportFromFile(temporary,{filename,units,signal});
 }finally{await fs.rm(temporary,{force:true});}
}
export async function createStlImportFromFile(source,{filename,units,signal}={}){
 validateImportOptions(filename,units);
 const size=(await fs.stat(source)).size;
 if(size<=40*1024*1024)return createStlImport(await fs.readFile(source),{filename,units,signal});
 if(size>MAX_STL_UPLOAD_BYTES)throw Error('STL exceeds the 768 MiB upload limit.');
 const importId=id(),directory=stlImportDirectory(importId);
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 // APFS can clone these bytes without a second physical copy. The received original is retained.
 await fs.copyFile(source,path.join(directory,'original.stl'),constants.COPYFILE_FICLONE);
 await fs.chmod(path.join(directory,'original.stl'),0o600);
 let record={id:importId,filename:path.basename(filename),units,status:'processing',createdAt:new Date().toISOString(),inputBytes:size,originalDownloadUrl:`/api/stl/imports/${importId}/original.stl`};
 await save(path.join(directory,'import.json'),record);
 try{
  try{await exec(process.execPath,['--max-old-space-size=256',path.join(ROOT,'server/stl/large-process.mjs'),directory,units],{cwd:ROOT,env:{PATH:process.env.PATH||'',LANG:'en_US.UTF-8'},timeout:180000,maxBuffer:8192,signal});}
  catch(error){const detail=await json(path.join(directory,'error.json'),null);throw Error(detail?.error||'The full mesh inspection stopped or exceeded its time limit. The original is preserved.');}
  const report=await json(path.join(directory,'report.json'));
  const bytes=await fs.readFile(path.join(directory,'positions.bin'));
  const positions=new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const workspace=path.join(directory,'viewer');
  await writeStlViewer(workspace,{positions,componentIds:new Uint32Array(positions.length/9),units,name:record.filename,sourceHash:report.inputSha256,report});
  await dependencies(workspace,ROOT);
  await command([process.execPath,path.join(ROOT,'node_modules/vite/bin/vite.js'),'build','--base=./'],workspace,{isolate:true,signal,timeout:120000});
  record={...record,status:'review',report,inputSha256:report.inputSha256,repairedSha256:report.repairedSha256,repairedDownloadUrl:`/api/stl/imports/${importId}/repaired.stl`,reportUrl:`/api/stl/imports/${importId}`,previewUrl:`/stl-preview/${importId}/index.html`};
  await save(path.join(directory,'import.json'),record);return record;
 }catch(error){record={...record,status:'failed',error:String(error.message).slice(0,1600)};await save(path.join(directory,'import.json'),record);throw Error(record.error);}
}

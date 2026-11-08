/** Bounded ZIP ingestion: extraction and static discovery only; no dependency installation or build. */
import fs from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {crc32} from 'node:zlib';
import yauzl from 'yauzl';
import {discoverProject} from './discovery.mjs';
export const ZIP_LIMITS=Object.freeze({compressedBytes:20*1024*1024,uncompressedBytes:60*1024*1024,fileBytes:10*1024*1024,entries:2000,pathBytes:512,pathDepth:15,retainedUploads:20,retainedBytes:512*1024*1024});
const skippedDirectories=new Set(['node_modules','.git','.frameshift','dist','build','.next','.nuxt','.cache','.turbo','coverage','__macosx']);
const privateFile=/^(?:\.env.*|\.npmrc|\.yarnrc.*|\.netrc|\.pypirc|\.ds_store|\.git.*|credentials?[^/]*|secrets?[^/]*|service[-_]account[^/]*|id_(?:rsa|dsa|ecdsa|ed25519).*)$|\.(?:pem|key|p12|pfx|keystore)$/i;
function uploadError(message,status=400){return Object.assign(Error(message),{status,code:'PROJECT_ZIP_REJECTED'});}
export function validateZipEntry(entry,limits=ZIP_LIMITS){
 const name=entry.fileName;
 if(typeof name!=='string'||!name||Buffer.byteLength(name)>limits.pathBytes||/[\\\x00-\x1f\x7f:]/.test(name)||name.startsWith('/'))throw uploadError('ZIP contains an unsafe or overlong path.');
 const parts=name.replace(/\/$/,'').split('/');
 if(parts.length>limits.pathDepth||parts.some(p=>!p||p==='.'||p==='..'))throw uploadError('ZIP contains traversal or excessively nested paths.');
 const mode=(entry.externalFileAttributes>>>16)&0xf000;
 if(mode&&mode!==0x8000&&mode!==0x4000)throw uploadError('ZIP symlinks and special filesystem entries are not allowed.');
 const directory=name.endsWith('/');
 if((mode===0x4000||entry.externalFileAttributes&0x10)&&!directory)throw uploadError('ZIP directory metadata does not match its path.');
 if(entry.generalPurposeBitFlag&1)throw uploadError('Encrypted ZIP entries are not supported.');
 if(![0,8].includes(entry.compressionMethod))throw uploadError('ZIP uses an unsupported compression method. Use a standard ZIP archive.');
 if(!Number.isSafeInteger(entry.uncompressedSize)||entry.uncompressedSize<0||!Number.isSafeInteger(entry.compressedSize)||entry.compressedSize<0||entry.uncompressedSize>limits.fileBytes)throw uploadError('A ZIP entry exceeds the 10 MiB file limit.');
 if(directory&&entry.uncompressedSize!==0)throw uploadError('ZIP directory entries cannot contain file data.');
 const ignored=parts.some(part=>skippedDirectories.has(part.toLowerCase())||privateFile.test(part));
 return{name,parts,directory,ignored,collisionKey:parts.join('/').normalize('NFC').toLowerCase()};
}
async function available(directory,needed){
 const stat=await fs.statfs(directory);if(Number(stat.bavail)*Number(stat.bsize)<needed+32*1024*1024)throw uploadError('Not enough server disk space for this upload. Clear space or upload a smaller project.',507);
}
async function quotas(root){
 const names=await fs.readdir(root);let retained=0,bytes=0;
 for(const name of names){if(!/^[a-f0-9-]{36}$/.test(name))continue;retained++;try{const record=JSON.parse(await fs.readFile(path.join(root,name,'record.json'),'utf8'));bytes+=record.extractedBytes||0;}catch{}}
 if(retained>=ZIP_LIMITS.retainedUploads||bytes>=ZIP_LIMITS.retainedBytes)throw uploadError('The server upload quota is full. Ask the operator to remove old uploads.',507);
 return bytes;
}
function openZip(file){return new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true,autoClose:false,strictFileNames:true,validateEntrySizes:true},(error,zip)=>error?reject(error):resolve(zip)));}
function streamEntry(zip,entry){return new Promise((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>error?reject(error):resolve(stream)));}
async function inspectEntries(zip,signal){
 if(zip.entryCount>ZIP_LIMITS.entries)throw uploadError('ZIP contains too many entries (maximum 2,000).');
 return new Promise((resolve,reject)=>{
  const entries=[],names=new Set();let expanded=0,skipped=0;
  const abort=()=>done(signal.reason||Error('Upload cancelled'));
  function done(error){zip.off('entry',onEntry);zip.off('end',onEnd);zip.off('error',onError);signal?.removeEventListener('abort',abort);error?reject(error):resolve({entries,expanded,skipped});}
  const onError=error=>done(error),onEnd=()=>done();
  function onEntry(entry){try{
   signal?.throwIfAborted();if(entries.length+skipped>=ZIP_LIMITS.entries)throw uploadError('ZIP contains too many entries.');
   const safe=validateZipEntry(entry);if(names.has(safe.collisionKey))throw uploadError('ZIP contains duplicate or case-conflicting paths.');names.add(safe.collisionKey);
   expanded+=entry.uncompressedSize;if(expanded>ZIP_LIMITS.uncompressedBytes)throw uploadError('ZIP expands beyond the 60 MiB limit.');
   if(safe.ignored)skipped++;else entries.push({entry,...safe});zip.readEntry();
  }catch(error){done(error);}}
  zip.on('entry',onEntry);zip.once('end',onEnd);zip.once('error',onError);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)return abort();zip.readEntry();
 });
}
let uploadBusy=false;
export async function receiveProjectZip(stream,{dataDirectory,filename='project.zip',signal,contentLength,discover=discoverProject}={}){
 if(uploadBusy)throw uploadError('Another project upload is being inspected. Try again shortly.',409);
 if(!dataDirectory)throw Error('Upload storage directory is required.');
 if(contentLength!=null&&(!Number.isSafeInteger(contentLength)||contentLength<0||contentLength>ZIP_LIMITS.compressedBytes))throw uploadError('Project ZIP exceeds the 20 MiB upload limit.',413);
 signal?.throwIfAborted();uploadBusy=true;
 const root=path.resolve(dataDirectory,'uploads'),uploadId=crypto.randomUUID(),directory=path.join(root,uploadId),archive=path.join(directory,'upload.zip'),destination=path.join(directory,'project');
 let zip;
 try{
  await fs.mkdir(root,{recursive:true,mode:0o700});const retainedBytes=await quotas(root);await available(root,contentLength||ZIP_LIMITS.compressedBytes);await fs.mkdir(directory,{mode:0o700});
  let compressed=0;const hash=crypto.createHash('sha256');
  const bound=new Transform({transform(chunk,encoding,callback){compressed+=chunk.length;if(compressed>ZIP_LIMITS.compressedBytes)return callback(uploadError('Project ZIP exceeds the 20 MiB upload limit.',413));hash.update(chunk);callback(null,chunk);}});
  await pipeline(stream,bound,createWriteStream(archive,{flags:'wx',mode:0o600}),{signal});
  if(!compressed||contentLength!=null&&compressed!==contentLength)throw uploadError('ZIP upload was empty or incomplete.');
  zip=await openZip(archive);const metadata=await inspectEntries(zip,signal);
  if(retainedBytes+metadata.expanded>ZIP_LIMITS.retainedBytes)throw uploadError('The server upload storage quota would be exceeded.',507);
  await available(directory,metadata.expanded);
  const manifests=metadata.entries.filter(e=>!e.directory&&e.parts.at(-1)==='package.json');
  if(manifests.length!==1)throw uploadError('Upload one project with exactly one package.json (dependencies and generated folders are ignored). Split monorepos into a single application ZIP.');
  await fs.mkdir(destination,{mode:0o700});let extractedBytes=0,extractedFiles=0;
  for(const item of metadata.entries){
   signal?.throwIfAborted();const target=path.join(destination,...item.parts);
   if(!target.startsWith(destination+path.sep))throw uploadError('ZIP path escapes upload storage.');
   if(item.directory){await fs.mkdir(target,{recursive:true,mode:0o700});continue;}
   await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});let size=0,checksum=0;
   const boundFile=new Transform({transform(chunk,encoding,callback){size+=chunk.length;extractedBytes+=chunk.length;if(size>ZIP_LIMITS.fileBytes||size>item.entry.uncompressedSize||extractedBytes>ZIP_LIMITS.uncompressedBytes)return callback(uploadError('ZIP data exceeds its declared or permitted expanded size.'));checksum=crc32(chunk,checksum);callback(null,chunk);}});
   const source=await streamEntry(zip,item.entry);await pipeline(source,boundFile,createWriteStream(target,{flags:'wx',mode:0o600}),{signal});
   if(size!==item.entry.uncompressedSize||checksum!==item.entry.crc32)throw uploadError('ZIP contains a damaged file (size or CRC mismatch).');extractedFiles++;
  }
  zip.close();zip=null;await fs.unlink(archive);
  const projectPath=await fs.realpath(path.join(destination,...manifests[0].parts.slice(0,-1))),inspection=await discover(projectPath);
  const warnings=[`Excluded ${metadata.skipped} dependency, generated or credential entries.`, 'Inspection only: no uploaded scripts, dependency installation or application build has run. Explicit trust is required before connection.'];
  const record={uploadId,path:projectPath,filename:String(filename).slice(0,180),sha256:hash.digest('hex'),compressedBytes:compressed,extractedBytes,extractedFiles,createdAt:new Date().toISOString(),requiresTrust:true,warnings,limits:ZIP_LIMITS,inspection};
  await fs.writeFile(path.join(directory,'record.json'),JSON.stringify(record),{flag:'wx',mode:0o600});return record;
 }catch(error){await fs.rm(directory,{recursive:true,force:true});throw error;}finally{zip?.close();uploadBusy=false;}
}
export async function assertManagedUploadPath(input,dataDirectory){
 if(typeof input!=='string')throw uploadError('Hosted projects must be selected from an inspected project ZIP.');
 const real=await fs.realpath(input),root=await fs.realpath(path.join(dataDirectory,'uploads'));const relative=path.relative(root,real),parts=relative.split(path.sep);
 if(relative.startsWith('..')||path.isAbsolute(relative)||!/^[a-f0-9-]{36}$/.test(parts[0]))throw uploadError('Hosted projects must come from the managed ZIP upload storage.');
 const record=JSON.parse(await fs.readFile(path.join(root,parts[0],'record.json'),'utf8'));
 if(record.path!==real||record.requiresTrust!==true)throw uploadError('This project path is not an inspected upload.');return real;
}

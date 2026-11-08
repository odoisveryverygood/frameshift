import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {crc32,deflateRawSync} from 'node:zlib';
import {receiveProjectZip,assertManagedUploadPath,ZIP_LIMITS,validateZipEntry} from '../server/project-upload.mjs';
function zip(entries){
 const locals=[],central=[];let offset=0;
 for(const item of entries){const name=Buffer.from(item.name),data=Buffer.from(item.data||''),compressed=item.method===8?deflateRawSync(data):data,crc=item.crc??crc32(data),method=item.method??0,local=Buffer.alloc(30),directory=Buffer.alloc(46);
 local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(item.flags||0,6);local.writeUInt16LE(method,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(item.size??data.length,22);local.writeUInt16LE(name.length,26);
 directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(0x0314,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(item.flags||0,8);directory.writeUInt16LE(method,10);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(item.size??data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(item.attributes??(0x81a4*65536)>>>0,38);directory.writeUInt32LE(offset,42);
 locals.push(local,name,compressed);central.push(directory,name);offset+=local.length+name.length+compressed.length;
 }
 const c=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(c.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,c,end]);
}
function project(prefix='robot/'){return[
 {name:prefix+'package.json',data:JSON.stringify({name:'robot',scripts:{build:'vite build',postinstall:'node should-never-run.js'},dependencies:{three:'0.181.0'},devDependencies:{vite:'7.2.0'}})},
 {name:prefix+'index.html',data:'<script type="module" src="/src/main.js"></script>'},
 {name:prefix+'src/main.js',data:"import * as THREE from 'three'; console.log(THREE.REVISION);"},
 {name:prefix+'should-never-run.js',data:"require('fs').writeFileSync('executed','bad')"},
 ];}
async function directory(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sift-zip-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
async function rejectsClean(t,entries,pattern){const dir=await directory(t);await assert.rejects(receiveProjectZip(Readable.from([zip(entries)]),{dataDirectory:dir}),pattern);assert.deepEqual(await fs.readdir(path.join(dir,'uploads')),[]);}
test('ZIP extraction inspects a real Vite project, excludes secrets/dependencies and never executes scripts',async t=>{
 const dir=await directory(t),entries=[...project(),...['node_modules/dependency/package.json','.git/config','dist/main.js','.env.local','nested/secrets.json','nested/key.pem','.npmrc'].map(name=>({name:'robot/'+name,data:'private'}))];
 const archive=zip(entries.map((entry,i)=>({...entry,method:i===2?8:0}))),result=await receiveProjectZip(Readable.from([archive]),{dataDirectory:dir,filename:'robot.zip',contentLength:archive.length});
 assert.equal(result.requiresTrust,true);assert.equal(result.inspection.supported,true);assert.equal(result.inspection.framework,'Vite + Three.js');assert.equal(result.extractedFiles,4);assert.equal(result.compressedBytes,archive.length);assert.match(result.warnings.join(' '),/Excluded 7/);assert.equal(await fs.readFile(path.join(result.path,'src/main.js'),'utf8'),entries[2].data);assert.equal(await assertManagedUploadPath(result.path,dir),result.path);
 for(const name of ['executed','node_modules','.env.local','.git','dist','.npmrc','nested/secrets.json'])await assert.rejects(fs.stat(path.join(result.path,name)),{code:'ENOENT'});
 await assert.rejects(assertManagedUploadPath(dir,dir),/managed ZIP/);await assert.rejects(fs.stat(path.join(dir,'uploads',result.uploadId,'upload.zip')),{code:'ENOENT'});
});
test('traversal, absolute/backslash/drive/control paths, symlinks and special nodes never escape storage',async t=>{
 for(const name of ['../outside','/absolute','C:/windows','folder\\escape','folder/../escape','a\u0000b','a//b','./file'])await rejectsClean(t,[...project(),{name,data:'bad'}],/path|relative|absolute|backslash|invalid/i);
 for(const mode of [0xa1ff,0x11ff,0x21ff])await rejectsClean(t,[...project(),{name:'robot/link',data:'../../elsewhere',attributes:(mode*65536)>>>0}],/symlinks|special/);
});
test('ambiguous project roots, duplicate/case-conflicting names and encrypted entries are rejected',async t=>{
 await rejectsClean(t,[...project('a/'),...project('b/')],/exactly one package/);await rejectsClean(t,[{name:'readme.txt',data:'none'}],/exactly one package/);
 for(const name of ['robot/package.json','ROBOT/PACKAGE.JSON'])await rejectsClean(t,[...project(),{name,data:'{}'}],/duplicate|conflicting/);
 await rejectsClean(t,[...project(),{name:'robot/encrypted',data:'x',flags:1,method:8}],/Encrypted/);
});
test('full metadata file-count/expanded-size caps are checked before decompression',async t=>{
 await rejectsClean(t,Array.from({length:ZIP_LIMITS.entries+1},(_,i)=>({name:`file-${i}`,data:''})),/too many entries/);
 await rejectsClean(t,[...project(),...Array.from({length:7},(_,i)=>({name:`robot/bomb-${i}`,data:'x',method:8,size:10*1024*1024}))],/60 MiB/);
 await rejectsClean(t,[...project(),{name:'robot/big',data:'x',method:8,size:ZIP_LIMITS.fileBytes+1}],/file limit/);
});
test('damaged/truncated ZIPs, CRC mismatches and forged decompressed sizes fail with cleanup',async t=>{
 await rejectsClean(t,[...project(),{name:'robot/damaged',data:'actual',crc:123}],/CRC/);
 await rejectsClean(t,[...project(),{name:'robot/size',data:'actual contents',method:8,size:1}],/uncompressed size|size|too many bytes/i);
 const dir=await directory(t);await assert.rejects(receiveProjectZip(Readable.from([zip(project()).subarray(0,-8)]),{dataDirectory:dir}),/directory|signature|end|zip/i);assert.deepEqual(await fs.readdir(path.join(dir,'uploads')),[]);
});
test('compressed upload limits, cancellation and invalid manifest cannot leave usable upload projects',async t=>{
 const dir=await directory(t);await assert.rejects(receiveProjectZip(Readable.from([]),{dataDirectory:dir,contentLength:ZIP_LIMITS.compressedBytes+1}),/20 MiB/);
 const one=Buffer.alloc(1024*1024);await assert.rejects(receiveProjectZip(Readable.from((function*(){for(let i=0;i<21;i++)yield one;})()),{dataDirectory:dir}),/20 MiB/);assert.deepEqual(await fs.readdir(path.join(dir,'uploads')),[]);
 const controller=new AbortController();controller.abort();await assert.rejects(receiveProjectZip(Readable.from([]),{dataDirectory:dir,signal:controller.signal}),{name:'AbortError'});
 await rejectsClean(t,[{name:'package.json',data:'not JSON'}],/valid JSON/);
});
test('entry validation rejects unknown compression and directory file payloads',()=>{
 const base={fileName:'a',externalFileAttributes:0,generalPurposeBitFlag:0,compressionMethod:0,uncompressedSize:0,compressedSize:0};assert.throws(()=>validateZipEntry({...base,compressionMethod:99}),/compression/);assert.throws(()=>validateZipEntry({...base,fileName:'directory/',uncompressedSize:2}),/directory entries/);
});

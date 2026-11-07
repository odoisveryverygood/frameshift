/** Bounded all-facet vertex-clustering overview. Never rewrites the source STL. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_SOURCE_BYTES = 2_000_000_000;
const CHUNK_FACETS = 16000;
const RESOLUTIONS = [256,128,64,32,16,8,4,2];
const sourceMapScope = 'Each display triangle maps to one representative source facet that produced its clustered cell triple. Display vertices can originate from other facets in those cells. This is not exact point correspondence or a robot part identity.';

export async function generateRepairOverview(inputPath, {directory,signal,maxTriangles=180000,timeoutMs=90000,onProgress=()=>{}}={}) {
  if(typeof directory!=='string'||!directory)throw Error('Choose a private directory for the derived overview.');
  if(!Number.isInteger(maxTriangles)||maxTriangles<1||maxTriangles>250000)throw Error('Overview triangle limit must be between 1 and 250000.');
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw Error('Overview deadline must be between 1 and 120000 ms.');
  const deadline=Date.now()+timeoutMs;
  function check(){signal?.throwIfAborted();if(Date.now()>deadline)throw Error('Repair overview generation exceeded its bounded deadline.');}
  check();
  const input=await fs.realpath(inputPath),output=path.resolve(directory);
  const files={positionsPath:path.join(output,'overview-positions.bin'),sourceFacetMapPath:path.join(output,'overview-source-facets.bin'),metadataPath:path.join(output,'overview-metadata.json')};
  if(Object.values(files).some(file=>file===input))throw Error('Derived overview must not overwrite the original STL.');
  const handle=await fs.open(input,'r');
  let bytesReadTotal=0,completePasses=0;
  async function readFully(buffer,length,position){
    let offset=0;
    while(offset<length){check();const result=await handle.read(buffer,offset,length-offset,position+offset);if(!result.bytesRead)throw Error('STL ended before its declared facets were read.');offset+=result.bytesRead;bytesReadTotal+=result.bytesRead;}
  }
  try {
    const stat=await handle.stat();
    if(stat.size<134||stat.size>MAX_SOURCE_BYTES)throw Error('Repair overview requires a binary STL between one facet and 2 GB.');
    const header=Buffer.alloc(84);await readFully(header,84,0);const sourceTriangles=header.readUInt32LE(80);
    if(!sourceTriangles||84+sourceTriangles*50!==stat.size)throw Error('Binary STL size does not match its declared triangle count; no overview was fabricated.');
    const chunk=Buffer.alloc(CHUNK_FACETS*50),vertices=new Float64Array(9);
    const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    let validFacets=0,nonFiniteFacets=0,degenerateFacets=0;
    async function scan(visitor,phase,resolution=null){
      for(let start=0;start<sourceTriangles;start+=CHUNK_FACETS){
        check();const count=Math.min(CHUNK_FACETS,sourceTriangles-start);await readFully(chunk,count*50,84+start*50);
        for(let j=0;j<count;j++){
          if((j&1023)===0)check();const base=j*50+12;let finite=true;
          for(let k=0;k<9;k++){const value=chunk.readFloatLE(base+k*4);vertices[k]=value;if(!Number.isFinite(value))finite=false;}
          let kind='valid';
          if(!finite)kind='nonfinite';
          else {const ax=vertices[3]-vertices[0],ay=vertices[4]-vertices[1],az=vertices[5]-vertices[2],bx=vertices[6]-vertices[0],by=vertices[7]-vertices[1],bz=vertices[8]-vertices[2];const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;if(nx===0&&ny===0&&nz===0)kind='degenerate';}
          if(visitor(vertices,start+j,kind)===false)return false;
        }
        await onProgress({phase,gridResolution:resolution,scannedTriangles:Math.min(sourceTriangles,start+count),sourceTriangles});
      }
      completePasses++;return true;
    }
    await scan((v,index,kind)=>{
      if(kind==='nonfinite'){nonFiniteFacets++;return;}
      if(kind==='degenerate'){degenerateFacets++;return;}
      validFacets++;
      for(let k=0;k<9;k++){const axis=k%3;bounds.min[axis]=Math.min(bounds.min[axis],v[k]);bounds.max[axis]=Math.max(bounds.max[axis],v[k]);}
    },'scan');
    if(!validFacets)throw Error('STL contains no finite, non-degenerate surface facets for an overview.');
    const dimensions=bounds.max.map((n,i)=>n-bounds.min[i]);
    if(!dimensions.every(Number.isFinite)||!Math.max(...dimensions))throw Error('STL has no usable finite spatial extent.');
    bounds.dimensions=dimensions;bounds.center=bounds.min.map((n,i)=>(n+bounds.max[i])/2);
    const attempts=[];
    let chosen;
    for(const resolution of RESOLUTIONS){
      check();
      // Both maps have hard entry caps. An overflowing pass is discarded before
      // retrying a coarser grid, preventing source-size-proportional memory use.
      const maxVertices=Math.max(32,Math.min(250000,maxTriangles*4));
      const representativePositions=new Float32Array(maxVertices*3);
      const triangleVertices=new Uint32Array(maxTriangles*3),facetMap=new Uint32Array(maxTriangles);
      const vertexMap=new Map(),triangleMap=new Set();let vertexCount=0,triangleCount=0,collapsed=0,duplicate=0,maxDisplacementSquared=0,overflow=null,scanned=0;
      function vertexId(v,offset){
        const ix=dimensions[0]===0?0:Math.max(0,Math.min(resolution-1,Math.floor((v[offset]-bounds.min[0])/dimensions[0]*resolution)));
        const iy=dimensions[1]===0?0:Math.max(0,Math.min(resolution-1,Math.floor((v[offset+1]-bounds.min[1])/dimensions[1]*resolution)));
        const iz=dimensions[2]===0?0:Math.max(0,Math.min(resolution-1,Math.floor((v[offset+2]-bounds.min[2])/dimensions[2]*resolution)));
        const key=(ix*resolution+iy)*resolution+iz;let id=vertexMap.get(key);
        if(id===undefined){if(vertexCount>=maxVertices){overflow='vertex-map-cap';return -1;}id=vertexCount++;vertexMap.set(key,id);for(let k=0;k<3;k++)representativePositions[id*3+k]=v[offset+k];}
        const dx=v[offset]-representativePositions[id*3],dy=v[offset+1]-representativePositions[id*3+1],dz=v[offset+2]-representativePositions[id*3+2];maxDisplacementSquared=Math.max(maxDisplacementSquared,dx*dx+dy*dy+dz*dz);return id;
      }
      const complete=await scan((v,index,kind)=>{
        scanned=index+1;if(kind!=='valid')return;
        const a=vertexId(v,0),b=vertexId(v,3),c=vertexId(v,6);if(overflow)return false;
        if(a===b||b===c||a===c){collapsed++;return;}
        // Distinct cells can still have collinear representatives.
        const ax=representativePositions[b*3]-representativePositions[a*3],ay=representativePositions[b*3+1]-representativePositions[a*3+1],az=representativePositions[b*3+2]-representativePositions[a*3+2],bx=representativePositions[c*3]-representativePositions[a*3],by=representativePositions[c*3+1]-representativePositions[a*3+1],bz=representativePositions[c*3+2]-representativePositions[a*3+2];
        if(ay*bz-az*by===0&&az*bx-ax*bz===0&&ax*by-ay*bx===0){collapsed++;return;}
        const lo=Math.min(a,b,c),hi=Math.max(a,b,c),mid=a+b+c-lo-hi,key=lo+','+mid+','+hi;
        if(triangleMap.has(key)){duplicate++;return;}
        if(triangleCount>=maxTriangles){overflow='triangle-map-cap';return false;}
        triangleMap.add(key);triangleVertices[triangleCount*3]=a;triangleVertices[triangleCount*3+1]=b;triangleVertices[triangleCount*3+2]=c;facetMap[triangleCount]=index;triangleCount++;
      },'cluster',resolution);
      attempts.push({resolution,completed:complete,scannedTriangles:scanned,previewTriangles:triangleCount,vertices:vertexCount,overflow});
      if(complete&&triangleCount){chosen={resolution,representativePositions,triangleVertices,facetMap,vertexCount,triangleCount,collapsed,duplicate,maxDisplacement:Math.sqrt(maxDisplacementSquared)};break;}
    }
    if(!chosen)throw Error('No usable bounded overview survived vertex clustering. The full source remains unchanged.');
    check();
    const positions=new Float32Array(chosen.triangleCount*9),sourceFacetRepresentative=new Uint32Array(chosen.triangleCount),displayBounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]};
    for(let i=0;i<chosen.triangleCount;i++){
      if((i&1023)===0)check();sourceFacetRepresentative[i]=chosen.facetMap[i];
      for(let corner=0;corner<3;corner++){const vertex=chosen.triangleVertices[i*3+corner];for(let axis=0;axis<3;axis++){const value=chosen.representativePositions[vertex*3+axis];positions[i*9+corner*3+axis]=value;displayBounds.min[axis]=Math.min(displayBounds.min[axis],value);displayBounds.max[axis]=Math.max(displayBounds.max[axis],value);}}
    }
    displayBounds.dimensions=displayBounds.max.map((n,i)=>n-displayBounds.min[i]);
    const positionBytes=Buffer.alloc(positions.length*4),mapBytes=Buffer.alloc(sourceFacetRepresentative.length*4);
    for(let i=0;i<positions.length;i++)positionBytes.writeFloatLE(positions[i],i*4);
    for(let i=0;i<sourceFacetRepresentative.length;i++)mapBytes.writeUInt32LE(sourceFacetRepresentative[i],i*4);
    const metadata={version:1,method:'all-facet adaptive vertex clustering with first source vertex per cell and duplicate clustered triangle removal',approximate:true,previewOnly:true,sourceTriangles,validSourceTriangles:validFacets,sourceBytes:stat.size,previewTriangles:chosen.triangleCount,allInputTrianglesScanned:true,completePasses,bounds,displayBounds,gridResolution:chosen.resolution,cellSize:dimensions.map(n=>n/chosen.resolution),maxObservedVertexDisplacement:chosen.maxDisplacement,surfaceErrorBound:null,skippedSourceFacets:{nonFinite:nonFiniteFacets,degenerate:degenerateFacets},collapsedByClustering:chosen.collapsed,duplicateClusteredTriangles:chosen.duplicate,attempts,sourceFacetMapScope:sourceMapScope,files:{positions:'overview-positions.bin',sourceFacetRepresentative:'overview-source-facets.bin'},positionsSha256:crypto.createHash('sha256').update(positionBytes).digest('hex'),sourceFacetMapSha256:crypto.createHash('sha256').update(mapBytes).digest('hex'),bytesRead:bytesReadTotal,limitations:['Display overview only. The full STL is retained separately and is not replaced by this approximation.','Thin or small features can collapse or merge; this overview does not establish manifoldness, part identity, physical dimensions of omitted features, or manufacturing suitability.','Maximum observed vertex displacement is not a surface or topology error guarantee.',sourceMapScope]};
    check();await fs.mkdir(output,{recursive:true});
    const temporary=[];
    try {
      for(const [target,bytes] of [[files.positionsPath,positionBytes],[files.sourceFacetMapPath,mapBytes],[files.metadataPath,Buffer.from(JSON.stringify(metadata,null,2)+'\n')]]){check();const temp=target+'.'+crypto.randomUUID()+'.tmp';temporary.push(temp);await fs.writeFile(temp,bytes,{flag:'wx',mode:0o600});await fs.rename(temp,target);}
    }finally{for(const file of temporary)await fs.unlink(file).catch(()=>{});}
    return {...files,positions,componentIds:new Uint32Array(chosen.triangleCount),sourceFacetRepresentative,metadata};
  }finally{await handle.close();}
}

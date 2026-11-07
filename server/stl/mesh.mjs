/** Bounded STL normalization. This repairs mesh data, not a robot's mechanical design. */
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_TRIANGLES = 200000;
const scales = Object.freeze({mm:0.001,cm:0.01,m:1,in:0.0254});
const numeric = /^[+-]?(?:(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|Infinity|Inf|NaN)$/i;
const number = token => {
  if(!numeric.test(token)) throw Error('Malformed STL numeric token; the original file was not modified.');
  if(/^[-+]?inf(?:inity)?$/i.test(token)) return token.startsWith('-') ? -Infinity : Infinity;
  return Number(token);
};
function parseAscii(buffer, maxTriangles) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/,'');
  if(/[\x00-\x08\x0e-\x1f\ufffd]/.test(text)) throw Error('STL is neither valid ASCII nor a complete binary STL.');
  const positions = new Float64Array(maxTriangles*9), normals = new Float64Array(maxTriangles*3);
  const facet = /facet\s+normal\s+(\S+)\s+(\S+)\s+(\S+)\s+outer\s+loop\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+vertex\s+(\S+)\s+(\S+)\s+(\S+)\s+endloop\s+endfacet/gi;
  let count=0, previous=0, match;
  const validGap = gap => !/\b(?:facet|vertex|outer|endloop|endfacet)\b/i.test(gap) && !gap.replace(/^\s*(?:solid|endsolid)(?:[^\r\n]*)$/gmi,'').trim();
  while((match=facet.exec(text))) {
    if(!validGap(text.slice(previous,match.index))) throw Error('Malformed or incomplete ASCII STL facet; export the file again. No unknown geometry was discarded.');
    if(count>=maxTriangles)throw Error(`STL exceeds the ${maxTriangles.toLocaleString()} triangle import limit.`);
    for(let i=0;i<3;i++)normals[count*3+i]=number(match[i+1]);
    for(let i=0;i<9;i++)positions[count*9+i]=number(match[i+4]);
    count++; previous=facet.lastIndex;
  }
  if(!validGap(text.slice(previous)))throw Error('Malformed or truncated ASCII STL facet; export the file again. No unknown geometry was discarded.');
  if(!count)throw Error('STL contains no complete triangular facets.');
  return {format:'ascii',count,positions:positions.subarray(0,count*9),normals:normals.subarray(0,count*3),missingWrapper:!/^\s*solid\b/i.test(text)||!/^\s*endsolid\b/im.test(text)};
}
function parseStl(buffer,maxTriangles) {
  if(buffer.length<15)throw Error('STL is empty or too short to contain a triangle.');
  let count=buffer.length>=84?buffer.readUInt32LE(80):0;
  if(buffer.length>=84 && 84+count*50===buffer.length) {
    if(!count)throw Error('Binary STL contains zero triangles.');
    if(count>maxTriangles)throw Error(`STL exceeds the ${maxTriangles.toLocaleString()} triangle import limit.`);
    const positions=new Float64Array(count*9),normals=new Float64Array(count*3);
    for(let face=0;face<count;face++) {
      const offset=84+face*50;
      for(let i=0;i<3;i++)normals[face*3+i]=buffer.readFloatLE(offset+i*4);
      for(let i=0;i<9;i++)positions[face*9+i]=buffer.readFloatLE(offset+12+i*4);
    }
    return {format:'binary',count,positions,normals,missingWrapper:false};
  }
  const prefix=buffer.subarray(0,512).toString('utf8').replace(/^\uFEFF/,'');
  if(/^\s*(?:solid\b|facet\s+normal\b)/i.test(prefix) && !/[\x00-\x08\x0e-\x1f\ufffd]/.test(prefix))return parseAscii(buffer,maxTriangles);
  if(buffer.length>=84 && count>0 && count<=maxTriangles) {
    const expected=84+count*50;
    throw Error(buffer.length<expected?'Binary STL is truncated: its declared triangle data is incomplete. Re-export or recover the source CAD.':'Binary STL length does not match its declared triangle count. No trailing data was silently discarded.');
  }
  if(count>maxTriangles)throw Error(`Binary STL has an invalid count or exceeds the ${maxTriangles.toLocaleString()} triangle import limit.`);
  throw Error('Unsupported or malformed STL. Supply a complete ASCII or binary STL export.');
}
function normalAt(p,offset) {
  const ux=p[offset+3]-p[offset],uy=p[offset+4]-p[offset+1],uz=p[offset+5]-p[offset+2];
  const vx=p[offset+6]-p[offset],vy=p[offset+7]-p[offset+1],vz=p[offset+8]-p[offset+2];
  const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx, length=Math.hypot(x,y,z);
  return {x,y,z,length};
}
function binaryStl(positions) {
  const count=positions.length/9, output=Buffer.alloc(84+count*50);
  output.write('Earl normalized STL; units declared separately; original retained',0,'ascii');output.writeUInt32LE(count,80);
  for(let face=0;face<count;face++){
    const n=normalAt(positions,face*9),offset=84+face*50;
    output.writeFloatLE(n.length?n.x/n.length:0,offset);output.writeFloatLE(n.length?n.y/n.length:0,offset+4);output.writeFloatLE(n.length?n.z/n.length:0,offset+8);
    for(let i=0;i<9;i++)output.writeFloatLE(positions[face*9+i],offset+12+i*4);
  }
  return output;
}
function topology(positions,vertices,vertexCount) {
  const count=positions.length/9, parents=new Uint32Array(count), sizes=new Uint32Array(count);for(let i=0;i<count;i++){parents[i]=i;sizes[i]=1;}
  const find = face => {let root=face;while(parents[root]!==root)root=parents[root];while(parents[face]!==face){const next=parents[face];parents[face]=root;face=next;}return root;};
  const union=(a,b)=>{a=find(a);b=find(b);if(a===b)return;if(sizes[a]<sizes[b])[a,b]=[b,a];parents[b]=a;sizes[a]+=sizes[b];};
  const edges=new Map();
  for(let face=0;face<count;face++)for(let i=0;i<3;i++){
    const a=vertices[face*3+i],b=vertices[face*3+(i+1)%3],lo=Math.min(a,b),hi=Math.max(a,b),key=lo*vertexCount+hi;
    const edge=edges.get(key),dir=a<b?1:-1;
    if(edge){edge.count++;union(face,edge.firstFace);if(edge.count===2){edge.secondFace=face;edge.secondDir=dir;}}
    else edges.set(key,{firstFace:face,firstDir:dir,count:1});
  }
  const roots=new Map(),componentIds=new Uint32Array(count),components=[];
  for(let face=0;face<count;face++){
    const root=find(face);if(!roots.has(root)){roots.set(root,components.length);components.push({id:components.length,label:`Shell ${components.length+1}`,triangleCount:0,boundaryEdges:0,nonManifoldEdges:0,orientationConflicts:0,windingFlipped:0,inferred:true});}
    const id=roots.get(root);componentIds[face]=id;components[id].triangleCount++;
  }
  const heads=new Int32Array(count);heads.fill(-1);
  const to=new Uint32Array(count*3),next=new Int32Array(count*3),xor=new Uint8Array(count*3);let links=0,boundaryEdges=0,nonManifoldEdges=0,inconsistentWindingEdges=0;
  const link=(a,b,required)=>{to[links]=b;xor[links]=required;next[links]=heads[a];heads[a]=links++;};
  for(const edge of edges.values()){
    const component=components[componentIds[edge.firstFace]];
    if(edge.count===1){boundaryEdges++;component.boundaryEdges++;}
    else if(edge.count>2){nonManifoldEdges++;component.nonManifoldEdges++;}
    else {const required=edge.firstDir===edge.secondDir?1:0;inconsistentWindingEdges+=required;link(edge.firstFace,edge.secondFace,required);link(edge.secondFace,edge.firstFace,required);}
  }
  const flips=new Int8Array(count);flips.fill(-1);const queue=new Uint32Array(count),flipCounts=new Uint32Array(components.length);
  for(let start=0;start<count;start++){
    if(flips[start]>=0)continue;
    const component=components[componentIds[start]];if(component.nonManifoldEdges){flips[start]=0;continue;}
    let head=0,tail=0;queue[tail++]=start;flips[start]=0;
    while(head<tail){const face=queue[head++];for(let index=heads[face];index>=0;index=next[index]){
      const neighbor=to[index],expected=flips[face]^xor[index];
      if(flips[neighbor]<0){flips[neighbor]=expected;flipCounts[component.id]+=expected;queue[tail++]=neighbor;}
      else if(flips[neighbor]!==expected)component.orientationConflicts++;
    }}
  }
  let windingFlipped=0;
  for(let face=0;face<count;face++){
    const component=components[componentIds[face]];
    const flip=flipCounts[component.id]>component.triangleCount/2?1-flips[face]:flips[face];
    if(!component.nonManifoldEdges&&!component.orientationConflicts&&flip===1){
      for(let i=0;i<3;i++){const a=face*9+3+i,b=face*9+6+i;[positions[a],positions[b]]=[positions[b],positions[a]];}
      component.windingFlipped++;windingFlipped++;
    }
  }
  for(const component of components){component.closedManifold=component.boundaryEdges===0&&component.nonManifoldEdges===0&&component.orientationConflicts===0;component.orientation='relative consistency only; exterior versus cavity orientation is not inferred';}
  return {componentIds,components,boundaryEdges,nonManifoldEdges,inconsistentWindingEdges,windingFlipped,orientationConflicts:components.reduce((sum,c)=>sum+c.orientationConflicts,0)};
}
function originalComponents(positions) {
  const count=positions.length/9,vertexMap=new Map(),ids=new Uint32Array(count*3),parents=new Uint32Array(count);
  for(let face=0;face<count;face++){parents[face]=face;for(let v=0;v<3;v++){const at=face*9+v*3,key=[positions[at]||0,positions[at+1]||0,positions[at+2]||0].join(',');if(!vertexMap.has(key))vertexMap.set(key,vertexMap.size);ids[face*3+v]=vertexMap.get(key);}}
  const find = value => {let root=value;while(parents[root]!==root)root=parents[root];while(parents[value]!==value){const next=parents[value];parents[value]=root;value=next;}return root;};
  const edges=new Map(),vertexCount=vertexMap.size;
  for(let face=0;face<count;face++)for(let i=0;i<3;i++){
    const a=ids[face*3+i],b=ids[face*3+(i+1)%3];if(a===b)continue;
    const key=Math.min(a,b)*vertexCount+Math.max(a,b);
    if(edges.has(key)){const old=find(edges.get(key)),current=find(face);if(old!==current)parents[current]=old;}else edges.set(key,face);
  }
  const roots=new Map(),result=new Uint32Array(count);
  for(let face=0;face<count;face++){const root=find(face);if(!roots.has(root))roots.set(root,roots.size);result[face]=roots.get(root);}
  return {ids:result,count:roots.size};
}
export function analyzeAndRepairStl(input,{units,maxTriangles=MAX_TRIANGLES}={}) {
  if(!Object.hasOwn(scales,units))throw Error('Choose the STL export units: mm, cm, m, or in. Units are not inferred from geometry.');
  if(!Number.isInteger(maxTriangles)||maxTriangles<1||maxTriangles>MAX_TRIANGLES)throw Error('Invalid STL triangle limit.');
  if(!Buffer.isBuffer(input)&&!(input instanceof Uint8Array))throw Error('STL bytes are required.');
  const buffer=Buffer.isBuffer(input)?input:Buffer.from(input);
  if(buffer.length>MAX_BYTES)throw Error('STL exceeds the 40 MiB import limit.');
  const parsed=parseStl(buffer,maxTriangles), originalPositions=new Float32Array(parsed.positions.length),positions=new Float32Array(parsed.positions.length),vertexIds=new Uint32Array(parsed.count*3),retained=new Uint32Array(parsed.count);
  const removed={nonFinite:0,degenerate:0,duplicate:0},vertices=new Map(),faces=new Set();
  let output=0,preview=0,quantizedCoordinates=0,maxCoordinateDelta=0;
  for(let face=0;face<parsed.count;face++){
    const raw=parsed.positions.subarray(face*9,face*9+9),p=Float32Array.from(raw);
    if(![...raw,...p].every(Number.isFinite)){removed.nonFinite++;continue;}
    for(let i=0;i<9;i++){const delta=Math.abs(raw[i]-p[i]);if(delta){quantizedCoordinates++;maxCoordinateDelta=Math.max(maxCoordinateDelta,delta);}}
    originalPositions.set(p,preview++*9);
    const n=normalAt(p,0);if(!n.length){removed.degenerate++;continue;}
    const ids=[];
    for(let i=0;i<3;i++){const key=[p[i*3]||0,p[i*3+1]||0,p[i*3+2]||0].join(',');if(!vertices.has(key))vertices.set(key,vertices.size);ids.push(vertices.get(key));}
    const key=[...ids].sort((a,b)=>a-b).join(',');if(faces.has(key)){removed.duplicate++;continue;}faces.add(key);
    positions.set(p,output*9);vertexIds.set(ids,output*3);retained[output]=face;output++;
  }
  if(!output)throw Error('No usable triangles remain after validating non-finite, zero-area and duplicate facets. The original must be recovered or re-exported.');
  const repairedPositions=positions.slice(0,output*9),originalPreviewPositions=originalPositions.slice(0,preview*9);
  const topo=topology(repairedPositions,vertexIds.subarray(0,output*3),vertices.size);
  const originalGrouping=originalComponents(originalPreviewPositions);
  let correctedNormals=0;
  for(let face=0;face<output;face++){
    const n=normalAt(repairedPositions,face*9),source=retained[face]*3,x=parsed.normals[source],y=parsed.normals[source+1],z=parsed.normals[source+2],length=Math.hypot(x,y,z);
    if(!Number.isFinite(length)||!length||Math.abs(length-1)>1e-5||(x*n.x+y*n.y+z*n.z)/(length*n.length)<1-1e-5)correctedNormals++;
  }
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<repairedPositions.length;i++){const axis=i%3;min[axis]=Math.min(min[axis],repairedPositions[i]);max[axis]=Math.max(max[axis],repairedPositions[i]);}
  const bounds={min,max,size:max.map((v,i)=>v-min[i])},geometryChanged=Object.values(removed).some(Boolean)||topo.windingFlipped>0||quantizedCoordinates>0;
  const issues=[];
  if(removed.nonFinite)issues.push(`${removed.nonFinite} facets with non-finite or unrepresentable coordinates were excluded; their missing surface cannot be reconstructed.`);
  if(removed.degenerate)issues.push(`${removed.degenerate} zero-area facets were removed.`);
  if(removed.duplicate)issues.push(`${removed.duplicate} coincident duplicate facets were removed; review any intended double-sided surfaces.`);
  if(topo.boundaryEdges)issues.push(`${topo.boundaryEdges} boundary edges remain. Open boundaries are not automatically filled.`);
  if(topo.nonManifoldEdges)issues.push(`${topo.nonManifoldEdges} non-manifold edges remain; winding on affected shells was left unchanged.`);
  if(topo.orientationConflicts)issues.push('Some shells have conflicting orientation constraints and were not automatically reoriented.');
  if(topo.windingFlipped)issues.push(`${topo.windingFlipped} facets were flipped for relative winding consistency; exterior/cavity orientation was not inferred.`);
  if(quantizedCoordinates)issues.push(`ASCII coordinates were normalized to STL float32 precision (${quantizedCoordinates} changed coordinates; maximum delta ${maxCoordinateDelta} ${units}).`);
  if(topo.components.length>1000)issues.push(`${topo.components.length} inferred shells were detected; component details are limited to the first 1,000 while geometry and total counts are retained.`);
  if(parsed.missingWrapper)issues.push('The ASCII solid wrapper was missing; complete facets were recovered into a binary STL container.');
  const requiresReview=geometryChanged||topo.boundaryEdges>0||topo.nonManifoldEdges>0||topo.orientationConflicts>0||parsed.missingWrapper;
  const changed=geometryChanged||correctedNormals>0||parsed.missingWrapper;
  const report={version:1,format:parsed.format,units,scaleToMeters:scales[units],inputTriangles:parsed.count,originalRenderableTriangles:preview,originalConnectedComponents:originalGrouping.count,outputTriangles:output,removed,removedNonFinite:removed.nonFinite,removedDegenerate:removed.degenerate,removedDuplicate:removed.duplicate,recalculatedNormals:output,normalsRecalculated:output,correctedNormals,windingFlipped:topo.windingFlipped,quantizedCoordinates,maxCoordinateDelta,bounds,boundaryEdges:topo.boundaryEdges,nonManifoldEdges:topo.nonManifoldEdges,connectedComponents:topo.components.length,topology:{...topo,componentIds:undefined,components:topo.components.slice(0,1000),componentDetailsTruncated:topo.components.length>1000},componentDetailsTruncated:topo.components.length>1000,previewNormalization:'Finite source geometry only; normals are recalculated and coordinates use STL float32 precision. The raw original is retained separately.',geometryChanged,geometryLoss:Object.values(removed).some(Boolean),requiresReview,status:requiresReview?'repaired-with-warnings':changed?'repaired':'unchanged',issues,limits:{maxBytes:MAX_BYTES,maxTriangles,maxComponentDetails:1000},limitations:['Geometric shells are inferred connected components, not named CAD parts, joints or robot mechanisms.','STL does not encode reliable assembly structure, colors, units or parametric design history; units were supplied by the user.','No hole filling, missing-geometry reconstruction, mechanical validation or manufacturing suitability is claimed.','Consistent relative winding does not establish an outward orientation for nested shells or cavities.']};
  return {repaired:binaryStl(repairedPositions),originalPreview:binaryStl(originalPreviewPositions),positions:repairedPositions,componentIds:topo.componentIds,originalPositions:originalPreviewPositions,originalComponentIds:originalGrouping.ids,report};
}
export const STL_LIMITS=Object.freeze({maxBytes:MAX_BYTES,maxTriangles:MAX_TRIANGLES});

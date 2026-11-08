import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeAndRepairStl,STL_LIMITS} from '../server/stl/mesh.mjs';
const triangle=[0,0,0,1,0,0,0,1,0];
function ascii(faces,{normal='0 0 0',wrapper=true}={}) {
 const body=faces.map(face=>`facet normal ${normal}\nouter loop\n${[0,3,6].map(i=>`vertex ${face.slice(i,i+3).join(' ')}`).join('\n')}\nendloop\nendfacet`).join('\n');
 return Buffer.from(wrapper?`solid test\n${body}\nendsolid test\n`:body);
}
function binary(faces,header='fixture',normal=[0,0,0]) {
 const b=Buffer.alloc(84+faces.length*50);b.write(header);b.writeUInt32LE(faces.length,80);
 faces.forEach((face,n)=>{for(let i=0;i<3;i++)b.writeFloatLE(normal[i],84+n*50+i*4);face.forEach((v,i)=>b.writeFloatLE(v,96+n*50+i*4));});return b;
}
const options={units:'mm'};
const tetra=[
 [0,0,0,0,1,0,1,0,0],
 [0,0,0,1,0,0,0,0,1],
 [0,0,0,0,0,1,0,1,0],
 [1,0,0,0,1,0,0,0,1],
];
function vertexSets(positions){const out=[];for(let i=0;i<positions.length;i+=9)out.push([positions.slice(i,i+3).join(','),positions.slice(i+3,i+6).join(','),positions.slice(i+6,i+9).join(',')].sort().join('|'));return out.sort();}

test('ASCII repair reports every dropped facet, preserves source bytes, and never fills boundaries',()=>{
 const nan=[...triangle];nan[0]=NaN;
 const b=ascii([triangle,triangle,[0,0,0,0,0,0,0,0,0],nan]);const before=Buffer.from(b);
 const r=analyzeAndRepairStl(b,options);
 assert.deepEqual(b,before);assert.equal(r.report.inputTriangles,4);assert.equal(r.report.outputTriangles,1);
 assert.deepEqual(r.report.removed,{nonFinite:1,degenerate:1,duplicate:1});
 assert.equal(r.report.originalRenderableTriangles,3);assert.equal(r.originalPositions.length,27);assert.equal(r.originalComponentIds.length,3);assert.deepEqual([...r.originalComponentIds],[0,0,1]);
 assert.equal(r.report.boundaryEdges,3);assert.equal(r.report.requiresReview,true);assert.equal(r.report.geometryLoss,true);
 assert.equal(r.repaired.readUInt32LE(80),1);assert.equal(r.originalPreview.readUInt32LE(80),3);
 assert.ok(r.report.issues.some(v=>v.includes('not automatically filled')));
});
test('binary STL whose header starts with solid is detected by its complete length',()=>{
 const r=analyzeAndRepairStl(binary([triangle],'solid misleading header'),{units:'in'});
 assert.equal(r.report.format,'binary');assert.equal(r.report.units,'in');assert.equal(r.report.scaleToMeters,.0254);
 assert.deepEqual(r.report.bounds,{min:[0,0,0],max:[1,1,0],size:[1,1,0]});
 assert.equal(r.report.correctedNormals,1);assert.equal(r.report.recalculatedNormals,1);
 assert.ok(r.positions instanceof Float32Array);assert.ok(r.componentIds instanceof Uint32Array);
 assert.equal(r.repaired.readFloatLE(84+8),1);
});
test('truncated binary, extra binary data, invalid ASCII facets and empty geometry fail explicitly',()=>{
 const b=binary([triangle]);assert.throws(()=>analyzeAndRepairStl(b.subarray(0,b.length-1),options),/truncated/);
 assert.throws(()=>analyzeAndRepairStl(Buffer.concat([b,Buffer.from([0])]),options),/length does not match/);
 assert.throws(()=>analyzeAndRepairStl(ascii([triangle]).subarray(0,70),options),/Malformed|truncated|no complete/i);
 assert.throws(()=>analyzeAndRepairStl(Buffer.from('solid empty\nendsolid empty'),options),/no complete/);
 assert.throws(()=>analyzeAndRepairStl(ascii([[0,0,0,0,0,0,0,0,0]]),options),/No usable triangles/);
 assert.throws(()=>analyzeAndRepairStl(Buffer.from(ascii([triangle]).toString().replace('vertex 1','vertex rubbish')),options),/numeric token/);
});
test('relative winding repair fixes a closed tetrahedron without inventing vertices',()=>{
 const faces=tetra.map(f=>[...f]);[faces[0][3],faces[0][6]]=[faces[0][6],faces[0][3]];[faces[0][4],faces[0][7]]=[faces[0][7],faces[0][4]];[faces[0][5],faces[0][8]]=[faces[0][8],faces[0][5]];
 const r=analyzeAndRepairStl(binary(faces),options);
 assert.equal(r.report.windingFlipped,1);assert.equal(r.report.boundaryEdges,0);assert.equal(r.report.nonManifoldEdges,0);
 assert.equal(r.report.topology.components[0].closedManifold,true);assert.equal(r.report.requiresReview,true);
 assert.deepEqual(vertexSets(r.positions),vertexSets(Float32Array.from(faces.flat())));
 const stable=analyzeAndRepairStl(r.repaired,options);assert.equal(stable.report.windingFlipped,0);assert.equal(stable.report.outputTriangles,4);
});
test('closed nested shells retain their independent orientation instead of guessing exterior or cavity',()=>{
 const inner=tetra.map(f=>[f.slice(0,3),f.slice(6,9),f.slice(3,6)].flat().map(v=>v*.25+.25));
 const raw=Float32Array.from([...tetra,...inner].flat()),r=analyzeAndRepairStl(binary([...tetra,...inner]),options);
 assert.equal(r.report.connectedComponents,2);assert.equal(r.report.windingFlipped,0);assert.equal(r.report.boundaryEdges,0);
 assert.deepEqual(r.positions,raw);assert.deepEqual([...new Set(r.componentIds)],[0,1]);
 assert.ok(r.report.topology.components.every(c=>c.closedManifold&&c.inferred));
});
test('non-manifold edges remain diagnostic and block automatic shell orientation repairs',()=>{
 const faces=[triangle,[1,0,0,0,0,0,0,0,1],[0,0,0,1,0,0,0,-1,0]];
 const r=analyzeAndRepairStl(binary(faces),options);
 assert.equal(r.report.nonManifoldEdges,1);assert.equal(r.report.connectedComponents,1);assert.equal(r.report.windingFlipped,0);
 assert.equal(r.report.requiresReview,true);assert.equal(r.report.topology.components[0].closedManifold,false);
});
test('units and limits are explicit and float32 normalization is disclosed',()=>{
 assert.throws(()=>analyzeAndRepairStl(binary([triangle])),/Choose the STL export units/);
 assert.throws(()=>analyzeAndRepairStl(binary([triangle]),{units:'guess'}),/Choose/);
 assert.throws(()=>analyzeAndRepairStl(binary([triangle,triangle]),{units:'mm',maxTriangles:1}),/triangle import limit/);
 assert.throws(()=>analyzeAndRepairStl(Buffer.alloc(STL_LIMITS.maxBytes+1),options),/40 MiB/);
 const r=analyzeAndRepairStl(ascii([[.1,0,0,1,0,0,0,1,0]],{wrapper:false}),{units:'cm'});
 assert.equal(r.report.scaleToMeters,.01);assert.ok(r.report.quantizedCoordinates>0);assert.ok(r.report.maxCoordinateDelta>0);assert.equal(r.report.requiresReview,true);
});

test('large disconnected meshes retain all geometry while bounding report component details',()=>{
 const faces=Array.from({length:1001},(_,i)=>triangle.map((v,n)=>n%3===0?v+i*2:v));
 const r=analyzeAndRepairStl(binary(faces),options);
 assert.equal(r.report.outputTriangles,1001);assert.equal(r.componentIds.length,1001);
 assert.equal(r.report.connectedComponents,1001);assert.equal(r.report.topology.components.length,1000);
 assert.equal(r.report.componentDetailsTruncated,true);assert.equal(r.report.topology.componentDetailsTruncated,true);
 assert.equal(r.componentIds.at(-1),1000);assert.ok(r.report.issues.some(v=>v.includes('geometry and total counts are retained')));
});

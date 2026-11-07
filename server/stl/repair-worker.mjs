import fs from 'node:fs/promises';
import path from 'node:path';
import {generateRepairOverview} from './repair-preview.mjs';
import {measureBinaryRegion} from './repair-measure.mjs';
import {transformBinaryRegion,verifyBinaryRegion} from './repair-geometry.mjs';
const [requestFile]=process.argv.slice(2);const directory=path.dirname(requestFile);
try{
 const r=JSON.parse(await fs.readFile(requestFile,'utf8'));let result;
 if(r.operation==='overview'){
  const data=await generateRepairOverview(r.source,{directory:r.directory,maxTriangles:200000});result={metadata:data.metadata};
 }else if(r.operation==='measure')result=await measureBinaryRegion(r.source,r.bounds);
 else if(r.operation==='candidate'){
  const measurement=await measureBinaryRegion(r.source,r.bounds);
  if(!measurement.selectedTriangles||!measurement.unselectedTriangles)throw Error('Select one complete region, leaving the rest of the robot unchanged.');
  if(measurement.boundaryCrossingFacets)throw Error(`The region cuts through ${measurement.boundaryCrossingFacets} triangles. Expand or adjust it to surround the complete detached part.`);
  const outputPath=path.join(directory,'candidate.stl');
  const transformation=await transformBinaryRegion(r.source,{outputPath,bounds:r.bounds,matrix:r.matrix});
  if(r.expectedSourceSha256&&transformation.inputSha256!==r.expectedSourceSha256&&transformation.sourceSha256!==r.expectedSourceSha256&&transformation.originalSha256!==r.expectedSourceSha256)throw Error('Mesh source fingerprint changed. Generate a fresh repair plan.');
  const verification=await verifyBinaryRegion(r.source,outputPath,{bounds:r.bounds,matrix:r.matrix});
  if(verification.pass!==true)throw Error('The exported geometry did not pass independent verification.');
  const preview=await generateRepairOverview(outputPath,{directory:path.join(directory,'preview'),maxTriangles:200000});
  result={measurement,transformation,verification,previewMetadata:preview.metadata};
 }else throw Error('Unknown repair operation.');
 await fs.writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2));
}catch(error){await fs.writeFile(path.join(directory,'error.json'),JSON.stringify({error:String(error.message).slice(0,1800)}));process.exitCode=1;}

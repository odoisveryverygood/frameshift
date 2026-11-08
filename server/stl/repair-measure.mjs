import fs from 'node:fs/promises';
import {Box3,Vector3,Triangle} from 'three';
export function validateRepairBounds(value){
 if(!value||!['min','max'].every(k=>Array.isArray(value[k])&&value[k].length===3&&value[k].every(n=>Number.isFinite(n)&&Math.abs(n)<1e8))||value.min.some((n,i)=>n>=value.max[i]))throw Error('Choose a finite, nonempty 3D region around the detached part.');
 return {min:[...value.min],max:[...value.max]};
}
export async function measureBinaryRegion(filename,bounds,{signal}={}){
 bounds=validateRepairBounds(bounds);const file=await fs.open(filename,'r');
 const region=new Box3(new Vector3(...bounds.min),new Vector3(...bounds.max)),triangle=new Triangle();
 try{
  const header=Buffer.alloc(84);if((await file.read(header,0,84,0)).bytesRead!==84)throw Error('Incomplete binary STL header.');
  const count=header.readUInt32LE(80),size=(await file.stat()).size;
  if(count<1||count>15000000||size!==84+50*count)throw Error('A complete binary STL of at most 15 million triangles is required.');
  let selectedTriangles=0,boundaryCrossingFacets=0;const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  const chunk=Buffer.allocUnsafe(1000000),points=[triangle.a,triangle.b,triangle.c];
  for(let first=0;first<count;first+=20000){
   signal?.throwIfAborted();const bytes=Math.min(20000,count-first)*50;let read=0;
   while(read<bytes){const n=(await file.read(chunk,read,bytes-read,84+first*50+read)).bytesRead;if(!n)throw Error('STL changed or became truncated.');read+=n;}
   for(let at=0;at<bytes;at+=50){
    let inside=0;
    for(let v=0;v<3;v++){const p=points[v],o=at+12+v*12;p.set(chunk.readFloatLE(o),chunk.readFloatLE(o+4),chunk.readFloatLE(o+8));if(![p.x,p.y,p.z].every(Number.isFinite))throw Error('Non-finite geometry in the cleaned mesh.');if(region.containsPoint(p))inside++;}
    if(inside===3){selectedTriangles++;for(const p of points){min[0]=Math.min(min[0],p.x);min[1]=Math.min(min[1],p.y);min[2]=Math.min(min[2],p.z);max[0]=Math.max(max[0],p.x);max[1]=Math.max(max[1],p.y);max[2]=Math.max(max[2],p.z);}}
    else if(inside||region.intersectsTriangle(triangle))boundaryCrossingFacets++;
   }
  }
  return {inputTriangles:count,selectedTriangles,unselectedTriangles:count-selectedTriangles,boundaryCrossingFacets,bounds,selectedBounds:selectedTriangles?{min,max}:null,selectionRule:'All three source vertices inside the inclusive box; intersected boundary triangles block export.',scope:'Geometric region, not an inferred named CAD part.'};
 }finally{await file.close();}
}

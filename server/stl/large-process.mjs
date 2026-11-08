/** Large binary STL worker. Reads uploaded geometry as data in bounded chunks. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {analyzeLargeBinaryStl} from './large-mesh.mjs';
const [directory,units]=process.argv.slice(2);
try{
 const result=await analyzeLargeBinaryStl(path.join(directory,'original.stl'),{outputPath:path.join(directory,'repaired.stl'),units});
 await fs.writeFile(path.join(directory,'positions.bin'),Buffer.from(result.positions.buffer,result.positions.byteOffset,result.positions.byteLength));
 await fs.writeFile(path.join(directory,'report.json'),JSON.stringify(result.report,null,2)+'\n');
 process.stdout.write(JSON.stringify({ok:true}));
}catch(error){
 await fs.writeFile(path.join(directory,'error.json'),JSON.stringify({error:String(error.message).slice(0,1500)}));process.exitCode=1;
}

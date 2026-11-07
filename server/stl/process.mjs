/** Own-code worker: uploaded bytes are data, never executable input. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeAndRepairStl } from './mesh.mjs';
const [directory,units]=process.argv.slice(2);
try {
  const result=analyzeAndRepairStl(await fs.readFile(path.join(directory,'original.stl')),{units});
  const write=(name,data)=>fs.writeFile(path.join(directory,name),Buffer.from(data.buffer||data,data.byteOffset||0,data.byteLength||data.length));
  await Promise.all([fs.writeFile(path.join(directory,'repaired.stl'),result.repaired),fs.writeFile(path.join(directory,'original-preview.stl'),result.originalPreview),write('positions.bin',result.positions),write('component-ids.bin',result.componentIds),write('source-positions.bin',result.originalPositions),write('source-component-ids.bin',result.originalComponentIds),fs.writeFile(path.join(directory,'report.json'),JSON.stringify(result.report,null,2)+'\n')]);
  process.stdout.write(JSON.stringify({ok:true}));
} catch(error) {
  await fs.writeFile(path.join(directory,'error.json'),JSON.stringify({error:String(error.message).slice(0,1500)}));process.exitCode=1;
}

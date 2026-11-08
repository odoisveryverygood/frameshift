/** Explicit operator authorization: create one public authored workload, no arbitrary project sharing. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {ROOT} from '../server/core.mjs';
const state = path.join(ROOT,'.frameshift/fetch/public');
await fs.mkdir(state,{recursive:true,mode:0o700});
const configFile=path.join(state,'config.json');
let config;
try {config=JSON.parse(await fs.readFile(configFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(!config){
  const response=await fetch('http://127.0.0.1:4310/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:path.join(ROOT,'examples/warehouse'),name:'Sift public warehouse',trusted:true}),signal:AbortSignal.timeout(30000)});
  const project=await response.json();
  if(!response.ok||!project.id)throw Error('Could not prepare public authored warehouse; start Sift first.');
  config={projectIds:[project.id],publicData:'Only the repository-authored warehouse workload is authorized. No private CAD or local projects.'};
  await fs.writeFile(configFile,JSON.stringify(config,null,2)+'\n',{mode:0o600});
}
console.log(JSON.stringify({authorizedProjectIds:config.projectIds,start:'npm run fetch:agent',identity:'npm run fetch:identity',warning:'Keep npm start and the mailbox process running. Registration uses the Agentverse Inspector; ASI live verification is a separate step.'},null,2));

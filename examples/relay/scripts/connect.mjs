/** Connect this explicitly chosen local project to the separately running Earl/Sift backend. */
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const folder=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const base='http://127.0.0.1:4310';
try {
 const stateResponse=await fetch(base+'/api/state',{signal:AbortSignal.timeout(10000)});
 if(!stateResponse.ok)throw Error('Sift is not ready');
 const state=await stateResponse.json();
 let project=state.projects.find(p=>p.original===folder&&!p.archived);
 if(!project){const response=await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:folder,name:'Relay · 2,000 warehouse robots',trusted:true}),signal:AbortSignal.timeout(60000)});project=await response.json();if(!response.ok||!project.id)throw Error(project.error||'Connection was rejected');}
 console.log(JSON.stringify({projectId:project.id,projectFolder:folder,open:base+'/?project='+project.id,prompt:'Optimize the 2,000 moving robots. Preserve their geometry, two fleet colors, deterministic motion, individual selection and dispatch assignment behavior.'},null,2));
}catch(error){console.error('Could not connect. Start the Earl/Sift backend on localhost:4310, then retry. '+error.message);process.exitCode=1;}

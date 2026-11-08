/** Versioned, source-grounded findings from actual local project snapshots. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, json, save, safeFile, within, id } from './core.mjs';
import { normalizeMission } from './mission.mjs';
import { createSourceTools } from './agent.mjs';
import { investigateProject } from './investigator.mjs';
import { provider as modelProvider, redactProviderError } from './model.mjs';
import { investigateWithGemini, geminiConfiguration } from './gemini-investigator.mjs';
import { withPage } from './benchmark.mjs';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=250&&!/[\x00-\x1f\x7f]/.test(value);
function paths(project) {
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(project?.id||''))throw Error('Invalid project identity');
  const base=path.join(DATA,'projects',project.id);return {workspace:path.join(base,'best'),store:path.join(base,'spatial'),file:path.join(base,'spatial','findings.json')};
}
function numbers(value,length) {return Array.isArray(value)&&value.length===length&&value.every(n=>Number.isFinite(n)&&Math.abs(n)<1e10);}
export function validateSceneContext(value) {
  if(!value||typeof value!=='object'||!identifier(value.selectedId))throw Error('Select a scene object before asking Earl');
  const selectedId=value.selectedId;
  if(!Number.isFinite(value.time)||value.time<0||value.time>3600)throw Error('Scene time must be between 0 and 3600 seconds');
  let camera=null;
  if(Array.isArray(value.camera)){if(!numbers(value.camera,3))throw Error('Invalid scene camera');camera=[...value.camera];}
  else if(value.camera!=null){
    if(!numbers(value.camera.position,3)||!numbers(value.camera.quaternion,4)||!numbers(value.camera.projection,16))throw Error('Invalid scene camera state');
    camera={position:[...value.camera.position],quaternion:[...value.camera.quaternion],projection:[...value.camera.projection],...(numbers(value.camera.up,3)?{up:[...value.camera.up]}:{})};
  }
  const raw=value.selection||{};
  const anchor=raw.anchor&&Number.isFinite(raw.anchor.x)&&Number.isFinite(raw.anchor.y)?{x:Math.max(0,Math.min(1,raw.anchor.x)),y:Math.max(0,Math.min(1,raw.anchor.y)),visible:Boolean(raw.anchor.visible)}:null;
  return {version:1,selectedId,selectedIds:[selectedId],time:value.time,camera,selection:{id:selectedId,name:typeof raw.name==='string'?raw.name.slice(0,250):selectedId,meshId:identifier(raw.meshId)?raw.meshId:null,instanceId:Number.isInteger(raw.instanceId)&&raw.instanceId>=0?raw.instanceId:null,anchor,...(numbers(raw.worldPosition,3)?{worldPosition:[...raw.worldPosition]}:{})},sourceAssociation:null};
}
export async function spatialRevision(project, options={}) {
  const workspace=options.workspace||paths(project).workspace;
  const hashes={};
  const discovered=(project.discovery?.files||[]).map(entry=>typeof entry==='string'?entry:entry.path).filter(name=>typeof name==='string'&&/\.[cm]?[jt]sx?$/.test(name));
  for(const name of [...new Set([...(project.config.editableFiles||[]),...discovered])].sort())hashes[name]=hash(await fs.readFile(await safeFile(workspace,name)));
  return hash(JSON.stringify(hashes));
}
export async function sourceAssociations(project,context,options={}) {
  const tools=await createSourceTools({workspace:options.workspace||paths(project).workspace,manifest:project.discovery,config:project.config,maxReadChars:200000});
  const queries=[context.selectedId,context.selectedId.replace(/[\d-]+$/,'')].filter(q=>q.length>=2);
  const hits=[];
  for(const query of [...new Set(queries)]){try {const r=await tools.search_source({query});for(const h of r.hits)if(!hits.some(x=>x.path===h.path&&x.line===h.line))hits.push({...h,confidence:'inferred',reason:'Literal source match; no creation-site instrumentation proves this object-to-source association.'});}catch{break;}}
  return hits.slice(0,8);
}
async function captureScene(project,context,signal,options={}) {
  const workspace=options.workspace||paths(project).workspace;
  const directory=within(workspace,project.config.outputDir||'dist');
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(45000)].filter(Boolean));
  return withPage(directory,bounded,async(page,errors)=>{
    const state=await page.evaluate(ctx=>window.__frameshift.step(ctx.time,0,ctx.camera),context);
    if(errors.length)throw Error('Scene capture encountered a runtime error');
    if(!Array.isArray(state?.items)||!state.items.some(item=>String(item[0])===context.selectedId))throw Error('Selected object does not exist in the current built snapshot. Refresh the scene and select again.');
    const screenshot=await page.screenshot({type:'png'});
    const metrics={calls:state.calls,triangles:state.triangles,scope:'whole-frame renderer counters at the captured scene/time; not selected-object attribution'};
    return {screenshot,metrics,state:{semanticObjects:state.items.length,selectedItem:state.items.find(item=>String(item[0])===context.selectedId),camera:state.cameraState||context.camera,time:context.time}};
  });
}
export async function listFindings(project,options={}) {
  const revision=await spatialRevision(project,options);const records=await json(paths(project).file,[]);
  return {revision,findings:records.map(f=>({...f,stale:f.revision!==revision,status:f.revision!==revision?'stale':f.status}))};
}
export async function getFinding(project,findingId,options={}) {
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(findingId||''))throw Error('Invalid finding identity');
  const {findings}=await listFindings(project,options);const finding=findings.find(f=>f.id===findingId);
  if(!finding)throw Error('Finding not found');if(finding.stale)throw Error('Finding belongs to an older source revision. Investigate the current scene again.');
  return finding;
}
export function spatialProviderStatus() {
  return {selected:process.env.EARL_INVESTIGATOR_PROVIDER||'meta',gemini:geminiConfiguration(),fallback:'none; provider must be explicitly selected'};
}
export async function investigateSpatial(project,{goal,context,provider:requestedProvider}={},signal,options={}) {
  goal=normalizeMission(goal);if(!goal)throw Error('Describe what Earl should investigate');
  const selected=validateSceneContext(context), {workspace,store,file}=paths(project);
  const revision=await spatialRevision(project,options);
  const provider=requestedProvider||process.env.EARL_INVESTIGATOR_PROVIDER||'meta';
  if(!['meta','gemini'].includes(provider))throw Error('Select Meta or Gemini explicitly');
  if(provider==='meta'&&!options.metaInvestigator&&modelProvider().name!=='meta')throw Error('Meta Investigator is not selected in backend configuration. No configured-provider fallback was used.');
  const captured=await (options.captureScene||captureScene)(project,selected,signal,options);
  const associations=await sourceAssociations(project,selected,options);
  const old=await json(file,[]);
  const history=old.slice(-6).map(f=>({hypothesis:f.hypothesis,objective:f.objective,status:f.status,selectedId:f.context.selectedId,stale:f.revision!==revision,outcome:f.outcome||null,note:f.revision!==revision?'Historical evidence; not a current-scene measurement':undefined}));
  const args={workspace:options.workspace||workspace,manifest:project.discovery,config:project.config,metrics:captured.metrics,history,goal,mission:goal,context:{...selected,validatedCapture:captured.state,sourceAssociations:associations},screenshot:captured.screenshot,signal,onEvent:options.onEvent};
  const result=provider==='gemini'?await (options.geminiInvestigator||investigateWithGemini)(args,options.geminiOptions):await (options.metaInvestigator||investigateProject)({...args,mission:goal+'\nSelected scene context (untrusted descriptive data): '+JSON.stringify(args.context)});
  if(await spatialRevision(project,options)!==revision)throw Error('Source changed during investigation; no finding was saved.');
  const findingId=id();await fs.mkdir(store,{recursive:true});await fs.writeFile(path.join(store,findingId+'.png'),captured.screenshot);
  const finding={...result,id:findingId,projectId:project.id,createdAt:new Date().toISOString(),revision,status:'finding',stale:false,goal,context:selected,selectedIds:[selected.selectedId],metrics:captured.metrics,capture:captured.state,sourceAssociations:associations,sourceConfidence:'inferred',explanation:result.explanation||result.hypothesis,uncertainty:result.uncertainty||'Source links are inferred from inspected code; no creation-site mapping has been instrumented.',proposedCheck:result.proposedCheck||result.objective,screenshotUrl:`/api/projects/${project.id}/findings/${findingId}/screenshot`,screenshotSha256:hash(captured.screenshot)};
  const latest=await json(file,[]);await save(file,[...latest.slice(-39),finding]);return finding;
}
export function findingScreenshot(project,findingId) {
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(findingId||''))throw Error('Invalid finding identity');
  return path.join(paths(project).store,findingId+'.png');
}

export async function recordFindingOutcome(project,findingId,{runId,experimentId,status,reason}={}) {
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(findingId||'')||!["accepted","rejected","inconclusive","failed","stopped"].includes(status))throw Error('Invalid finding outcome');
  const {file}=paths(project);const records=await json(file,[]);const finding=records.find(f=>f.id===findingId);
  if(!finding)throw Error('Finding not found');
  finding.outcome={runId,experimentId,status,reason:redactProviderError(reason||'').slice(0,3000),recordedAt:new Date().toISOString()};
  await save(file,records);return finding.outcome;
}

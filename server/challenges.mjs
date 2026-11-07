/** A challenge is an observable, replayable selection contract, never a model verdict. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { withPage } from './benchmark.mjs';
import { ROOT, compareState, save } from './core.mjs';
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function normalizeChallenge(input) {
  const context = input?.context;
  const expectedSelection = input?.expectedSelection || context?.selectedId;
  if (!context || typeof expectedSelection !== 'string' || !expectedSelection || expectedSelection.length > 300 || expectedSelection !== context.selectedId)
    throw Error('Select an actual scene object before creating a selection challenge.');
  if (!Number.isFinite(context.time) || context.time < 0 || context.time > 3600 || !context.camera)
    throw Error('The challenge needs a captured camera and simulation time.');
  const events = input.scenario?.events;
  if (!Array.isArray(events) || !events.length || events.length > 80 || !events.some(e=>e.type === 'click'))
    throw Error('Record at least one click; a challenge supports up to 80 events.');
  const allowedKeys = /^(?:[a-zA-Z0-9 ]|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Enter|Escape|Space|Shift|Control|Alt)$/;
  const normalized = events.map(e=>{
    if (!['click','pointerdown','pointerup','pointermove','keydown','keyup','wheel'].includes(e.type) || !Number.isFinite(e.at) || e.at < 0 || e.at > 60)
      throw Error('Invalid recorded challenge event.');
    const item = {type:e.type,at:e.at};
    if (e.type.startsWith('key')) { if(typeof e.key!=='string'||!allowedKeys.test(e.key))throw Error('Unsupported challenge key'); item.key=e.key==='Space'?' ':e.key; }
    else {
      if (![e.x,e.y].every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw Error('Challenge coordinates must be normalized.');
      item.x=e.x;item.y=e.y;
      if(e.type==='wheel'){if(!Number.isFinite(e.deltaY)||Math.abs(e.deltaY)>1000)throw Error('Invalid wheel delta');item.deltaY=e.deltaY;}
    }
    return item;
  }).sort((a,b)=>a.at-b.at);
  // Camera is data only; cap dimensions and reject non-finite components.
  const camera = context.camera;
  for(const [name,size] of [['position',3],['quaternion',4],['projection',16],['up',3]]) {
    if(!Array.isArray(camera[name])||camera[name].length!==size||!camera[name].every(n=>Number.isFinite(n)&&Math.abs(n)<1e7))throw Error('Invalid captured camera.');
  }
  return {version:1,expectedSelection,context:{selectedId:context.selectedId,time:context.time,camera},scenario:{events:normalized},scope:'Recorded semantic selection, scene transforms, picking and observable application state; no arbitrary natural-language correctness claim'};
}
export async function replayChallenge(directory, challenge, evidenceDir, label, signal) {
  return withPage(directory,signal,async(page,errors)=>{
    const canvas=page.locator('canvas').first();const box=await canvas.boundingBox();if(!box)throw Error('No scene canvas for challenge replay');
    for(const event of challenge.scenario.events){
      signal?.throwIfAborted();
      await page.evaluate(({time,camera})=>window.__frameshift.step(time,0,camera),{time:challenge.context.time+event.at,camera:challenge.context.camera});
      const x=box.x+(event.x??.5)*box.width,y=box.y+(event.y??.5)*box.height;
      if(event.type==='click')await page.mouse.click(x,y);
      else if(event.type==='pointermove')await page.mouse.move(x,y);
      else if(event.type==='pointerdown'){await page.mouse.move(x,y);await page.mouse.down();}
      else if(event.type==='pointerup'){await page.mouse.move(x,y);await page.mouse.up();}
      else if(event.type==='wheel')await page.mouse.wheel(0,event.deltaY);
      else if(event.type==='keydown')await page.keyboard.down(event.key);
      else if(event.type==='keyup')await page.keyboard.up(event.key);
    }
    const result=await page.evaluate(({time,camera})=>{
      const api=window.__frameshift;const state=api.step(time,0,camera);const interaction=api.interactionState?.()||state.interactionState;
      const selected=interaction?.selected??api.spatialContext?.()?.selectedId??null;
      return {state,interaction,selected};
    },{time:challenge.context.time+(challenge.scenario.events.at(-1)?.at||0),camera:challenge.context.camera});
    const image=label+'.png';await page.screenshot({path:path.join(evidenceDir,image)});
    return {...result,errors,image};
  });
}
export function challengeVerdict(challenge, reference, candidate) {
  const referenceValid=reference.selected===challenge.expectedSelection&&!reference.errors.length;
  const candidateValid=candidate.selected===challenge.expectedSelection&&!candidate.errors.length;
  const statePass=compareState(reference.state,candidate.state);
  const applicationStatePass=JSON.stringify(reference.interaction)===JSON.stringify(candidate.interaction);
  const status=!referenceValid?'inconclusive':candidateValid&&statePass&&applicationStatePass?'passed':'rejected';
  return {status,referenceValid,candidateValid,statePass,applicationStatePass,expectedSelection:challenge.expectedSelection,observed:{reference:reference.selected,candidate:candidate.selected},testedTargets:challenge.scenario.events.filter(e=>e.type==='click').map(e=>({x:e.x,y:e.y,time:challenge.context.time+e.at})),scope:challenge.scope};
}
export async function runChallenge({referenceDirectory,candidateDirectory,challenge,evidenceDir,signal}) {
  await fs.mkdir(evidenceDir,{recursive:true});
  const implementationFiles=['server/challenges.mjs','server/benchmark.mjs','server/core.mjs','sdk/runtime.mjs','sdk/spatial.mjs'];
  const snapshot=async()=>Object.fromEntries(await Promise.all(implementationFiles.map(async name=>[name,crypto.createHash('sha256').update(await fs.readFile(path.join(ROOT,name))).digest('hex')])));
  const implementations=await snapshot();
  const reference=await replayChallenge(referenceDirectory,challenge,evidenceDir,'challenge-reference',signal);
  const candidate=await replayChallenge(candidateDirectory,challenge,evidenceDir,'challenge-candidate',signal);
  if(JSON.stringify(await snapshot())!==JSON.stringify(implementations))throw Error('Challenge verification implementation changed; record and test again.');
  const artifacts={};for(const name of ['challenge-reference.png','challenge-candidate.png']){const bytes=await fs.readFile(path.join(evidenceDir,name));artifacts[name]={sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length};}
  const result={...challengeVerdict(challenge,reference,candidate),implementations,artifacts,completedAt:new Date().toISOString(),contractHash:hash(challenge),reference,candidate};
  await save(path.join(evidenceDir,'challenge-result.json'),result);return result;
}

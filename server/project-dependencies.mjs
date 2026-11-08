import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
const pending = new Map();
export async function hasProjectDependencies(folder, pkg) {
  for (const name of Object.keys({...pkg.dependencies,...pkg.devDependencies})) {
    if (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)) return false;
    try { await fs.access(path.join(folder,name,'package.json')); } catch { return false; }
  }
  return Boolean(await fs.stat(folder).catch(()=>null));
}
function install(folder) {
  const env = Object.fromEntries(['PATH','LANG','LC_ALL','SYSTEMROOT','TMPDIR'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  Object.assign(env,{NPM_CONFIG_USERCONFIG:'/dev/null',NPM_CONFIG_CACHE:path.join(folder,'.npm-cache'),NPM_CONFIG_AUDIT:'false',NPM_CONFIG_FUND:'false'});
  return new Promise((resolve,reject)=>{
    const child=spawn(process.platform==='win32'?'npm.cmd':'npm',['install','--ignore-scripts','--include=dev','--no-audit','--no-fund'],{cwd:folder,env,stdio:['ignore','pipe','pipe']});
    let output='';const timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Dependency install timed out. Install dependencies locally and retry.'));},180000);
    for(const stream of [child.stdout,child.stderr])stream.on('data',b=>output=(output+b).slice(-2000));
    child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Project dependency installation failed: '+output))});
  });
}
// Called only after explicit project trust/connect. Inspection does not call this.
export async function projectModules(original,{root,data,installer=install}={}) {
  const pkgText=await fs.readFile(path.join(original,'package.json'),'utf8'),pkg=JSON.parse(pkgText);
  const local=path.join(original,'node_modules');
  if(await hasProjectDependencies(local,pkg))return local;
  const bundled=path.relative(root,original).split(path.sep);
  if(['examples','tests'].includes(bundled[0]) && await hasProjectDependencies(path.join(root,'node_modules'),pkg))return path.join(root,'node_modules');
  if(pkg.workspaces)throw Error('Workspace/monorepo installs need a prepared local project with dependencies installed. Upload a standalone Vite project.');
  for(const [name,version] of Object.entries({...pkg.dependencies,...pkg.devDependencies})) {
    if(!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name)||typeof version!=='string'||/^(?:file:|link:|workspace:|git|https?:|\.\.?\/|\/)/i.test(version))throw Error('Automatic installation supports registry packages only. Prepare local dependencies for '+name+'.');
  }
  const lock=await fs.readFile(path.join(original,'package-lock.json'),'utf8').catch(()=>null);
  const key=crypto.createHash('sha256').update(pkgText+'\n'+(lock||'')).digest('hex'),cache=path.join(data,'dependencies',key);
  if(await fs.stat(path.join(cache,'.ready')).catch(()=>null))return path.join(cache,'node_modules');
  if(!pending.has(key))pending.set(key,(async()=>{
    await fs.mkdir(cache,{recursive:true});
    const stats=await fs.statfs(cache);if(stats.bavail*stats.bsize<250*1024*1024)throw Error('Not enough free disk space to install this project. Free at least 1 GB and retry.');
    await fs.writeFile(path.join(cache,'package.json'),pkgText);if(lock)await fs.writeFile(path.join(cache,'package-lock.json'),lock);
    await installer(cache);
    if(!await hasProjectDependencies(path.join(cache,'node_modules'),pkg))throw Error('Installed dependencies are incomplete. Check project dependency declarations.');
    await fs.writeFile(path.join(cache,'.ready'),'installed with lifecycle scripts disabled\n');return path.join(cache,'node_modules');
  })().finally(()=>pending.delete(key)));
  return pending.get(key);
}

import fs from 'node:fs/promises';
import {buildInstrumented} from './integration.mjs';
const [workspace,settings]=process.argv.slice(2);
try{await buildInstrumented(workspace,JSON.parse(await fs.readFile(settings,'utf8')),{onLog:line=>process.stdout.write(String(line)+'\n')})}catch(e){console.error(String(e.message));process.exitCode=1}

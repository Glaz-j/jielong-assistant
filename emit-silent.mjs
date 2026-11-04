// Simulation harness. This is not a WeChat message listener.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseActivity} from './core.mjs';
const [dirArg,group,url]=process.argv.slice(2);
if(!dirArg||!group||!url)throw Error('Usage: node emit-silent.mjs <data-dir> <group> <official-url>');
const dir=path.resolve(dirArg,'inbox');await fs.mkdir(dir,{recursive:true});
const event={source:'simulation',eventId:randomUUID(),group,url:parseActivity(url).url,emittedAt:new Date().toISOString()};
const file=path.join(dir,event.eventId+'.json');
await fs.writeFile(file+'.tmp',JSON.stringify(event),{mode:0o600});await fs.rename(file+'.tmp',file);
console.log(JSON.stringify({eventId:event.eventId,source:event.source,emittedAt:event.emittedAt}));

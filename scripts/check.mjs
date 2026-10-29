import {readFile,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {Script} from 'node:vm';
import path from 'node:path';
const html=await readFile('team.html','utf8');
for(const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))if(script[1].trim())new Script(script[1]);
JSON.parse(await readFile('manifest.webmanifest','utf8'));
for(const folder of ['php','public','scripts'])for(const file of await readdir(folder))if(file.endsWith('.php')){
 const result=spawnSync(process.env.PHP_BINARY||'php',['-l',path.join(folder,file)],{stdio:'inherit'});
 if(result.status!==0)process.exit(result.status||1);
}
console.log('PHP, frontend JavaScript and manifest checks passed.');

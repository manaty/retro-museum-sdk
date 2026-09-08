#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {readFile,writeFile,appendFile,realpath,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute} from 'node:path';
import {manifest} from './manifest.js';

export function validateIsolated(file) {
 return new Promise((done,reject)=>{
  const child=spawn(process.execPath,['--max-old-space-size=256',fileURLToPath(new URL('./validate-worker.js',import.meta.url)),resolve(file)],{env:{},windowsHide:true,stdio:['ignore','pipe','ignore']});
  let output='',killed=false;
  const timer=setTimeout(()=>{killed=true;child.kill();},20000);
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>64000){killed=true;child.kill();}});
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('close',()=>{clearTimeout(timer);if(killed)return reject(Error('Validation exceeded its 20-second limit.'));try{done(JSON.parse(output));}catch{reject(Error('Validator exited without a valid report.'));}});
 });
}
export async function validateDirectory(directory) {
 const root=await realpath(directory);
 async function inside(name){const path=await realpath(resolve(root,name));const rel=relative(root,path);if(isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../'))throw Error('Package files must stay inside the repository.');return path;}
 const manifestPath=await inside('retro-museum.json');
 if((await stat(manifestPath)).size>16000)throw Error('Manifest exceeds 16 KB.');
 const declared=manifest(JSON.parse(await readFile(manifestPath,'utf8')));
 const file=await inside('dist/game.rmg.json');
 const report=await validateIsolated(file);
 if(report.status==='passed'){
  const pack=JSON.parse(await readFile(file,'utf8'));
  if(JSON.stringify(declared)!==JSON.stringify(pack.manifest))throw Error('Rebuild the package: its manifest differs from retro-museum.json.');
 }
 return report;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let report;
 try{report=await validateDirectory(process.argv[2]||'.');}catch(error){report={schemaVersion:1,status:'failed',error:String(error.message).slice(0,1500)};}
 const output=resolve(process.env.RUNNER_TEMP||'.','retro-museum-report.json');
 await writeFile(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`status=${report.status}\nsha256=${report.sha256||''}\nreport=${output}\n`);
 if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,`## Retro Museum prevalidation\n\n**${report.status==='passed'?'Passed':'Failed'}**\n\n${report.sha256?'Artifact SHA-256: `'+report.sha256+'`':''}\n\nThis checks package compatibility. Marketplace publication requires a separate independent technical and editorial review. See the report artifact for details.\n`);
 if(report.status!=='passed')process.exitCode=1;
}

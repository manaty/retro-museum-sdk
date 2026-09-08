import {createHash} from 'node:crypto';
export const MAX_PACKAGE_BYTES=24*1024*1024;
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
export function repository(input){
 const url=new URL(input);
 const match=/^\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})\/?$/.exec(url.pathname);
 if(url.protocol!=='https:'||url.hostname!=='github.com'||url.port||url.username||url.password||url.search||url.hash||!match)throw new Error('Use a public https://github.com/owner/repository URL.');
 const owner=match[1].toLowerCase(),repo=match[2].replace(/\.git$/,'').toLowerCase();
 if(!repo||repo==='.'||repo==='..')throw new Error('Invalid repository.');
 return {owner,repo,fullName:`${owner}/${repo}`,url:`https://github.com/${owner}/${repo}`};
}
export function manifest(value,{allowNative=false}={}){
 if(!object(value)||value.schemaVersion!==1)throw new Error('retro-museum.json must use schemaVersion 1.');
 if(!/^[a-z][a-z0-9-]{2,48}$/.test(value.id)||!/^\d+\.\d+\.\d+$/.test(value.version))throw new Error('Invalid game ID or version.');
 for(const key of ['title','description'])if(!object(value[key])||typeof value[key].en!=='string'||!value[key].en.trim()||Object.values(value[key]).some(x=>typeof x!=='string'||x.length>(key==='title'?100:1000)))throw new Error(`Invalid ${key}. English is required.`);
 if(!['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','ISC','MPL-2.0','GPL-3.0-only','AGPL-3.0-only'].includes(value.license))throw new Error('Declare a supported open-source SPDX license.');
 if(!Array.isArray(value.languages)||!value.languages.includes('en')||value.languages.some(x=>!['en','fr','tl'].includes(x)))throw new Error('Invalid languages.');
 if(!object(value.players)||!Number.isInteger(value.players.min)||value.players.min<1||value.players.min>32||(value.players.max!==null&&(!Number.isInteger(value.players.max)||value.players.max<value.players.min||value.players.max>32)))throw new Error('Player maximum must be 1–32, or null for a host-limited activity.');
 if(!Number.isInteger(value.durationMinutes)||value.durationMinutes<1||value.durationMinutes>120)throw new Error('Duration must be 1–120 minutes.');
 if(!(value.runtime==='quickjs-v1'||allowNative&&value.runtime==='native-v1')||value.entry!=='dist/game.rmg.json')throw new Error('Expected quickjs-v1 and dist/game.rmg.json. Native engines require an explicitly configured trusted host.');
 if(!Array.isArray(value.permissions)||value.permissions.length)throw new Error('SDK v1 permits no external network, filesystem or host permissions.');
 if(typeof value.author!=='string'||!value.author.trim()||value.author.length>100)throw new Error('Author is required.');
 if(value.introMs!==undefined&&(!Number.isInteger(value.introMs)||value.introMs<0||value.introMs>60000))throw new Error('Invalid introduction duration.');
 if(value.options!==undefined){
  if(!object(value.options)||Object.keys(value.options).length>8)throw new Error('Invalid game options.');
  for(const [key,option] of Object.entries(value.options)){
   if(!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(key)||!object(option)||!object(option.label)||typeof option.label.en!=='string'||Object.values(option.label).some(x=>typeof x!=='string'||x.length>100)||!(option.type==='integer'?Number.isInteger(option.min)&&Number.isInteger(option.max)&&option.min>=1&&option.max<=100&&option.min<=option.max&&Number.isInteger(option.default)&&option.default>=option.min&&option.default<=option.max:Array.isArray(option.values)&&option.values.length>0&&option.values.length<=10&&option.values.every(x=>typeof x==='string'&&x.length<=50||typeof x==='number'&&Number.isFinite(x)||typeof x==='boolean')&&option.values.includes(option.default)))throw new Error('Invalid game option: '+key);
  }
 }
 return JSON.parse(JSON.stringify(value));
}
export function parsePackage(bytes,options){
 if(Buffer.byteLength(bytes)>MAX_PACKAGE_BYTES)throw new Error('Package exceeds 24 MB.');
 const pack=JSON.parse(bytes),m=manifest(pack.manifest,options);
 if(typeof pack.engine!=='string'||pack.engine.length>512000||!pack.engine.trim())throw new Error('Missing or oversized engine bundle.');
 if(typeof pack.view!=='string'||pack.view.length>1500000||!pack.view.includes('<html'))throw new Error('A complete view HTML document is required.');
 if(typeof pack.licenseText!=='string'||pack.licenseText.length<100||pack.licenseText.length>100000)throw new Error('Include full license and attribution text.');
 if(!object(pack.assets)||Object.keys(pack.assets).length>250)throw new Error('Invalid assets.');
 const allowed={'image/png':'png','image/jpeg':'jpg','audio/mpeg':'mp3','font/woff2':'woff2'};
 let assetBytes=0;
 for(const [path,asset] of Object.entries(pack.assets)){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,180}$/.test(path)||path.split('/').some(x=>!x||x==='.'||x==='..')||!object(asset)||!allowed[asset.type]||!path.endsWith('.'+allowed[asset.type])||typeof asset.data!=='string'||asset.data.length%4!==0||/[^A-Za-z0-9+/=]/.test(asset.data)||Buffer.from(asset.data,'base64').toString('base64')!==asset.data)throw new Error(`Invalid asset: ${path}`);
  assetBytes+=Buffer.byteLength(asset.data,'base64');
 }
 if(assetBytes>18*1024*1024)throw new Error('Assets exceed 18 MB.');
 return {...pack,manifest:m};
}

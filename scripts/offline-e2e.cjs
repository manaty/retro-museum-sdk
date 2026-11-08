const {chromium}=require('playwright');const {spawn}=require('child_process');
// Browser check of offline play: two devices download, the origin server stops,
// then an organiser hosts UNO and Werewolves and players pair by codes over WebRTC.
// Usage: node scripts/offline-e2e.cjs ../game-uno/dist/game.rmg.json ../game-werewolf/dist/game.rmg.json
// Requires Playwright with Chromium (resolved from NODE_PATH or a local install).
const path=require('path'),os=require('os'),fs=require('fs');
const SDK=path.resolve(__dirname,'..'),[UNO,WEREWOLF]=process.argv.slice(2).map(p=>path.resolve(p)),PORT=Number(process.env.PORT)||4399,ORIGIN='http://localhost:'+PORT;
if(!UNO||!WEREWOLF){console.error('Usage: node scripts/offline-e2e.cjs UNO_PACKAGE WEREWOLF_PACKAGE');process.exit(2);}
const DATA=fs.mkdtempSync(path.join(os.tmpdir(),'rm-offline-'));
const log=(...a)=>console.log('[e2e]',...a);
let server;
(async()=>{
 server=spawn(process.execPath,[SDK+'/serve.js','--package',UNO,'--package',WEREWOLF],{env:{...process.env,PORT:String(PORT),DATA_DIR:DATA},stdio:['ignore','pipe','inherit']});
 await new Promise(r=>server.stdout.on('data',d=>{if(String(d).includes('ready'))r();}));
 const browser=await chromium.launch({args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const errors=[];
 async function device(name,downloadGames=true){
  const ctx=await browser.newContext({permissions:['camera']});const page=await ctx.newPage();ctx.on('requestfailed',r=>errors.push(name+' FAILED '+r.url()+' '+r.failure()?.errorText));ctx.on('response',r=>{if(r.status()>=400)errors.push(name+' HTTP '+r.status()+' '+r.url());});
  page.on('pageerror',e=>errors.push(name+': '+e.message));page.on('console',m=>{if(m.type()==='error')errors.push(name+' console: '+m.text());});
  await page.goto(ORIGIN+'/');await page.waitForFunction(()=>navigator.serviceWorker.controller,null,{timeout:15000}).catch(async()=>{await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller,null,{timeout:15000});});
  await page.reload();await page.waitForSelector('[data-download]');
  if(downloadGames){await page.click('[data-download]');await page.waitForFunction(()=>/2 \/ 2/.test(document.querySelector('[data-offline-status]').textContent),null,{timeout:60000});
  log(name,'downloaded:',await page.textContent('[data-offline-status]'));}
  return {ctx,page};
 }
 const A=await device('organiser'),B=await device('player',false);
 // No Internet from here: the origin server is gone, only the local network remains.
 server.kill();await new Promise(r=>setTimeout(r,500));log('server stopped');
 // Organiser creates an offline UNO room without network.
 await A.page.reload();await A.page.waitForSelector('[data-offline-mode]');
 await A.page.check('[data-offline-mode]');
 await A.page.click('article[data-game-id="uno"] [data-play-mode="together"]');
 await A.page.waitForURL(/\/r\/[a-f0-9]{12}$/,{timeout:20000});log('organiser room',A.page.url());
 await A.page.waitForFunction(()=>document.querySelector('[data-offer-code]')?.value?.includes('#rtc='),null,{timeout:20000});
 const offerUrl=await A.page.inputValue('[data-offer-code]');log('offer url length',offerUrl.length);
 // Player opens the invitation offline and shows the answer.
 await B.page.goto(offerUrl);
 await B.page.waitForFunction(()=>document.querySelector('[data-answer-code]')?.value,null,{timeout:20000});
 const answer=await B.page.inputValue('[data-answer-code]');log('answer length',answer.length);
 await A.page.evaluate(()=>{document.querySelectorAll('.offline-pairing details').forEach(d=>d.open=true);});
 await A.page.fill('[data-player-code]',answer);await A.page.click('[data-use-player-code]');
 await A.page.waitForFunction(()=>/Wi-Fi: 1|Wi-Fi : 1/.test(document.querySelector('.offline-count')?.textContent||''),null,{timeout:30000});
 log('organiser status:',await A.page.textContent('.offline-status'));
 await B.page.waitForFunction(()=>document.querySelector('.offline-overlay')?.hidden,null,{timeout:20000});
 await B.page.waitForSelector('.stage iframe',{timeout:20000});
 await B.page.waitForFunction(()=>document.querySelector('#connection')?.dataset.online==='true',null,{timeout:20000});
 log('player connected:',await B.page.textContent('#connection'));
 // Organiser also plays on this device (second tab = follower over BroadcastChannel).
 const [tab]=await Promise.all([A.ctx.waitForEvent('page'),A.page.click('.play-here')]);
 tab.on('pageerror',e=>errors.push('organiser-tab: '+e.message));
 await tab.waitForFunction(()=>document.querySelector('#connection')?.dataset.online==='true',null,{timeout:30000});log('organiser player tab connected');
 await A.page.waitForFunction(()=>!document.querySelector('[data-control="start"]')?.disabled,null,{timeout:20000});
 await A.page.click('[data-control="start"]');
 await B.page.waitForTimeout(5000);
 const frameInfo=async page=>{const f=page.frames().find(f=>f!==page.mainFrame());return f?await f.evaluate(()=>({len:document.body.innerHTML.length,text:document.body.innerText.slice(0,120)})):null;};
 log('player view',JSON.stringify(await frameInfo(B.page)));
 log('organiser display view',JSON.stringify(await frameInfo(A.page)));
 const phase=await A.page.evaluate(()=>document.body.innerText.slice(0,300));log('organiser text',phase.replace(/\s+/g,' ').slice(0,200));
 // A second offline game from another tab (follower) with packaged images and audio.
 const W=await A.ctx.newPage();await W.goto(ORIGIN+'/');await W.waitForTimeout(4000);log('W landing',(await W.evaluate(()=>[...document.querySelectorAll('article.game')].map(a=>a.dataset.gameId+': '+a.querySelector('.game-actions').innerText.replace(/\s+/g,' ')).join(' | ')+' || '+(document.querySelector('[data-offline-status]')?.textContent)+' || '+document.querySelector('#main').innerText.slice(0,200))));await W.waitForSelector('article[data-game-id="werewolf-village"] [data-play-mode="together"]');
 await W.click('article[data-game-id="werewolf-village"] [data-play-mode="together"]');await W.waitForURL(/\/r\/[a-f0-9]{12}$/,{timeout:30000});
 await W.waitForFunction(()=>{const f=document.querySelector('.stage iframe');return f&&f.srcdoc;},null,{timeout:30000});await W.waitForTimeout(6000);
 const wf=W.frames().find(f=>f!==W.mainFrame());log('werewolf view',JSON.stringify(await wf.evaluate(()=>({blobs:(document.documentElement.outerHTML.match(/blob:/g)||[]).length,imgs:[...document.images].filter(i=>i.complete&&i.naturalWidth>0).length,text:document.body.innerText.slice(0,100)}))));
 log('werewolf side',(await W.textContent('.room-side')).replace(/\s+/g,' ').slice(0,160));
 await W.screenshot({path:path.join(DATA,'werewolf.png')});
 // Large package transfer: a player without the 20 MB game joins the werewolf room.
 const wid=new URL(W.url()).pathname.split('/')[2];
 await A.page.evaluate(id=>window.RetroMuseumOfflineRuntime.openPairing({room:{id},language:()=>'en'}),wid);
 await A.page.waitForFunction(()=>document.querySelectorAll('[data-offer-code]')[1]?.value?.includes('#rtc='),null,{timeout:20000});
 const wOffer=await A.page.evaluate(()=>document.querySelectorAll('[data-offer-code]')[1].value);
 const C=await B.ctx.newPage();C.on('pageerror',e=>errors.push('player2: '+e.message));const t0=Date.now();
 await C.goto(wOffer);await C.waitForFunction(()=>document.querySelector('[data-answer-code]')?.value,null,{timeout:20000});
 const wAnswer=await C.inputValue('[data-answer-code]');
 await A.page.evaluate(code=>{const box=document.querySelectorAll('[data-player-code]')[1];box.value=code;document.querySelectorAll('[data-use-player-code]')[1].click();},wAnswer);
 await C.waitForFunction(()=>{const f=document.querySelector('.stage iframe');return f&&f.srcdoc;},null,{timeout:60000});
 await C.waitForFunction(()=>{const f=document.querySelector('.stage iframe');try{return /Werewolves/.test(f.contentDocument?.body?.innerText||'')}catch{return false}},null,{timeout:5000}).catch(()=>{});
 for(let i=0;i<60;i++){const fr=C.frames().find(f=>f!==C.mainFrame());const txt=fr?await fr.evaluate(()=>document.body?.innerText||'').catch(()=>''):'';if(/Werewolves/.test(txt)){log('werewolf player view after',Date.now()-t0,'ms:',txt.replace(/\s+/g,' ').slice(0,80));break;}await C.waitForTimeout(1000);}
 await A.page.bringToFront();
 await A.page.screenshot({path:path.join(DATA,'organiser.png')});await B.page.screenshot({path:path.join(DATA,'player.png')});await tab.screenshot({path:path.join(DATA,'organiser-tab.png')});
 const unexpected=errors.filter(e=>!/ERR_CONNECTION_REFUSED|browser\/report|status of 404| csp$/.test(e));log('screenshots in',DATA);log('unexpected errors',unexpected);if(unexpected.length)process.exitCode=1;
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{server?.kill();process.exit();});

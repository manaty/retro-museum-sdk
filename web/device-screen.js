import {invitationDialog} from './share.js';
const words={
 button:['Use another device','Utiliser un autre appareil','Gumamit ng ibang device'],
 board:['Shared board','Plateau partagé','Shared board'],
 personal:['My personal screen','Mon écran personnel','Personal kong screen'],
 boardHelp:['Scan on another device to show the shared board. No player is added.','Scannez sur un autre appareil pour y afficher le plateau partagé. Aucun joueur n’est ajouté.','I-scan sa ibang device para ipakita ang shared board. Walang idadagdag na player.'],
 personalHelp:['Scan to use your current player on another device. Private link, valid once for 5 minutes. Organiser controls stay here.','Scannez pour retrouver votre joueur sur un autre appareil. Lien privé, utilisable une fois pendant 5 minutes. Les commandes organisateur restent ici.','I-scan para gamitin ang kasalukuyang player sa ibang device. Pribadong link, isang gamit sa loob ng 5 minuto.'],
 keepControls:['Keep only my controls here','Garder seulement mes commandes ici','Mga kontrol lang dito'],
 keepBoard:['Show only the board here','Afficher seulement le plateau ici','Board lang dito'],
 linkHelp:['Copy the link or scan the QR code.','Copiez le lien ou scannez le QR code.','Kopyahin ang link o i-scan ang QR code.']
};
export function createDeviceScreenButton({toolbar,base,room,language,credential,personalScreen,api,notice}){
 const text=key=>words[key][{en:0,fr:1,tl:2}[language()]??0];
 const button=document.createElement('button');button.type='button';button.className='device-screen-button';button.title=text('button');button.setAttribute('aria-label',text('button'));button.dataset.deviceScreen='';toolbar.append(button);
 let dialog,busy=false;
 const update=()=>{button.replaceChildren();const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','18');icon.setAttribute('height','18');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.8');icon.setAttribute('aria-hidden','true');icon.innerHTML='<rect x="2" y="3" width="14" height="11" rx="2"/><path d="M6 18h6M9 14v4"/><rect x="16" y="10" width="6" height="11" rx="1"/>';const label=document.createElement('span');label.textContent=text('button');button.append(icon,label);button.title=text('button');button.setAttribute('aria-label',text('button'));};update();
 async function show(mode='board'){
  if(busy)return;busy=true;
  try{
   let url=new URL(base+'/r/'+room.id+'?view=screen',location.origin).href,qrUrl=base+'/api/rooms/'+room.id+'/qr?view=screen';
   if(mode==='personal')({url,qrUrl}=await api('/api/rooms/'+room.id+'/handoff',{},credential()));
   dialog?.close();
   const content=document.createElement('div');content.className='device-screen-options';
   for(const key of ['board','personal']){const tab=document.createElement('button');tab.type='button';tab.textContent=text(key);tab.setAttribute('aria-pressed',String(mode===key));tab.onclick=()=>show(key);content.append(tab);}
   const local=document.createElement('button');local.type='button';local.className='device-screen-local';local.textContent=text(mode==='board'?'keepControls':'keepBoard');
   local.onclick=()=>{if(mode==='board'){personalScreen.setEnabled(false);dialog.close();}else location.assign(new URL(base+'/r/'+room.id+'?view=screen',location.origin));};content.append(local);
   dialog=invitationDialog({url,qrUrl,language:language(),title:'',returnFocus:button,onClose:()=>dialog=null,content,labels:{invite:text('button'),scan:text(mode==='board'?'boardHelp':'personalHelp'),manual:text('linkHelp'),copied:language()==='fr'?'Lien copié':'Link copied',message:text(mode==='board'?'board':'personal')}});
   content.closest('.invite-link-dialog').classList.add('device-link-dialog');dialog.setStatus({status:'manual'});
  }catch(error){notice(error.message);}finally{busy=false;}
 }
 button.onclick=()=>dialog?dialog.focus():show();return {update};
}

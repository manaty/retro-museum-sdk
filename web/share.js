const words={
 invite:['Invite a player','Inviter un joueur','Mag-imbita ng manlalaro'],
 message:['Join my game on Retro Museum!','Rejoins ma partie sur Retro Museum !','Sumali sa laro ko sa Retro Museum!'],
 copied:['Invitation link copied','Lien d’invitation copié','Nakopya ang link ng imbitasyon'],
 shared:['Invitation shared','Invitation partagée','Naibahagi ang imbitasyon'],
 manual:['Copy this link and send it to your friend.','Copie ce lien et envoie-le à ton ami.','Kopyahin ang link at ipadala sa kaibigan mo.'],
 close:['Close','Fermer','Isara'],
 scan:['Scan this QR code to join the game.','Scannez ce QR code pour rejoindre la partie.','I-scan ang QR code para sumali sa laro.'],
 copy:['Copy link','Copier le lien','Kopyahin ang link'],
 share:['Share…','Partager…','Ibahagi…'],
 qrUnavailable:['The QR code could not load. You can still copy the invitation link.','Le QR code n’a pas pu charger. Vous pouvez toujours copier le lien d’invitation.','Hindi ma-load ang QR code. Maaari mo pa ring kopyahin ang link.']
};
export const inviteText=(language,key)=>words[key][{en:0,fr:1,tl:2}[language]??0];
function invitationUrl(url){
 const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error('Invalid invitation URL');return parsed.href;
}
export async function shareInvitation({url,title='Retro Museum',language='en',navigator:nav=globalThis.navigator,document:doc=globalThis.document,nativeShare=true}){
 const data={title,text:inviteText(language,'message'),url:invitationUrl(url)};
 if(nativeShare&&typeof nav?.share==='function'){try{if(!nav.canShare||nav.canShare(data)){await nav.share(data);return {status:'shared',url:data.url};}}catch(error){if(error.name==='AbortError')return {status:'cancelled',url:data.url};}}
 try{if(!nav?.clipboard?.writeText)throw Error('Clipboard unavailable');await nav.clipboard.writeText(data.url);return {status:'copied',url:data.url};}catch{}
 if(doc){const input=doc.createElement('textarea');input.value=data.url;input.setAttribute('readonly','');input.style.cssText='position:fixed;left:0;top:0;opacity:0';doc.body.appendChild(input);input.select();let copied=false;try{copied=Boolean(doc.execCommand?.('copy'));}catch{}input.remove();if(copied)return {status:'copied',url:data.url};}
 return {status:'manual',url:data.url};
}

export function invitationDialog({url,qrUrl,language,title,returnFocus,onClose,labels={},content}){
 const text=key=>labels[key]||inviteText(language,key),overlay=document.createElement('div');
 overlay.className='invite-link-dialog';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label',text('invite'));
 overlay.style.cssText='position:fixed;inset:0;z-index:2000;background:#000c;display:flex;align-items:center;justify-content:center;padding:16px';
 const card=document.createElement('section');card.className='invitation-card';
 card.style.cssText='background:#161426;color:#f0edff;padding:22px;padding:var(--invitation-padding,22px);border:1px solid #766296;border-radius:16px;width:100%;max-width:400px;max-width:var(--invitation-width,400px);max-height:calc(100% - 16px);overflow:auto;box-sizing:border-box';
 const header=document.createElement('div');header.className='invitation-heading';
 const heading=document.createElement('h2');heading.textContent=text('invite');
 const close=document.createElement('button');close.type='button';close.className='invitation-close';close.textContent='×';close.setAttribute('aria-label',text('close'));close.title=text('close');
 header.append(heading,close);card.append(header);
 if(title){const game=document.createElement('p');game.className='invitation-game';game.textContent=title;card.append(game);}
 if(qrUrl){
  const label=document.createElement('p');label.className='invitation-instruction';label.textContent=text('scan');
  const frame=document.createElement('div');frame.className='invitation-qr';
  const image=document.createElement('img');image.src=qrUrl;image.width=image.height=220;image.alt=text('scan');
  image.onerror=()=>{frame.hidden=true;label.textContent=text('qrUnavailable');};
  frame.append(image);card.append(label,frame);
 }
 const status=document.createElement('p');status.className='invitation-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const input=document.createElement('input');input.className='invitation-url';input.value=url;input.readOnly=true;input.setAttribute('aria-label',text('invite'));input.onclick=()=>input.select();
 const actions=document.createElement('div');actions.className='invitation-actions';
 const copy=document.createElement('button');copy.type='button';copy.className='primary';copy.textContent=text('copy');copy.dataset.invitationCopy='';
 actions.append(copy);
 if(typeof navigator.share==='function'){
  const share=document.createElement('button');share.type='button';share.textContent=text('share');share.dataset.invitationShare='';actions.append(share);
  share.onclick=async()=>{share.disabled=true;try{const result=await shareInvitation({url,title,language});if(result.status!=='cancelled')setStatus(result);}finally{share.disabled=false;}};
 }
 card.append(status,input,actions);if(content)card.insertBefore(content,header.nextSibling);overlay.append(card);
 const oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
 function dismiss(){overlay.remove();document.removeEventListener('keydown',keyDown);document.body.style.overflow=oldOverflow;onClose();if(returnFocus.isConnected)returnFocus.focus();}
 function keyDown(event){
  if(event.key==='Escape'){event.preventDefault();dismiss();return;}
  if(event.key!=='Tab')return;
  const items=Array.from(card.querySelectorAll('button:not([disabled]),input')),first=items[0],last=items[items.length-1];
  if(event.shiftKey&&(document.activeElement===first||!card.contains(document.activeElement))){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&(document.activeElement===last||!card.contains(document.activeElement))){event.preventDefault();first.focus();}
 }
 function setStatus(result){
  status.textContent=text(result.status==='copied'?'copied':result.status==='shared'?'shared':'manual');
  if(!overlay.isConnected)return;
  if(result.status==='manual'){input.focus();input.select();}
  else if(!overlay.contains(document.activeElement))close.focus();
 }
 copy.onclick=async()=>{copy.disabled=true;try{setStatus(await shareInvitation({url,title,language,nativeShare:false}));}finally{copy.disabled=false;}};
 close.onclick=dismiss;overlay.onclick=event=>{if(event.target===overlay)dismiss();};
 document.addEventListener('keydown',keyDown);document.body.append(overlay);close.focus();
 return {setStatus,close:dismiss,focus:()=>close.focus()};
}

export function createInviteButton({container,url,qrUrl,language=()=> 'en',title=()=> 'Retro Museum',beforeShare=()=>{},notice=()=>{},buttonClass=''}){
 const button=document.createElement('button');button.type='button';button.className=buttonClass;button.dataset.invitePlayer='';
 const icon='<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m8 10 8-5M8 14l8 5"/><circle cx="5" cy="12" r="3"/><circle cx="19" cy="4" r="3"/><circle cx="19" cy="20" r="3"/></svg>';
 let busy=false,lastLabel,dialog;
 const update=()=>{const text=inviteText(language(),'invite');if(text!==lastLabel){button.innerHTML=icon+'<span>'+text+'</span>';button.setAttribute('aria-label',text);lastLabel=text;}button.disabled=busy||!url();};
 button.onclick=async()=>{
  if(dialog){dialog.focus();return;}if(busy||!url())return;
  busy=true;button.disabled=true;
  try{
   beforeShare();const link=invitationUrl(url()),locale=language(),gameTitle=title();
   if(qrUrl)dialog=invitationDialog({url:link,qrUrl:qrUrl(),language:locale,title:gameTitle,returnFocus:button,onClose:()=>dialog=null});
   const result=await shareInvitation({url:link,title:gameTitle,language:locale,nativeShare:!qrUrl});
   if(result.status==='copied')notice(inviteText(locale,'copied'));
   if(dialog)dialog.setStatus(result);
   else if(!qrUrl&&result.status==='manual'){dialog=invitationDialog({url:result.url,language:locale,title:gameTitle,returnFocus:button,onClose:()=>dialog=null});dialog.setStatus(result);}
  }catch(error){notice(error.message);}finally{busy=false;update();}
 };
 container.append(button);update();return {button,update};
}

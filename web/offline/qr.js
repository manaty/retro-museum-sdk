import QRCode from 'qrcode';
import jsQR from 'jsqr';
// QR codes are drawn as inline SVG (crisp on TVs) and read with the native
// BarcodeDetector when present, otherwise with a bundled decoder.
export async function qrSvg(text){return QRCode.toString(text,{type:'svg',errorCorrectionLevel:'L',margin:2,color:{dark:'#000000',light:'#ffffff'}});}

export async function startScanner(video,onCode,{facingMode='environment'}={}){
 if(!navigator.mediaDevices?.getUserMedia)throw Error('camera');
 const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode,width:{ideal:1280},height:{ideal:720}},audio:false});
 video.srcObject=stream;video.setAttribute('playsinline','');video.muted=true;await video.play().catch(()=>{});
 let detector=null;try{if('BarcodeDetector' in window&&(await BarcodeDetector.getSupportedFormats()).includes('qr_code'))detector=new BarcodeDetector({formats:['qr_code']});}catch{}
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});let stopped=false,timer=null,last='';
 async function scan(){
  if(stopped)return;
  try{if(video.readyState>=2&&video.videoWidth){
   let value=null;
   if(detector){const codes=await detector.detect(video);value=codes[0]?.rawValue||null;}
   else{const scale=Math.min(1,720/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);ctx.drawImage(video,0,0,canvas.width,canvas.height);value=jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height,{inversionAttempts:'dontInvert'})?.data||null;}
   if(value&&value!==last){last=value;await onCode(value);}
  }}catch(error){console.warn('QR scan',error);}
  if(!stopped)timer=setTimeout(scan,180);
 }
 scan();
 return {stop(){stopped=true;clearTimeout(timer);for(const track of stream.getTracks())track.stop();video.srcObject=null;},reset(){last='';}};
}

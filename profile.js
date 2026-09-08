import {createHash} from 'node:crypto';
// Accept only small, square JPEGs produced by the local cropper.
export function validateProfile(value){
  if(!value||typeof value.name!=='string'||value.name.length>32||/[\x00-\x1f\x7f]/.test(value.name))throw new Error('Invalid player name (32 characters maximum).');
  const name=value.name.trim();const rating=value.chessElo===undefined?{}:{chessElo:value.chessElo};if(rating.chessElo!==undefined&&(!Number.isInteger(rating.chessElo)||rating.chessElo<0||rating.chessElo>4000))throw Error("Invalid Chess Elo");
  if(!value.avatar)return {...rating,name,avatar:null};
  if(typeof value.avatar!=='string'||value.avatar.length>33000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value.avatar))throw new Error('Invalid avatar. Please crop a new image.');
  const bytes=Buffer.from(value.avatar.split(',')[1],'base64');
  if(bytes.length<12||bytes.length>24576||bytes.readUInt16BE(0)!==0xffd8)throw new Error('Invalid JPEG avatar.');
  let square=false;
  for(let i=2;i+4<bytes.length;){
    if(bytes[i++]!==255)break;
    while(bytes[i]===255)i++;
    const marker=bytes[i++];if(marker===0xda||marker===0xd9)break;
    const size=bytes.readUInt16BE(i);if(size<2||i+size>bytes.length)break;
    if([0xc0,0xc1,0xc2].includes(marker)&&size>=8){square=bytes.readUInt16BE(i+3)===128&&bytes.readUInt16BE(i+5)===128;break;}
    i+=size;
  }
  if(!square)throw new Error('Avatar must be cropped to 128 × 128 pixels.');
  return {...rating,name,avatar:value.avatar};
}
export class PlayerProfiles {
  constructor(saved={}){this.profiles=new Map();this.images=new Map();this.cache=new Map();for(const [id,value] of Object.entries(saved)){try{this.set(id,value);}catch{}}}
  set(id,value){const profile=validateProfile(value);this.profiles.set(id,profile);this.cache.delete(id);return this.public(id);}
  public(id){
    if(this.cache.has(id))return this.cache.get(id);
    const profile=this.profiles.get(id);if(!profile)return {name:'',avatar:null};
    let avatar=null;
    if(profile.avatar){const hash=createHash('sha256').update(profile.avatar).digest('hex');avatar=`/api/avatar/${hash}.jpg`;if(!this.images.has(hash))this.images.set(hash,Buffer.from(profile.avatar.split(',')[1],'base64'));}
    const result={name:profile.name,avatar};this.cache.set(id,result);return result;
  }
  save(){return Object.fromEntries(this.profiles);}
}

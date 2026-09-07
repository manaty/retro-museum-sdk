#!/usr/bin/env node
import {resolve} from 'node:path';
import {createGameHost,loadGame,fileRoomStore} from './host.js';
const paths=[];for(let i=2;i<process.argv.length;i++){if(process.argv[i]==='--package')paths.push(process.argv[++i]);else throw Error('Usage: retro-museum-host --package dist/game.rmg.json');}
if(!paths.length)paths.push('dist/game.rmg.json');
const app=await createGameHost({definitions:await Promise.all(paths.map(loadGame)),store:fileRoomStore(resolve(process.env.DATA_DIR||'.local/rooms')),publicOrigin:process.env.PUBLIC_ORIGIN});
app.server.listen(Number(process.env.PORT)||4311,'0.0.0.0',()=>console.log('Games ready at '+(process.env.PUBLIC_ORIGIN||'http://localhost:'+(app.server.address().port))));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await app.close();process.exit(0);});

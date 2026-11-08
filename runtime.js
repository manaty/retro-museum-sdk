import {getQuickJS} from 'quickjs-emscripten';
import {randomInt} from 'node:crypto';
import {prepareData} from './data.js';
import {defineGameRuntime} from './runtime-core.js';
export const GameRuntime=defineGameRuntime({QuickJS:await getQuickJS(),randomInt,prepareData});

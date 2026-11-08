// Builds the browser bundles served by host.js. Bundles are committed so hosts
// never run a build step; run `npm run build` after changing web sources.
import {build} from 'esbuild';
import {copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {createRequire} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),web=resolve(root,'web');
// room-party.js runs unchanged in the browser with QuickJS-WASM and Web Crypto.
const browserNode={name:'browser-node',setup(b){
 b.onResolve({filter:/^node:crypto$/},()=>({path:resolve(web,'offline/shims/crypto.js')}));
 b.onResolve({filter:/^\.\/runtime\.js$/},args=>args.importer===resolve(root,'room-party.js')?{path:resolve(web,'offline/browser-runtime.js')}:undefined);
}};
const common={bundle:true,minify:true,legalComments:'eof',logLevel:'warning'};
await build({...common,entryPoints:[resolve(web,'host-source.js')],format:'iife',target:'chrome58',outfile:resolve(web,'host-client.js')});
await build({...common,entryPoints:[resolve(web,'offline/loader.js')],format:'iife',target:'chrome58',outfile:resolve(web,'offline.js')});
await build({...common,entryPoints:[resolve(web,'offline/runtime-entry.js')],format:'iife',globalName:'RetroMuseumOfflineRuntime',target:['chrome80','safari15'],platform:'browser',plugins:[browserNode],outfile:resolve(web,'offline-runtime.js')});
const require=createRequire(resolve(root,'node_modules/quickjs-emscripten/package.json'));
await copyFile(require.resolve('@jitl/quickjs-wasmfile-release-sync/wasm'),resolve(web,'quickjs.wasm'));

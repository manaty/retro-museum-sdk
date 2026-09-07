import {readFile} from 'node:fs/promises';
import {validatePackage,MAX_PACKAGE_BYTES} from './index.js';
import {stat} from 'node:fs/promises';
try {
 const file=process.argv[2];
 if((await stat(file)).size>MAX_PACKAGE_BYTES)throw Error('Package exceeds 24 MB.');
 const report=validatePackage(await readFile(file));
 process.stdout.write(JSON.stringify(report));
} catch(error) {
 process.stdout.write(JSON.stringify({schemaVersion:1,status:'failed',error:String(error.message).slice(0,1500)}));
 process.exitCode=1;
}

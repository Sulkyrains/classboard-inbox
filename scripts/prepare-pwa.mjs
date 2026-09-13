import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const version=createHash('sha256').update(await readFile('dist/index.html')).update(await readFile('dist/_worker.js')).digest('hex').slice(0,16);
await writeFile('dist/sw.js',(await readFile('public/sw.js','utf8')).replaceAll('__BUILD_VERSION__',version));

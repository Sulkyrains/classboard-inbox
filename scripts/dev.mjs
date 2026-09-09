import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
if (!existsSync('dist/_worker.js')) { console.error('请先运行 npm run build 与 npm run db:migrate'); process.exit(1); }
const children = [
  spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js','pages','dev','dist','--ip','127.0.0.1','--port','8788'], {stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}}),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {stdio:'inherit'})
];
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { for(const c of children)c.kill(); process.exit(); });
for(const child of children) child.on('exit', () => { for(const c of children)c.kill(); });

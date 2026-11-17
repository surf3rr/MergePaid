import { spawn } from 'node:child_process';
import { startServer } from './index.mjs';
await startServer();
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', cwd: process.cwd() });
process.on('SIGINT', () => { vite.kill(); process.exit(); });
process.on('SIGTERM', () => { vite.kill(); process.exit(); });
vite.on('exit', code => process.exit(code ?? 0));

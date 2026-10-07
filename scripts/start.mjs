import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
if (!existsSync('node_modules/@temporalio/worker/package.json')) {
  console.log('Installing locked dependencies for the first run…');
  const install = spawnSync('npm', ['ci'], { stdio: 'inherit' });
  if (install.status !== 0) process.exit(install.status ?? 1);
}
await import('./dev.mjs');

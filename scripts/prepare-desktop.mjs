import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktopDist = resolve(projectRoot, 'desktop-dist');

await mkdir(desktopDist, { recursive: true });

for (const file of ['index.html', 'styles.css', 'workflow-app.js']) {
  await copyFile(resolve(projectRoot, file), resolve(desktopDist, file));
}

console.log(`Prepared desktop frontend in ${desktopDist}`);

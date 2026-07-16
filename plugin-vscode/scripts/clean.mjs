import { rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(scriptDir, '..');
const dryRun = process.argv.includes('--dry-run');
const requestedPaths = process.argv
  .slice(2)
  .filter((argument) => argument !== '--dry-run');

const defaultPathsToRemove = [
  'dist',
  'out',
  path.join('resources', 'webview', 'dist'),
  '.vscode-test',
];
const pathsToRemove = requestedPaths.length > 0 ? requestedPaths : defaultPathsToRemove;

async function removeRelative(relativePath) {
  const target = path.join(extensionRoot, relativePath);

  if (dryRun) {
    console.log(`[dry-run] remove ${relativePath}`);
    return;
  }

  await rm(target, { recursive: true, force: true });
  console.log(`removed ${relativePath}`);
}

async function removeVsixPackages() {
  const entries = await readdir(extensionRoot, { withFileTypes: true });
  const packages = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.vsix'))
    .map((entry) => entry.name);

  for (const packageName of packages) {
    await removeRelative(packageName);
  }
}

for (const relativePath of pathsToRemove) {
  await removeRelative(relativePath);
}

if (requestedPaths.length === 0) {
  await removeVsixPackages();
}

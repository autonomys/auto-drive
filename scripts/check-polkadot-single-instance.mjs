#!/usr/bin/env node
/**
 * check-polkadot-single-instance.mjs: fail when the backend and the Auto SDK
 * packages it depends on load more than one instance of any @polkadot package.
 *
 * Usage (after `yarn install` and `yarn backend build`, from the repository
 * root):
 *   node scripts/check-polkadot-single-instance.mjs
 *
 * Every @polkadot package records itself in globalThis.__polkadotjs when it
 * loads. Two entries for one package mean two module instances, whether from a
 * version split, a duplicate copy left by hoisting, or an ESM and a CJS build
 * of the same version. Versions installed elsewhere in the repo do not matter
 * unless they change what the backend loads, so this checks only what the
 * backend loads.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const backendDir = path.resolve('apps/backend');
const polkadotModule = path.join(backendDir, 'dist/shared/utils/polkadot.js');
if (!fs.existsSync(polkadotModule)) {
  console.error(`${polkadotModule} not found. Run yarn backend build first.`);
  process.exit(1);
}

const { dependencies } = JSON.parse(
  fs.readFileSync(path.join(backendDir, 'package.json'), 'utf8')
);
const sdkPackages = Object.keys(dependencies).filter((name) =>
  name.startsWith('@autonomys/')
);

// This script reports duplicates itself, so @polkadot's own warning would only
// repeat them.
process.env.POLKADOTJS_DISABLE_ESM_CJS_WARNING = '1';
const { resolve } = createRequire(path.join(backendDir, 'package.json'));
await import(pathToFileURL(polkadotModule).href);
for (const name of sdkPackages) {
  await import(pathToFileURL(resolve(name)).href);
}

// The registry is @polkadot internals. If a release renames it, fail rather
// than pass with nothing checked.
const loaded = Object.entries(globalThis.__polkadotjs ?? {});
if (loaded.length === 0) {
  console.error(
    'No @polkadot packages registered in globalThis.__polkadotjs, so nothing ' +
      'was checked. Has @polkadot renamed its package registry?'
  );
  process.exit(1);
}

const duplicated = loaded.filter(([, entries]) => entries.length > 1);
for (const [name, entries] of duplicated) {
  console.error(`${name} is loaded ${entries.length} times:`);
  for (const { type, version, path: from } of entries) {
    console.error(
      `  ${type} ${version}  ${path.relative(process.cwd(), from)}`
    );
  }
}
if (duplicated.length > 0) {
  console.error(
    "\nAlign the backend's @polkadot ranges with the Auto SDK's, run `yarn dedupe` for the packages that pull in other versions, and import @polkadot values only through apps/backend/src/shared/utils/polkadot.ts."
  );
  process.exit(1);
}

console.log(
  `The backend and ${sdkPackages.length} @autonomys packages load one ` +
    `instance of each of ${loaded.length} @polkadot packages.`
);
process.exit(0);

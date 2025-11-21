#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const packages = [
  '@autonomys/asynchronous',
  '@autonomys/auto-consensus',
  '@autonomys/auto-dag-data',
  '@autonomys/auto-design-system',
  '@autonomys/auto-drive',
  '@autonomys/auto-files',
  '@autonomys/auto-utils',
  '@autonomys/design-tokens',
  '@autonomys/file-server',
  '@autonomys/rpc',
];

const version = process.argv[2];

if (!version) {
  console.error('Usage: yarn update:autonomys <version>');
  process.exit(1);
}

const run = (args, options = {}) =>
  spawnSync('yarn', args, {
    stdio: 'inherit',
    env: process.env,
    ...options,
  });

const collectWorkspaces = () => {
  const result = run(['workspaces', 'list', '--json'], {
    stdio: 'pipe',
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((workspace) => {
      const location = path.resolve(process.cwd(), workspace.location);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(location, 'package.json'), 'utf8')
      );

      return {
        name: workspace.name,
        location,
        manifest,
      };
    });
};

const hasDependency = (manifest, pkg) => {
  const sections = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];

  return sections.some((section) => section && section[pkg]);
};

const workspaces = collectWorkspaces();
const failures = [];

for (const pkg of packages) {
  const descriptor = `${pkg}@${version}`;
  const targets = workspaces.filter(({ manifest }) =>
    hasDependency(manifest, pkg)
  );

  if (targets.length === 0) {
    console.log(`Skipping ${pkg}; not referenced by any workspace`);
    continue;
  }

  for (const target of targets) {
    console.log(`Updating ${descriptor} in workspace ${target.name}`);
    const result = run(['workspace', target.name, 'up', descriptor]);

    if (result.status !== 0) {
      failures.push({
        pkg: descriptor,
        workspace: target.name,
        code: result.status ?? 1,
      });
      console.error(
        `Failed to update ${descriptor} in workspace ${target.name}`
      );
    }
  }
}

if (failures.length > 0) {
  console.error('One or more updates failed:');
  for (const failure of failures) {
    console.error(
      ` - ${failure.pkg} in ${failure.workspace} (exit code ${failure.code})`
    );
  }
  process.exit(1);
}

console.log('All requested @autonomys packages updated.');

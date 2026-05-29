#!/usr/bin/env node
/**
 * update-autonomys.js — bump every @autonomys/* dependency across the
 * main-repo workspaces to a given version.
 *
 * Usage:
 *   yarn update:autonomys <version>
 *
 * Example:
 *   yarn update:autonomys 1.6.12
 *
 * What it does:
 *   1. Enumerates yarn workspaces via `yarn workspaces list --json`.
 *   2. Skips workspaces under submodules/ — those belong to separate repos
 *      and absorb new SDK versions through caret-range resolution rather
 *      than manifest edits (see the comment above the filter below).
 *   3. Derives the set of @autonomys/* packages to bump from the (filtered)
 *      workspaces' manifests — no hand-curated list to drift.
 *   4. For each (workspace, package) pair, runs
 *        yarn workspace <workspace> add @autonomys/<package>@<version>
 *      which updates the named workspace's package.json and the root
 *      yarn.lock.  `add` is workspace-scoped; `up` would mutate every
 *      workspace declaring the package — see the comment by the call site.
 *   5. Exits non-zero if any individual `yarn up` fails; otherwise reports
 *      success.
 *
 * Run from the repository root.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

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

const DEP_SECTIONS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

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
      const absoluteLocation = path.resolve(process.cwd(), workspace.location);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(absoluteLocation, 'package.json'), 'utf8')
      );

      return {
        name: workspace.name,
        // Relative path as reported by yarn (forward-slash separated even on
        // Windows).  Used to detect workspaces that live inside a submodule.
        location: workspace.location,
        absoluteLocation,
        manifest,
      };
    });
};

const hasDependency = (manifest, pkg) =>
  DEP_SECTIONS.some((section) => manifest[section] && manifest[section][pkg]);

// Walk every dependency section across every workspace and collect the
// distinct @autonomys/* package names that are actually consumed.  This keeps
// the script in sync with the codebase: adding or removing an @autonomys/* dep
// anywhere is automatically picked up on the next run, with no hand-curated
// list to drift out of date.
const collectAutonomysPackages = (workspaces) => {
  const packages = new Set();
  for (const { manifest } of workspaces) {
    for (const section of DEP_SECTIONS) {
      const deps = manifest[section];
      if (!deps) continue;
      for (const name of Object.keys(deps)) {
        if (name.startsWith('@autonomys/')) {
          packages.add(name);
        }
      }
    }
  }
  return [...packages].sort();
};

const allWorkspaces = collectWorkspaces();

// Skip workspaces under submodules/.  Each submodule is a separate repo and
// its workspaces' @autonomys/* deps use caret ranges (^1.4.x etc.), not
// exact pins — new SDK versions are absorbed automatically through yarn's
// lockfile resolution without any manifest edits.  Bumping them from here
// would replace an intentional range with an exact pin, narrowing a
// contract the submodule's authors deliberately left flexible.  And the
// mutations would land inside a submodule worktree where the outer repo
// tracks pointers, not contents, so the changes have nowhere to persist
// except in the locally-modified yarn.lock — which CI's
// `yarn install --immutable` then rejects with "lockfile would have been
// modified" (see #719).
const isSubmoduleWorkspace = ({ location }) =>
  location.startsWith('submodules/');

const submoduleWorkspaces = allWorkspaces.filter(isSubmoduleWorkspace);
const workspaces = allWorkspaces.filter((ws) => !isSubmoduleWorkspace(ws));

if (submoduleWorkspaces.length > 0) {
  console.log('Skipping submodule workspaces (separate release cadence):');
  for (const { name, location } of submoduleWorkspaces) {
    console.log(`  - ${name} (${location})`);
  }
}

const packages = collectAutonomysPackages(workspaces);

if (packages.length === 0) {
  console.log('No @autonomys/* dependencies found in main-repo workspaces.');
  process.exit(0);
}

console.log(`Bumping ${packages.length} @autonomys/* package(s) to ${version}:`);
for (const pkg of packages) {
  console.log(`  - ${pkg}`);
}

const failures = [];

for (const pkg of packages) {
  const descriptor = `${pkg}@${version}`;
  const targets = workspaces.filter(({ manifest }) =>
    hasDependency(manifest, pkg)
  );

  for (const target of targets) {
    console.log(`Updating ${descriptor} in workspace ${target.name}`);
    // `yarn add` is workspace-scoped: it only rewrites the named workspace's
    // package.json.  `yarn up`, despite the `yarn workspace <name>` prefix,
    // operates project-wide — it rewrites every workspace that declares the
    // package, including submodule workspaces.  Using `up` here would defeat
    // the submodule filter above (and was the actual cause of #719's CI
    // breakage; the filter alone is necessary but not sufficient).
    const result = run(['workspace', target.name, 'add', descriptor]);

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

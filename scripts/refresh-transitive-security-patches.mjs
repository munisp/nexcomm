#!/usr/bin/env node
/**
 * Refreshes reproducible PNPM package patches for advisory-bearing parent packages.
 *
 * This script is intended for a protected maintenance branch or a CI pull-request
 * job. It must never be run in a release-deployment job: it mutates source
 * dependency metadata, so every execution requires review of the generated patch
 * files, lockfile, audit, typecheck, and production build.
 *
 * The script fails closed if a parent package, dependency key, or PNPM patch
 * operation differs from the expected audited contract.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = process.cwd();
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const checks = [
  {
    packageSpec: '@esbuild-kit/core-utils@3.3.2',
    dependency: 'esbuild',
    required: '^0.25.0',
    rationale: 'Drizzle Kit legacy loader transitive esbuild advisory',
  },
  {
    packageSpec: '@temporalio/client@1.20.3',
    dependency: 'uuid',
    required: '^11.1.1',
    rationale: 'Temporal client transitive uuid advisory',
  },
  {
    packageSpec: '@grpc/proto-loader@0.8.1',
    dependency: 'protobufjs',
    required: '^7.6.5',
    rationale: 'gRPC / OpenTelemetry transitive protobufjs advisory',
  },
  {
    packageSpec: 'proto3-json-serializer@2.0.2',
    dependency: 'protobufjs',
    required: '^7.6.5',
    rationale: 'Temporal serializer transitive protobufjs advisory',
  },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed${output ? `:\n${output}` : ''}`);
  }
  return `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
}

function assertCleanWorkingTree() {
  const output = run('git', ['status', '--porcelain'], { capture: true }).trim();
  if (output) {
    throw new Error('Refusing to generate patches on a dirty working tree. Commit or stash changes first.');
  }
}

function patchPackage(contract) {
  const output = run(pnpm, ['patch', contract.packageSpec], { capture: true });
  const match = output.match(/(?:Patch folder|Patch directory|You can now edit(?: the following)? (?:folder|directory)):\s*([^\n]+)/i);
  if (!match) {
    throw new Error(`Could not parse PNPM patch directory for ${contract.packageSpec}. Output:\n${output}`);
  }

  const patchDir = resolve(root, match[1].trim().replace(/["']/g, ''));
  const manifestPath = resolve(patchDir, 'package.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`PNPM patch directory does not contain package.json: ${patchDir}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!manifest.dependencies || typeof manifest.dependencies[contract.dependency] !== 'string') {
    throw new Error(`${contract.packageSpec} does not declare ${contract.dependency}; refusing an unsafe patch.`);
  }

  const previous = manifest.dependencies[contract.dependency];
  manifest.dependencies[contract.dependency] = contract.required;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Patched ${contract.packageSpec}: ${contract.dependency} ${previous} → ${contract.required} (${contract.rationale})`);
  run(pnpm, ['patch-commit', patchDir]);
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!existsSync(resolve(root, 'pnpm-workspace.yaml'))) {
    throw new Error('Run from the repository root containing pnpm-workspace.yaml.');
  }
  assertCleanWorkingTree();
  if (dryRun) {
    console.log('DRY RUN: no package patch, install, audit, or build command will execute.');
    for (const contract of checks) {
      console.log(`DRY RUN CONTRACT: ${contract.packageSpec} :: ${contract.dependency} -> ${contract.required} :: ${contract.rationale}`);
    }
    return;
  }
  run(pnpm, ['install', '--frozen-lockfile']);

  for (const contract of checks) {
    patchPackage(contract);
  }

  run(pnpm, ['install', '--force', '--no-frozen-lockfile']);
  run(pnpm, ['audit', '--json']);
  run(pnpm, ['run', 'check']);
  run(pnpm, ['run', 'build']);

  console.log('Patch refresh completed. Review patches/, pnpm-workspace.yaml, pnpm-lock.yaml, audit output, and build output before opening a pull request.');
}

try {
  main();
} catch (error) {
  console.error(`SECURITY PATCH REFRESH FAILED: ${error.message}`);
  process.exit(1);
}

#!/usr/bin/env node
// @ts-check
// Verify the shipped Narrative schema, tools, examples, and package resources against
// tools/port/PORTED.sha256 without any monorepo access or external dependencies.
//
// Usage: node tools/port/verify-ported.mjs [--root <dir>] [--json] [--help]
// Exit codes: 0 verified, 1 integrity failure, 2 usage or operational error.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readIntegrity, verifyIntegrity } from './integrity.mjs';

const USAGE = 'Usage: node tools/port/verify-ported.mjs [--root <dir>] [--json] [--help]';

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  const options = {
    root: resolve(scriptDirectory, '../..'),
    manifestPath: resolve(scriptDirectory, 'PORTED.sha256'),
    json: false,
    help: false,
  };
  let rootOverridden = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      options.json = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      options.help = true;
      continue;
    }
    if (token === '--root') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --root');
      }
      options.root = resolve(value);
      rootOverridden = true;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (rootOverridden) {
    options.manifestPath = join(options.root, 'tools/port/PORTED.sha256');
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  const integrity = readIntegrity(readFileSync(options.manifestPath, 'utf8'));
  const result = verifyIntegrity(options.root, integrity);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(`OK: ${result.checked} files match PORTED.sha256.`);
  } else {
    console.error(result.problems.join('\n'));
  }
  return result.ok ? 0 : 1;
}

try {
  process.exitCode = main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 2;
}

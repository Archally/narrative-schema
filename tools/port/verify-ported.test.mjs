// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectHashes, readIntegrity, verifyIntegrity } from './integrity.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Build a minimal disposable Narrative public package fixture.
 * @param {import('node:test').TestContext} context
 */
function fixture(context) {
  const root = mkdtempSync(join(tmpdir(), 'narrative-integrity-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const put = (relativePath, content) => {
    const full = join(root, relativePath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, 'utf8');
  };

  mkdirSync(join(root, 'tools/port'), { recursive: true });
  for (const name of ['verify-ported.mjs', 'integrity.mjs']) {
    cpSync(join(HERE, name), join(root, 'tools/port', name));
  }
  put('schema/v1.5/narrative.metamodel.schema.yaml', '$id: "urn:narrative:metamodel:1.0.0"\nx-gdsm:\n  version: "1.5.0"\n');
  put('examples/public-deck/narrative.yaml', 'version: "1.0.0"\nname: "Public Deck"\n');
  put('examples/README.md', '# Examples\n');
  put('docs/README.md', '# Docs\n');
  put('package.json', '{"name":"@archally/narrative-schema","version":"1.5.0"}\n');
  put('.github/workflows/validate.yml', 'name: Validate\n');

  const jobs = [
    { name: 'schema', kind: 'job', path: 'schema/v1.5' },
    { name: 'port', kind: 'job', path: 'tools/port' },
    { name: 'example-public-deck', kind: 'job', path: 'examples/public-deck' },
    { name: 'examples-readme', kind: 'file', path: 'examples/README.md' },
    { name: 'docs', kind: 'job', path: 'docs' },
    { name: 'package', kind: 'file', path: 'package.json' },
    { name: 'ci-validate', kind: 'file', path: '.github/workflows/validate.yml' },
  ];
  const lines = [
    '# PORTED.sha256 - Narrative integrity test fixture.',
    ...jobs.map((job) => `# ${job.kind} ${job.name} ${job.path}`),
    '# covered schema',
    '# covered tools',
    '# covered docs',
    '# covered examples',
    '# absent tools/cli',
    '# absent publication.manifest.yaml',
    '',
  ];
  for (const [file, hash] of collectHashes(root, jobs)) {
    lines.push(`${hash}  ${file}`);
  }
  put('tools/port/PORTED.sha256', `${lines.join('\n')}\n`);

  const run = (...extra) => spawnSync(
    process.execPath,
    [join(root, 'tools/port/verify-ported.mjs'), '--json', ...extra],
    { encoding: 'utf8' },
  );
  return { root, put, run };
}

test('standalone verifier passes on an intact disposable package', (context) => {
  const { run } = fixture(context);
  const result = run();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.checked, 8);
  assert.deepEqual(parsed.problems, []);
});

for (const targetFile of [
  'schema/v1.5/narrative.metamodel.schema.yaml',
  'tools/port/integrity.mjs',
  'tools/port/verify-ported.mjs',
  'examples/public-deck/narrative.yaml',
  'package.json',
]) {
  test(`modified ${targetFile} fails standalone verification`, (context) => {
    const { root, run } = fixture(context);
    const suffix = targetFile.endsWith('.mjs') ? '\n// tampered\n' : '\n ';
    writeFileSync(join(root, targetFile), readFileSync(join(root, targetFile), 'utf8') + suffix);
    const result = run();
    assert.equal(result.status, 1, result.stderr + result.stdout);
  });
}

test('detects unexpected root-level file and undeclared nested files', (context) => {
  const { root, put, run } = fixture(context);
  put('ROGUE.md', 'unexpected top-level file\n');
  const rootResult = run();
  assert.equal(rootResult.status, 1, rootResult.stderr + rootResult.stdout);
  assert.ok(JSON.parse(rootResult.stdout).problems.includes('Undeclared root path: ROGUE.md'));
  rmSync(join(root, 'ROGUE.md'));

  for (const [nested, expectedProblem] of [
    ['examples/extra.md', 'Undeclared path: examples/extra.md'],
    ['tools/unknown/extra.mjs', 'Undeclared path: tools/unknown'],
    ['.github/workflows/extra.yml', 'Undeclared path: .github/workflows/extra.yml'],
  ]) {
    put(nested, 'unexpected nested\n');
    const nestedResult = run();
    assert.equal(nestedResult.status, 1, nestedResult.stderr + nestedResult.stdout);
    assert.ok(JSON.parse(nestedResult.stdout).problems.includes(expectedProblem), nested);
    rmSync(join(root, nested), { force: true });
    if (nested === 'tools/unknown/extra.mjs') {
      rmSync(join(root, 'tools/unknown'), { recursive: true, force: true });
    }
  }
  assert.equal(run().status, 0);
});

for (const operation of ['add', 'missing', 'private-nested', 'private-root', 'missing-unit', 'CRLF']) {
  test(`${operation} produces the expected integrity verdict`, (context) => {
    const { root, put, run } = fixture(context);
    if (operation === 'add') {
      put('schema/v1.5/extra.schema.yaml', 'type: object\n');
    }
    if (operation === 'missing') {
      rmSync(join(root, 'schema/v1.5/narrative.metamodel.schema.yaml'));
    }
    if (operation === 'private-nested') {
      put('tools/cli/nr.mjs', 'private\n');
    }
    if (operation === 'private-root') {
      put('publication.manifest.yaml', 'private\n');
    }
    if (operation === 'missing-unit') {
      rmSync(join(root, 'docs'), { recursive: true });
    }
    if (operation === 'CRLF') {
      put('examples/public-deck/narrative.yaml', 'version: "1.0.0"\r\nname: "Public Deck"\r\n');
    }
    assert.equal(run().status, operation === 'CRLF' ? 0 : 1);
  });
}

test('ignores .git and node_modules at root while failing on stray dotfiles', (context) => {
  const { root, put, run } = fixture(context);
  put('.git/HEAD', 'ref: refs/heads/main\n');
  put('node_modules/yaml/index.js', 'export {};\n');
  assert.equal(run().status, 0);
  put('.env.local', 'SECRET=1\n');
  const failed = run();
  assert.equal(failed.status, 1);
  assert.ok(JSON.parse(failed.stdout).problems.includes('Undeclared root path: .env.local'));
});

test('malformed, duplicate, and empty manifests refuse', () => {
  const duplicate = `# job tool tools/tool\n${'a'.repeat(64)}  tool/file\n${'a'.repeat(64)}  tool/file\n`;
  for (const text of ['', 'invalid\n', duplicate]) {
    assert.throws(() => readIntegrity(text));
  }
});

test('escaping paths and symlinks refuse', (context) => {
  const { root, run } = fixture(context);
  assert.throws(() => verifyIntegrity(root, {
    jobs: [{ name: 'bad', kind: 'job', path: '../escape' }],
    hashes: new Map(),
    covered: [],
    absent: [],
  }));
  symlinkSync(join(root, 'package.json'), join(root, 'docs/link.md'));
  const symlinkResult = run();
  assert.equal(symlinkResult.status, 2);
  assert.match(symlinkResult.stderr, /Symbolic link/);
});

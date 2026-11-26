// @ts-check
// Portable conformance tests for the standalone Narrative v1 validator.
// Runs in both the deployed public repository and the source tree without external fixtures.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  formatValidationReportText,
  parseStandaloneCliArgs,
  resolveDefaultSchemasDir,
  resolveScenesSchemaUrn,
  validateNarrative,
} from './index.mjs';

const VALIDATOR_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(VALIDATOR_DIR, 'cli.mjs');
const SCHEMAS_DIR = resolveDefaultSchemasDir(VALIDATOR_DIR);
const DEPLOYED_EXAMPLE = path.resolve(VALIDATOR_DIR, '..', '..', 'examples', 'public-deck');

/**
 * @param {string} root
 * @param {string} relPath
 * @param {string} content
 */
function put(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf8');
}

/**
 * Create a minimal valid synthetic Narrative v1 model inside a temporary directory.
 *
 * @param {import('node:test').TestContext} context
 * @param {{ withGraph?: boolean }} [options]
 */
function createMinimalModel(context, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrative-validator-'));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  put(dir, 'narrative.yaml', YAML.stringify({
    version: '1.0.0',
    id: 'N001',
    name: 'Synthetic Conformance Model',
    planes: {
      intent: { folder: 'intent', intent: 'intent/intent.yaml' },
      knowledge: {
        folder: 'knowledge',
        concepts: 'knowledge/concepts.yaml',
        claims: 'knowledge/claims.yaml',
        evidence: 'knowledge/evidence.yaml',
      },
      orchestration: { folder: 'orchestration', scenes: 'orchestration/scenes.yaml' },
      delivery: { folder: 'delivery', variants: 'delivery/variants.yaml' },
      assurance: { folder: 'assurance' },
    },
  }));

  put(dir, 'intent/intent.yaml', YAML.stringify({
    version: '1.0.0',
    topic_statement: 'Validate a synthetic Narrative model cleanly.',
    audience: {
      level: 'intermediate',
      roles: ['developer'],
    },
    goals: [
      { id: 'G001', statement: 'Understand the model structure', priority: 'must' },
    ],
    constraints: {
      format: 'lecture',
      language: 'en-US',
      duration_minutes: 10,
    },
    north_star: {
      statement: 'One validated Narrative source.',
    },
  }));

  put(dir, 'knowledge/concepts.yaml', YAML.stringify({
    version: '1.0.0',
    concepts: [
      { id: 'C001', term: 'Narrative Model', definition: 'A structured YAML model of an argument.' },
    ],
  }));

  put(dir, 'knowledge/claims.yaml', YAML.stringify({
    version: '1.0.0',
    claims: [
      {
        id: 'CLM001',
        title: 'Structured models validate deterministically',
        strength: 'strong',
        supports_goals: ['G001'],
        key_terms: ['C001'],
        evidence_refs: ['E001'],
      },
    ],
  }));

  put(dir, 'knowledge/evidence.yaml', YAML.stringify({
    version: '1.0.0',
    evidence: [
      {
        id: 'E001',
        title: 'Synthetic benchmark',
        kind: 'benchmark',
        citation: 'Controlled conformance run with zero warnings.',
        backs_claims: ['CLM001'],
      },
    ],
  }));

  /** @type {Record<string, unknown>} */
  const scenesDoc = {
    version: options.withGraph ? '1.1.0' : '1.0.0',
    narrative_arc: 'problem_solution',
    scenes: [
      {
        id: 'SC001',
        title: 'Opening',
        role: 'hook',
        timebox: { target: 5 },
        supports_goals: ['G001'],
        covers: { concepts: ['C001'], claims: ['CLM001'] },
      },
      {
        id: 'SC002',
        title: 'Resolution',
        role: 'payoff',
        timebox: { target: 5 },
        pays_off: ['SC001'],
        covers: { evidence: ['E001'] },
      },
    ],
  };

  if (options.withGraph) {
    scenesDoc.graph = {
      entry: 'SC001',
      endings: [
        {
          scene_id: 'SC002',
          code: 'complete',
          label: 'Complete',
          outcome_summary: 'Reader finishes the walkthrough.',
        },
      ],
      state: {
        verified: { type: 'boolean', initial: false },
        depth: { type: 'enum', initial: 'brief', values: ['brief', 'deep'] },
      },
      transitions: [
        {
          id: 'TR001',
          from: 'SC001',
          to: 'SC002',
          kind: 'choice',
          label: 'Review proof',
          when: { verified: false },
          effects: { verified: true, depth: 'deep' },
        },
      ],
    };
  }

  put(dir, 'orchestration/scenes.yaml', YAML.stringify(scenesDoc));

  put(dir, 'delivery/variants.yaml', YAML.stringify({
    version: '1.0.0',
    variants: [
      {
        id: 'DLV001',
        name: 'Default cut',
        language: 'en-US',
        confidentiality: 'public',
        duration_minutes: 10,
        scene_selection: {
          scene_ids: ['SC001', 'SC002'],
        },
      },
    ],
  }));

  return dir;
}

/**
 * @param {string} dir
 * @param {string} relPath
 * @param {(doc: Record<string, unknown>) => void} mutate
 */
function editYaml(dir, relPath, mutate) {
  const filePath = path.join(dir, relPath);
  const doc = /** @type {Record<string, unknown>} */ (YAML.parse(fs.readFileSync(filePath, 'utf8')));
  mutate(doc);
  fs.writeFileSync(filePath, YAML.stringify(doc), 'utf8');
}

/**
 * @param {string[]} args
 * @param {string} [cwd]
 */
function runCli(args, cwd = VALIDATOR_DIR) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

test('validator source files contain zero workspace or tsx imports', () => {
  /** @type {string[]} */
  const files = [];
  const stack = [VALIDATOR_DIR];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.name.endsWith('.mjs')) {
        files.push(full);
      }
    }
  }
  assert.ok(files.length >= 7);
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const importLines = text.split('\n').filter((line) => /^\s*import\s/.test(line));
    for (const line of importLines) {
      assert.doesNotMatch(line, /@archally\/|tsx/, `Disallowed import in ${path.basename(file)}: ${line}`);
    }
  }
});

test('resolveScenesSchemaUrn dispatches strictly by own-property presence of graph', () => {
  assert.equal(resolveScenesSchemaUrn({ version: '1.0.0', scenes: [] }), 'urn:narrative:scenes:1.0.0');
  assert.equal(resolveScenesSchemaUrn({ version: '1.1.0', scenes: [] }), 'urn:narrative:scenes:1.0.0');
  assert.equal(resolveScenesSchemaUrn({ version: '1.0.0', scenes: [], graph: null }), 'urn:narrative:scenes:1.1.0');
  assert.equal(resolveScenesSchemaUrn({ version: '1.0.0', scenes: [], graph: {} }), 'urn:narrative:scenes:1.1.0');
  assert.equal(resolveScenesSchemaUrn(null), 'urn:narrative:scenes:1.0.0');
});

test('passes valid linear and branching 1.1.0 models via CLI positional path, --model, and --json', (context) => {
  const linearDir = createMinimalModel(context, { withGraph: false });
  const linearPositional = runCli([linearDir, '--schemas', SCHEMAS_DIR]);
  assert.equal(linearPositional.status, 0, linearPositional.stdout + linearPositional.stderr);
  assert.match(linearPositional.stdout, /PASSED with 0 warning\(s\)\./);
  assert.match(linearPositional.stderr, /unknown format "uri" ignored/);
  assert.match(linearPositional.stderr, /unknown format "date-time" ignored/);
  assert.match(linearPositional.stderr, /unknown format "date" ignored/);

  const linearJson = runCli(['--model', linearDir, '--schemas', SCHEMAS_DIR, '--json']);
  assert.equal(linearJson.status, 0, linearJson.stderr);
  const report = JSON.parse(linearJson.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.exit_code, 0);
  assert.equal(report.mode, 'strict');
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.warnings, 0);
  assert.equal(report.summary.files_checked, 7);

  // Graph-absent scenes declaring version 1.1.0 still dispatch to scenes 1.0.0 and pass.
  editYaml(linearDir, 'orchestration/scenes.yaml', (doc) => {
    doc.version = '1.1.0';
  });
  const v11NoGraph = validateNarrative({ modelPath: linearDir, schemasPath: SCHEMAS_DIR });
  assert.equal(v11NoGraph.exit_code, 0);
  assert.deepEqual(v11NoGraph.findings, []);

  // Valid graph-bearing 1.1.0 model passes in both strict and compat.
  const branchingDir = createMinimalModel(context, { withGraph: true });
  const branchStrict = runCli(['--model', branchingDir, '--schemas', SCHEMAS_DIR, '--json']);
  assert.equal(branchStrict.status, 0, branchStrict.stdout + branchStrict.stderr);
  assert.equal(JSON.parse(branchStrict.stdout).valid, true);

  const branchCompat = runCli(['--model', branchingDir, '--schemas', SCHEMAS_DIR, '--compat', '--json']);
  assert.equal(branchCompat.status, 0, branchCompat.stdout + branchCompat.stderr);
  assert.equal(JSON.parse(branchCompat.stdout).valid, true);
});

test('schema violation exits 1 in strict mode and downgrades to exit 0 warning in compat mode', (context) => {
  const dir = createMinimalModel(context);
  editYaml(dir, 'intent/intent.yaml', (doc) => {
    const constraints = /** @type {Record<string, unknown>} */ (doc.constraints);
    constraints.format = 'invalid_medium';
  });

  const strict = runCli(['--model', dir, '--schemas', SCHEMAS_DIR, '--json']);
  assert.equal(strict.status, 1);
  const strictReport = JSON.parse(strict.stdout);
  assert.equal(strictReport.summary.schema_errors, 1);
  assert.equal(strictReport.findings[0].code, 'schema_violation');

  const compat = runCli(['--model', dir, '--schemas', SCHEMAS_DIR, '--compat', '--json']);
  assert.equal(compat.status, 0);
  const compatReport = JSON.parse(compat.stdout);
  assert.equal(compatReport.summary.errors, 0);
  assert.equal(compatReport.summary.warnings, 2);
  assert.ok(compatReport.findings.some((f) => f.code === 'compat_schema_warning'));
  assert.ok(compatReport.findings.some((f) => f.code === 'compat_mode_active'));
});

test('broken cross-file reference exits 1 in both strict and compat modes', (context) => {
  const dir = createMinimalModel(context);
  editYaml(dir, 'knowledge/claims.yaml', (doc) => {
    const claims = /** @type {Array<Record<string, unknown>>} */ (doc.claims);
    claims[0].evidence_refs = ['E999'];
  });

  const strict = validateNarrative({ modelPath: dir, schemasPath: SCHEMAS_DIR });
  const compat = validateNarrative({ modelPath: dir, schemasPath: SCHEMAS_DIR, compat: true });
  assert.equal(strict.exit_code, 1);
  assert.equal(compat.exit_code, 1);
  assert.ok(strict.findings.some((f) => f.code === 'missing_reference' && f.message.includes('E999')));
  assert.ok(compat.findings.some((f) => f.code === 'missing_reference' && f.message.includes('E999')));
});

test('malformed branching graph exits 1 in both strict and compat modes', (context) => {
  const cases = [
    {
      name: 'wrong version 1.0.0 with graph',
      mutate: (doc) => {
        doc.version = '1.0.0';
      },
      code: 'graph_invalid_version',
    },
    {
      name: 'graph is null',
      mutate: (doc) => {
        doc.graph = null;
      },
      code: 'graph_invalid_shape',
    },
    {
      name: 'missing entry scene',
      mutate: (doc) => {
        doc.graph.entry = 'SC999';
      },
      code: 'graph_missing_scene_ref',
    },
    {
      name: 'outgoing transition from ending',
      mutate: (doc) => {
        doc.graph.transitions.push({
          id: 'TR002',
          from: 'SC002',
          to: 'SC001',
          kind: 'default',
          label: 'Illegal loop from ending',
        });
      },
      code: 'graph_ending_outgoing_transition',
    },
    {
      name: 'default transition with when guard',
      mutate: (doc) => {
        doc.graph.transitions[0].kind = 'default';
      },
      code: 'graph_default_with_when',
    },
    {
      name: 'undeclared state var in when',
      mutate: (doc) => {
        doc.graph.transitions[0].when = { unknown_flag: true };
      },
      code: 'graph_undeclared_state_var',
    },
    {
      name: 'out-of-domain enum value in effects',
      mutate: (doc) => {
        doc.graph.transitions[0].effects = { depth: 'invalid_depth' };
      },
      code: 'graph_out_of_domain_value',
    },
  ];

  for (const testCase of cases) {
    const dir = createMinimalModel(context, { withGraph: true });
    editYaml(dir, 'orchestration/scenes.yaml', testCase.mutate);
    const strict = validateNarrative({ modelPath: dir, schemasPath: SCHEMAS_DIR });
    const compat = validateNarrative({ modelPath: dir, schemasPath: SCHEMAS_DIR, compat: true });
    assert.equal(strict.exit_code, 1, `${testCase.name} strict`);
    assert.equal(compat.exit_code, 1, `${testCase.name} compat`);
    assert.ok(
      compat.findings.some((f) => f.layer === 'graph' && f.code === testCase.code && f.severity === 'error'),
      `${testCase.name} expected ${testCase.code}`,
    );
  }
});

test('structure pays_off and beat errors, gap warnings, and ignored read-only slides', (context) => {
  const dir = createMinimalModel(context);
  editYaml(dir, 'orchestration/scenes.yaml', (doc) => {
    const scenes = /** @type {Array<Record<string, unknown>>} */ (doc.scenes);
    scenes[0].pays_off = ['SC002'];
    scenes[0].beat = 'setup';
  });
  const structRes = validateNarrative({ modelPath: dir, schemasPath: SCHEMAS_DIR });
  assert.equal(structRes.exit_code, 1);
  assert.ok(structRes.findings.some((f) => f.code === 'structure_payoff_not_earlier'));
  assert.ok(structRes.findings.some((f) => f.code === 'structure_beat_requires_framework'));

  // Malformed read-only delivery.slides does not trigger load_error or baseline errors.
  const slidesDir = createMinimalModel(context);
  editYaml(slidesDir, 'narrative.yaml', (doc) => {
    const planes = /** @type {Record<string, Record<string, unknown>>} */ (doc.planes);
    planes.delivery.slides = 'delivery/slides.yaml';
  });
  put(slidesDir, 'delivery/slides.yaml', 'slides: [unclosed');
  const slidesRes = validateNarrative({ modelPath: slidesDir, schemasPath: SCHEMAS_DIR });
  assert.equal(slidesRes.exit_code, 0);
  assert.equal(slidesRes.load_status, 'loaded');
  assert.deepEqual(slidesRes.findings, []);
});

test('returns exit 2 for load failures and invalid CLI usage', (context) => {
  const missingRoot = runCli(['--model', path.join(os.tmpdir(), 'nr-does-not-exist-987654'), '--schemas', SCHEMAS_DIR]);
  assert.equal(missingRoot.status, 2);
  assert.match(missingRoot.stderr, /Validation runner failed:/);

  const badRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nr-bad-root-'));
  context.after(() => fs.rmSync(badRootDir, { recursive: true, force: true }));
  put(badRootDir, 'narrative.yaml', 'version: [unclosed');
  const badRoot = runCli(['--model', badRootDir, '--schemas', SCHEMAS_DIR, '--json']);
  assert.equal(badRoot.status, 2);
  assert.equal(JSON.parse(badRoot.stdout).load_error.code, 'manifest_parse_error');

  const badPlaneDir = createMinimalModel(context);
  put(badPlaneDir, 'knowledge/claims.yaml', 'claims: [unclosed');
  const badPlane = runCli(['--model', badPlaneDir, '--schemas', SCHEMAS_DIR, '--json']);
  assert.equal(badPlane.status, 2);
  assert.equal(JSON.parse(badPlane.stdout).load_error.code, 'plane_parse_error');

  const badSchemas = runCli(['--model', createMinimalModel(context), '--schemas', path.join(os.tmpdir(), 'nr-missing-schemas-987654')]);
  assert.equal(badSchemas.status, 2);
  assert.match(badSchemas.stderr, /Validation runner failed:/);

  const helpRes = runCli(['--help']);
  assert.equal(helpRes.status, 0);
  assert.match(helpRes.stdout, /Usage: narrative-validate/);

  const unknownFlag = runCli(['--unknown-flag']);
  assert.equal(unknownFlag.status, 2);
  assert.match(unknownFlag.stderr, /Unknown argument: --unknown-flag/);

  const missingModelVal = runCli(['--model']);
  assert.equal(missingModelVal.status, 2);
  assert.match(missingModelVal.stderr, /Missing value for --model/);

  assert.throws(() => parseStandaloneCliArgs(['node', 'cli.mjs', 'a', 'b']), /Unexpected extra positional argument/);
  assert.match(formatValidationReportText({ load_status: 'load_error', load_error: { message: 'boom' } }), /Validation runner failed: boom/);
});

test('validates deployed examples/public-deck when present in the checkout', () => {
  if (!fs.existsSync(path.join(DEPLOYED_EXAMPLE, 'narrative.yaml'))) {
    return;
  }
  const run = runCli(['--model', DEPLOYED_EXAMPLE, '--json']);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.valid, true);
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.warnings, 0);
});

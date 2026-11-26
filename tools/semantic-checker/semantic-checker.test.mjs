// @ts-check
// Portable unit and CLI tests for the Narrative semantic checker (5 declarative + 3 custom rules).
// Runs in both the deployed public repository and the monorepo without external fixtures.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { loadAndBuildNarrativeModel } from '../model-builder/index.mjs';
import {
  listNarrativeSemanticRules,
  loadNarrativeSemanticConfig,
  runNarrativeSemanticCheck,
} from './index.mjs';

const CHECKER_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(CHECKER_DIR, 'cli.mjs');
const DEPLOYED_EXAMPLE = path.resolve(CHECKER_DIR, '..', '..', 'examples', 'public-deck');

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
 * @returns {Record<string, any>}
 */
function baseCleanFiles() {
  return {
    intent: {
      version: '1.0.0',
      goals: [{ id: 'G001', statement: 'Understand semantic checking', priority: 'must' }],
    },
    concepts: {
      version: '1.0.0',
      concepts: [{ id: 'C001', term: 'Semantic Rule', definition: 'A declarative check.' }],
    },
    claims: {
      version: '1.0.0',
      claims: [
        {
          id: 'CLM001',
          title: 'Declarative rules catch orphans',
          strength: 'strong',
          key_terms: ['C001'],
          supports_goals: ['G001'],
          evidence_refs: ['E001'],
        },
      ],
    },
    evidence: {
      version: '1.0.0',
      evidence: [
        {
          id: 'E001',
          title: 'Parity benchmark',
          kind: 'benchmark',
          backs_claims: ['CLM001'],
        },
      ],
    },
    assets: {
      version: '1.0.0',
      assets: [
        {
          id: 'A001',
          title: 'Architecture diagram',
          kind: 'diagram',
          illustrates: { claims: ['CLM001'] },
        },
        {
          id: 'A002',
          title: 'Compact diagram',
          kind: 'diagram',
          illustrates: { claims: ['CLM001'] },
        },
      ],
    },
    scenes: {
      version: '1.0.0',
      scenes: [
        {
          id: 'SC001',
          title: 'Opening',
          role: 'hook',
          timebox: { min: 0.5, target: 1.5, max: 2 },
          supports_goals: ['G001'],
          covers: { claims: ['CLM001'], concepts: ['C001'], assets: ['A001'] },
          anticipated_questions: ['AQ001'],
        },
      ],
    },
    qa: {
      version: '1.0.0',
      qa: [
        {
          id: 'AQ001',
          question: 'Why declarative rules?',
          short_answer: 'One shared engine across schemas.',
        },
      ],
    },
  };
}

/**
 * @param {import('node:test').TestContext} context
 * @param {Record<string, any>} files
 */
function createFixture(context, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrative-semantic-'));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  /** @type {Record<string, Record<string, string>>} */
  const planes = {};
  /**
   * @param {string} plane
   * @param {string} key
   * @param {string} relPath
   * @param {any} doc
   */
  const writePlane = (plane, key, relPath, doc) => {
    if (!doc) {
      return;
    }
    put(dir, relPath, YAML.stringify(doc));
    planes[plane] = planes[plane] ?? {};
    planes[plane][key] = relPath;
  };

  writePlane('intent', 'intent', 'intent/intent.yaml', files.intent);
  writePlane('knowledge', 'concepts', 'knowledge/concepts.yaml', files.concepts);
  writePlane('knowledge', 'claims', 'knowledge/claims.yaml', files.claims);
  writePlane('knowledge', 'evidence', 'knowledge/evidence.yaml', files.evidence);
  writePlane('knowledge', 'assets', 'knowledge/assets.yaml', files.assets);
  writePlane('orchestration', 'scenes', 'orchestration/scenes.yaml', files.scenes);
  writePlane('delivery', 'variants', 'delivery/variants.yaml', files.variants);
  writePlane('assurance', 'qa', 'assurance/qa.yaml', files.qa);

  put(dir, 'narrative.yaml', YAML.stringify({
    version: '1.0.0',
    id: 'N001',
    name: 'Synthetic Semantic Fixture',
    planes,
    ...(files.manifest ?? {}),
  }));

  return dir;
}

/**
 * @param {string[]} args
 */
function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: CHECKER_DIR,
    encoding: 'utf8',
  });
}

test('semantic-checker sources contain only allowed public imports', () => {
  const files = [
    path.join(CHECKER_DIR, 'adapter.mjs'),
    path.join(CHECKER_DIR, 'index.mjs'),
    path.join(CHECKER_DIR, 'cli.mjs'),
    path.join(CHECKER_DIR, 'rules', 'unused-scene-in-variants.mjs'),
    path.join(CHECKER_DIR, 'rules', 'asset-substitution-target-type.mjs'),
    path.join(CHECKER_DIR, 'rules', 'timebox-ordering.mjs'),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const importLines = text.split('\n').filter((line) => /^\s*import\s/.test(line));
    for (const line of importLines) {
      assert.doesNotMatch(
        line,
        /@archally\/narrative|@archally\/graph-traversal|tsx/,
        `Disallowed workspace import in ${path.basename(file)}: ${line}`,
      );
    }
  }
});

test('lists all 8 rules in stable order with default warn severity (5 declarative + 3 custom)', async () => {
  const rules = await listNarrativeSemanticRules();
  assert.deepEqual(
    rules.map((rule) => rule.id),
    [
      'orphan-concepts',
      'orphan-assets',
      'orphan-evidence',
      'unlinked-qa',
      'scene-without-goal-or-claim',
      'unused-scene-in-variants',
      'asset-substitution-target-type',
      'timebox-ordering',
    ],
  );
  for (const rule of rules) {
    assert.equal(rule.severity, 'warn');
  }
  assert.equal(rules.filter((rule) => rule.kind === 'declarative').length, 5);
  assert.equal(rules.filter((rule) => rule.kind === 'custom').length, 3);

  const listCli = runCli(['--list', '--json']);
  assert.equal(listCli.status, 0, listCli.stderr);
  assert.equal(JSON.parse(listCli.stdout).rules.length, 8);
});

test('passes cleanly on connected model and reports authored entity counts (excluding internal subjects)', async (context) => {
  const files = baseCleanFiles();
  files.variants = {
    version: '1.0.0',
    variants: [
      {
        id: 'DLV001',
        name: 'Clean cut',
        scene_selection: { scene_ids: ['SC001'] },
        asset_substitutions: [{ replace_ref: 'A001', with_ref: 'A002' }],
      },
    ],
  };
  const dir = createFixture(context, files);
  const { model } = loadAndBuildNarrativeModel(dir);
  const result = await runNarrativeSemanticCheck(model, { strict: true });

  assert.equal(result.status, 'checked');
  assert.equal(result.passed, true);
  assert.equal(result.rules_loaded, 8);
  assert.equal(result.declarative_rules, 5);
  assert.equal(result.custom_rules, 3);
  assert.equal(result.entities, model.entities.length);
  assert.equal(result.relations, model.relations.length);
  assert.deepEqual(result.counts, { error: 0, warn: 0, info: 0 });
  assert.deepEqual(result.issues, []);
});

test('fires focused failing cases for all 5 declarative rules with exact file and YAML path', async (context) => {
  // 1. orphan-concepts
  const orphanConcept = baseCleanFiles();
  orphanConcept.concepts.concepts.push({ id: 'C002', term: 'Isolated Concept', definition: 'Unused.' });
  const resC = await runNarrativeSemanticCheck(loadAndBuildNarrativeModel(createFixture(context, orphanConcept)).model);
  const hitC = resC.issues.find((issue) => issue.ruleId === 'orphan-concepts' && issue.entityId === 'C002');
  assert.ok(hitC);
  assert.equal(hitC.file, 'knowledge/concepts.yaml');
  assert.equal(hitC.path, 'concepts[1]');

  // 2. orphan-assets
  const orphanAsset = baseCleanFiles();
  orphanAsset.assets.assets.push({ id: 'A003', title: 'Unused Diagram', kind: 'diagram' });
  const resA = await runNarrativeSemanticCheck(loadAndBuildNarrativeModel(createFixture(context, orphanAsset)).model);
  const hitA = resA.issues.find((issue) => issue.ruleId === 'orphan-assets' && issue.entityId === 'A003');
  assert.ok(hitA);
  assert.equal(hitA.file, 'knowledge/assets.yaml');
  assert.equal(hitA.path, 'assets[2]');

  // 3. orphan-evidence
  const orphanEv = baseCleanFiles();
  orphanEv.evidence.evidence.push({ id: 'E002', title: 'Unlinked Study', kind: 'paper' });
  const resE = await runNarrativeSemanticCheck(loadAndBuildNarrativeModel(createFixture(context, orphanEv)).model);
  const hitE = resE.issues.find((issue) => issue.ruleId === 'orphan-evidence' && issue.entityId === 'E002');
  assert.ok(hitE);
  assert.equal(hitE.file, 'knowledge/evidence.yaml');
  assert.equal(hitE.path, 'evidence[1]');

  // 4. unlinked-qa
  const unlinkedQa = baseCleanFiles();
  delete unlinkedQa.scenes.scenes[0].anticipated_questions;
  const resQa = await runNarrativeSemanticCheck(loadAndBuildNarrativeModel(createFixture(context, unlinkedQa)).model);
  const hitQa = resQa.issues.find((issue) => issue.ruleId === 'unlinked-qa' && issue.entityId === 'AQ001');
  assert.ok(hitQa);
  assert.equal(hitQa.file, 'assurance/qa.yaml');
  assert.equal(hitQa.path, 'qa[0]');

  // 5. scene-without-goal-or-claim (and clears via claim-side scene_refs)
  const unlinkedScene = baseCleanFiles();
  unlinkedScene.scenes.scenes.push({
    id: 'SC002',
    title: 'Filler Scene',
    role: 'transition',
    timebox: { target: 1 },
    covers: {},
  });
  const resSc = await runNarrativeSemanticCheck(loadAndBuildNarrativeModel(createFixture(context, unlinkedScene)).model);
  const hitSc = resSc.issues.find(
    (issue) => issue.ruleId === 'scene-without-goal-or-claim' && issue.entityId === 'SC002',
  );
  assert.ok(hitSc);
  assert.equal(hitSc.file, 'orchestration/scenes.yaml');
  assert.equal(hitSc.path, 'scenes[1]');

  unlinkedScene.claims.claims[0].scene_refs = ['SC002'];
  const resScCleared = await runNarrativeSemanticCheck(
    loadAndBuildNarrativeModel(createFixture(context, unlinkedScene)).model,
  );
  assert.deepEqual(
    resScCleared.issues.filter((issue) => issue.ruleId === 'scene-without-goal-or-claim'),
    [],
  );
});

test('unused-scene-in-variants: silent without explicit scene_ids, flags unselected scenes when present', async (context) => {
  const base = baseCleanFiles();
  base.scenes.scenes.push({
    id: 'SC002',
    title: 'Bonus Scene',
    role: 'payoff',
    timebox: { target: 2 },
    supports_goals: ['G001'],
    covers: {},
  });

  // Zero variants -> clean.
  const noVariants = await runNarrativeSemanticCheck(loadAndBuildNarrativeModel(createFixture(context, base)).model);
  assert.deepEqual(noVariants.issues.filter((i) => i.ruleId === 'unused-scene-in-variants'), []);

  // Variant without explicit scene_ids -> clean.
  const implicit = {
    ...base,
    variants: { version: '1.0.0', variants: [{ id: 'DLV001', name: 'Full Talk' }] },
  };
  const resImplicit = await runNarrativeSemanticCheck(loadAndBuildNarrativeModel(createFixture(context, implicit)).model);
  assert.deepEqual(resImplicit.issues.filter((i) => i.ruleId === 'unused-scene-in-variants'), []);

  // Explicit selection picking SC001 only -> flags SC002.
  const partial = {
    ...base,
    variants: {
      version: '1.0.0',
      variants: [{ id: 'DLV001', name: 'Short Cut', scene_selection: { scene_ids: ['SC001'] } }],
    },
  };
  const resPartial = await runNarrativeSemanticCheck(loadAndBuildNarrativeModel(createFixture(context, partial)).model);
  const hit = resPartial.issues.find((i) => i.ruleId === 'unused-scene-in-variants' && i.entityId === 'SC002');
  assert.ok(hit);
  assert.equal(hit.file, 'orchestration/scenes.yaml');
  assert.equal(hit.path, 'scenes[1]');
});

test('asset-substitution-target-type: flags multiple bad fields per variant and suppresses missing or ambiguous targets', async (context) => {
  // Multiple bad substitution fields on one variant (replace_ref -> G001, with_ref -> SC001, plus second entry replace_ref -> C001).
  const multiBad = {
    ...baseCleanFiles(),
    variants: {
      version: '1.0.0',
      variants: [
        {
          id: 'DLV001',
          name: 'Broken Cut',
          asset_substitutions: [
            { replace_ref: 'G001', with_ref: 'SC001' },
            { replace_ref: 'C001', with_ref: 'A002' },
          ],
        },
      ],
    },
  };
  const resMulti = await runNarrativeSemanticCheck(loadAndBuildNarrativeModel(createFixture(context, multiBad)).model);
  const subHits = resMulti.issues.filter((i) => i.ruleId === 'asset-substitution-target-type');
  assert.equal(subHits.length, 3);
  assert.deepEqual(
    subHits.map((i) => ({ entityId: i.entityId, targetId: i.targetId, file: i.file, path: i.path })),
    [
      { entityId: 'DLV001', targetId: 'G001', file: 'delivery/variants.yaml', path: 'variants[0].asset_substitutions[0].replace_ref' },
      { entityId: 'DLV001', targetId: 'SC001', file: 'delivery/variants.yaml', path: 'variants[0].asset_substitutions[0].with_ref' },
      { entityId: 'DLV001', targetId: 'C001', file: 'delivery/variants.yaml', path: 'variants[0].asset_substitutions[1].replace_ref' },
    ],
  );

  // Missing target A999 and ambiguous duplicated target SC001 must both be suppressed.
  const missingAndAmbiguous = baseCleanFiles();
  missingAndAmbiguous.scenes.scenes.push({
    id: 'SC001',
    title: 'Duplicate Scene ID',
    role: 'teach',
    timebox: { target: 1 },
    supports_goals: ['G001'],
    covers: {},
  });
  missingAndAmbiguous.variants = {
    version: '1.0.0',
    variants: [
      {
        id: 'DLV001',
        name: 'Suppressed Cut',
        asset_substitutions: [
          { replace_ref: 'A999', with_ref: 'SC001' },
        ],
      },
    ],
  };
  const resSuppressed = await runNarrativeSemanticCheck(
    loadAndBuildNarrativeModel(createFixture(context, missingAndAmbiguous)).model,
  );
  assert.deepEqual(
    resSuppressed.issues.filter((i) => i.ruleId === 'asset-substitution-target-type'),
    [],
  );
});

test('timebox-ordering: handles zero, fractional, two findings on one scene, and min/max fallback', async (context) => {
  // Clean edge cases: zero target and fractional bounds.
  const clean = baseCleanFiles();
  clean.scenes.scenes.push({
    id: 'SC002',
    title: 'Zero Pause',
    role: 'transition',
    timebox: { min: 0, target: 0, max: 0 },
    supports_goals: ['G001'],
    covers: {},
  });
  const resClean = await runNarrativeSemanticCheck(loadAndBuildNarrativeModel(createFixture(context, clean)).model);
  assert.deepEqual(resClean.issues.filter((i) => i.ruleId === 'timebox-ordering'), []);

  // Two findings on one scene (min > target AND target > max), with min-max fallback suppressed.
  const bothPairs = baseCleanFiles();
  bothPairs.scenes.scenes[0].timebox = { min: 5, target: 3, max: 1 };
  const resBoth = await runNarrativeSemanticCheck(loadAndBuildNarrativeModel(createFixture(context, bothPairs)).model);
  const bothHits = resBoth.issues.filter((i) => i.ruleId === 'timebox-ordering');
  assert.equal(bothHits.length, 2);
  assert.deepEqual(
    bothHits.map((i) => i.path),
    ['scenes[0].timebox.max', 'scenes[0].timebox.min'],
  );

  // Fallback min > max when target is absent.
  const fallback = baseCleanFiles();
  fallback.scenes.scenes[0].timebox = { min: 4.5, max: 1.5 };
  const resFallback = await runNarrativeSemanticCheck(loadAndBuildNarrativeModel(createFixture(context, fallback)).model);
  const fallbackHits = resFallback.issues.filter((i) => i.ruleId === 'timebox-ordering');
  assert.equal(fallbackHits.length, 1);
  assert.equal(fallbackHits[0].path, 'scenes[0].timebox');
  assert.match(fallbackHits[0].message, /timebox\.min \(4\.5\) exceeds timebox\.max \(1\.5\)/);
});

test('honors .narrative-lint.yaml/.yml auto-discovery, explicit --config, strict mode, pre-built JSON, and exit 2 engine errors', (context) => {
  const faulty = baseCleanFiles();
  faulty.concepts.concepts.push({ id: 'C002', term: 'Orphan', definition: 'Unlinked.' });
  faulty.scenes.scenes[0].timebox = { min: 5, target: 1.5, max: 2 };
  const dir = createFixture(context, faulty);

  // Default non-strict -> exit 0 with 2 warnings.
  const nonStrict = runCli([dir, '--json']);
  assert.equal(nonStrict.status, 0, nonStrict.stderr);
  const nonStrictReport = JSON.parse(nonStrict.stdout);
  assert.equal(nonStrictReport.status, 'checked');
  assert.equal(nonStrictReport.passed, true);
  assert.equal(nonStrictReport.counts.warn, 2);

  // Strict -> exit 1.
  const strict = runCli([dir, '--strict', '--json']);
  assert.equal(strict.status, 1);
  assert.equal(JSON.parse(strict.stdout).passed, false);

  // Auto-discovered .narrative-lint.yml disables both rules -> exit 0 in strict mode.
  put(dir, '.narrative-lint.yml', YAML.stringify({
    rules: {
      'orphan-concepts': 'off',
      'timebox-ordering': 'off',
    },
  }));
  const discovered = loadNarrativeSemanticConfig(dir);
  assert.equal(path.basename(discovered.configPath ?? ''), '.narrative-lint.yml');
  const autoRun = runCli([dir, '--strict', '--json']);
  assert.equal(autoRun.status, 0, autoRun.stdout + autoRun.stderr);
  assert.equal(JSON.parse(autoRun.stdout).issues.length, 0);

  // Explicit --config promotes timebox-ordering to error -> exit 1 even without --strict.
  const explicitCfg = path.join(dir, 'custom.yaml');
  put(dir, 'custom.yaml', YAML.stringify({
    rules: {
      'orphan-concepts': 'off',
      'timebox-ordering': { severity: 'error' },
    },
  }));
  const explicitRun = runCli([dir, '--config', explicitCfg, '--json']);
  assert.equal(explicitRun.status, 1);
  const explicitReport = JSON.parse(explicitRun.stdout);
  assert.equal(explicitReport.counts.error, 1);
  assert.equal(explicitReport.passed, false);

  // Pre-built model.json works as direct input too.
  const { model } = loadAndBuildNarrativeModel(dir);
  const builtPath = path.join(dir, 'model.json');
  fs.writeFileSync(builtPath, JSON.stringify(model), 'utf8');
  const fromJson = runCli([builtPath, '--config', explicitCfg, '--json']);
  assert.equal(fromJson.status, 1);
  assert.deepEqual(JSON.parse(fromJson.stdout).issues, explicitReport.issues);

  // Engine / operational errors return exit 2 and status: 'engine_error' (distinct from findings).
  const badRulesPath = path.join(dir, 'bad-rules.yaml');
  put(dir, 'bad-rules.yaml', 'engineVersion: "9.9"\nrules: []\n');
  const engineErr = runCli([dir, '--rules', badRulesPath, '--json']);
  assert.equal(engineErr.status, 2);
  const engineReport = JSON.parse(engineErr.stdout);
  assert.equal(engineReport.status, 'engine_error');
  assert.equal(engineReport.exit_code, 2);
  assert.equal(engineReport.passed, false);
  assert.ok(engineReport.error.message.length > 0);

  const missingCfg = runCli([dir, '--config', path.join(dir, 'nope.yaml'), '--json']);
  assert.equal(missingCfg.status, 2);
  assert.equal(JSON.parse(missingCfg.stdout).status, 'engine_error');
});

test('checks deployed examples/public-deck cleanly in strict mode when present', () => {
  if (!fs.existsSync(path.join(DEPLOYED_EXAMPLE, 'narrative.yaml'))) {
    return;
  }
  const run = runCli([DEPLOYED_EXAMPLE, '--strict', '--json']);
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.status, 'checked');
  assert.equal(report.passed, true);
  assert.equal(report.rules_loaded, 8);
  assert.deepEqual(report.counts, { error: 0, warn: 0, info: 0 });
});

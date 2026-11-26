// @ts-check
// Portable unit and CLI tests for the Narrative model builder.
// Runs in both the deployed public repository and the monorepo without external fixtures.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  NARRATIVE_MODEL_PLANES,
  getBlockingPointerDiagnostics,
  loadAndBuildNarrativeModel,
  parseBuilderCliArgs,
} from './index.mjs';

const BUILDER_DIR = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.join(BUILDER_DIR, 'cli.mjs');
const DEPLOYED_EXAMPLE = path.resolve(BUILDER_DIR, '..', '..', 'examples', 'public-deck');

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
 * @param {import('node:test').TestContext} context
 */
function createSampleModel(context) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'narrative-builder-'));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  put(dir, 'narrative.yaml', YAML.stringify({
    version: '1.0.0',
    id: 'N001',
    name: 'Builder Test Model',
    planes: {
      intent: { folder: 'intent', intent: 'intent/intent.yaml' },
      knowledge: {
        folder: 'knowledge',
        concepts: 'knowledge/concepts.yaml',
        claims: 'knowledge/claims.yaml',
        evidence: 'knowledge/evidence.yaml',
        assets: 'knowledge/assets.yaml',
      },
      orchestration: { folder: 'orchestration', scenes: 'orchestration/scenes.yaml' },
      delivery: {
        folder: 'delivery',
        script: 'delivery/script.en-US.yaml',
        variants: 'delivery/variants.yaml',
      },
      assurance: { folder: 'assurance', qa: 'assurance/qa.yaml' },
    },
  }));

  put(dir, 'intent/intent.yaml', YAML.stringify({
    version: '1.0.0',
    goals: [{ id: 'G001', statement: 'Understand deterministic builds', priority: 'must' }],
  }));

  put(dir, 'knowledge/concepts.yaml', YAML.stringify({
    version: '1.0.0',
    concepts: [{ id: 'C001', term: 'Authored Graph', definition: 'Single source graph.' }],
  }));

  put(dir, 'knowledge/claims.yaml', YAML.stringify({
    version: '1.0.0',
    claims: [
      {
        id: 'CLM001',
        title: 'Claim side links scenes',
        strength: 'strong',
        supports_goals: ['G001'],
        key_terms: ['C001'],
        evidence_refs: ['E001'],
        scene_refs: ['SC001'],
      },
    ],
  }));

  put(dir, 'knowledge/evidence.yaml', YAML.stringify({
    version: '1.0.0',
    evidence: [
      {
        id: 'E001',
        title: 'Build log',
        kind: 'benchmark',
        backs_claims: ['CLM001'],
      },
    ],
  }));

  put(dir, 'knowledge/assets.yaml', YAML.stringify({
    version: '1.0.0',
    assets: [
      {
        id: 'A001',
        title: 'Pipeline diagram',
        kind: 'diagram',
        illustrates: { claims: ['CLM001'] },
      },
    ],
  }));

  put(dir, 'orchestration/scenes.yaml', YAML.stringify({
    version: '1.0.0',
    scenes: [
      {
        id: 'SC001',
        title: 'Opening',
        role: 'hook',
        timebox: { target: 3 },
        covers: { concepts: ['C001'], assets: ['A001'] },
        anticipated_questions: ['AQ001'],
      },
    ],
  }));

  put(dir, 'delivery/script.en-US.yaml', YAML.stringify({
    version: '1.0.0',
    narrative_id: 'N001',
    voice: { language: 'en-US' },
    script: {
      scenes: [{ scene_id: 'SC001', spoken_text: 'Opening spoken words.' }],
    },
  }));

  put(dir, 'delivery/variants.yaml', YAML.stringify({
    version: '1.0.0',
    variants: [
      {
        id: 'DLV001',
        name: 'Default cut',
        scene_selection: { scene_ids: ['SC001'] },
      },
    ],
  }));

  put(dir, 'assurance/qa.yaml', YAML.stringify({
    version: '1.0.0',
    qa: [{ id: 'AQ001', question: 'Why build JSON?', short_answer: 'Shared deterministic IR.' }],
  }));

  return dir;
}

/**
 * @param {string[]} args
 */
function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: BUILDER_DIR,
    encoding: 'utf8',
  });
}

test('model-builder sources contain zero workspace or tsx imports', () => {
  for (const name of ['index.mjs', 'cli.mjs']) {
    const text = fs.readFileSync(path.join(BUILDER_DIR, name), 'utf8');
    const importLines = text.split('\n').filter((line) => /^\s*import\s/.test(line));
    for (const line of importLines) {
      assert.doesNotMatch(line, /@archally\/|tsx/, `Disallowed import in ${name}: ${line}`);
    }
  }
});

test('accepts directory or manifest path and emits deterministic JSON with claim-side coverage', (context) => {
  const dir = createSampleModel(context);
  const manifestPath = path.join(dir, 'narrative.yaml');

  const fromDir = runCli([dir]);
  const fromManifest = runCli(['--model', manifestPath]);
  assert.equal(fromDir.status, 0, fromDir.stderr);
  assert.equal(fromManifest.status, 0, fromManifest.stderr);
  assert.equal(fromDir.stdout, fromManifest.stdout, 'directory and manifest inputs must emit identical bytes');

  const model = JSON.parse(fromDir.stdout);
  assert.equal(model.schema, 'narrative');
  assert.equal(model.schemaVersion, '1.0');
  assert.deepEqual(model.planes, [...NARRATIVE_MODEL_PLANES]);
  assert.equal(model.metadata.totalEntities, 9);
  assert.equal(model.metadata.manifestFile, 'narrative.yaml');
  assert.equal(model.diagnostics.length, 0);

  // Claim-side scene_refs produces covered_in_scene edge CLM001 -> SC001.
  const claimCoverage = model.relations.find(
    (rel) => rel.source === 'CLM001' && rel.target === 'SC001' && rel.type === 'covered_in_scene',
  );
  assert.ok(claimCoverage, 'expected claim-side covered_in_scene edge');
  assert.equal(claimCoverage.predicate, 'scene_refs');
  assert.deepEqual(claimCoverage.location, { file: 'knowledge/claims.yaml', path: 'claims[0].scene_refs[0]' });

  // Script-level null-source references (narrative_id, scene_id) must NOT become graph edges.
  assert.equal(model.relations.some((rel) => rel.type === 'script_words_scene'), false);
  assert.equal(model.relations.some((rel) => rel.type === 'script_for_narrative'), false);

  // Entity provenance and sorted IDs.
  const entityIds = model.entities.map((entity) => entity.id);
  assert.deepEqual(entityIds, [...entityIds].sort((a, b) => a.localeCompare(b)));
  const scene = model.entities.find((entity) => entity.id === 'SC001');
  assert.deepEqual(scene.location, { file: 'orchestration/scenes.yaml', path: 'scenes[0]' });
  assert.equal(model.occurrences.byIdCount.SC001, 1);

  // Output file and --stats modes.
  const outFile = path.join(dir, 'out', 'model.json');
  const writeRun = runCli([dir, '--pretty', '--output', outFile]);
  assert.equal(writeRun.status, 0, writeRun.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(outFile, 'utf8')), model);

  const statsRun = runCli([dir, '--stats']);
  assert.equal(statsRun.status, 0, statsRun.stderr);
  assert.equal(statsRun.stdout, '');
  assert.match(statsRun.stderr, /Entities:\s+9/);
});

test('distinguishes ambiguous and missing references and excludes non-resolved edges from relations', (context) => {
  const dir = createSampleModel(context);
  put(dir, 'knowledge/assets.yaml', YAML.stringify({
    version: '1.0.0',
    assets: [
      { id: 'A001', title: 'First asset', kind: 'diagram' },
      { id: 'A001', title: 'Duplicate asset', kind: 'diagram' },
    ],
  }));
  put(dir, 'knowledge/claims.yaml', YAML.stringify({
    version: '1.0.0',
    claims: [
      {
        id: 'CLM001',
        title: 'Mixed refs',
        strength: 'strong',
        supports_goals: ['G001'],
        evidence_refs: ['E999'],
        asset_refs: ['A001'],
        scene_refs: ['SC001'],
      },
    ],
  }));

  const { model } = loadAndBuildNarrativeModel(dir);
  assert.equal(model.occurrences.byIdCount.A001, 2);
  assert.equal(model.occurrences.byIdCount.E999, undefined);
  assert.equal(model.occurrences.duplicates.length, 1);
  assert.equal(model.occurrences.duplicates[0].id, 'A001');
  assert.equal(model.occurrences.duplicates[0].occurrences.length, 2);

  const assetEntity = model.entities.find((entity) => entity.id === 'A001');
  assert.equal(assetEntity.ambiguous, true);
  assert.equal(assetEntity.occurrences.length, 2);

  assert.ok(model.occurrences.unresolvedReferences.some((ref) => ref.targetId === 'E999'));
  assert.ok(model.occurrences.ambiguousReferences.some((ref) => ref.targetId === 'A001'));

  // Neither missing E999 nor ambiguous A001 may appear as a resolved relation endpoint.
  assert.equal(model.relations.some((rel) => rel.target === 'E999'), false);
  assert.equal(model.relations.some((rel) => rel.target === 'A001' || rel.source === 'A001'), false);
  // Valid CLM001 -> SC001 edge still resolves.
  assert.equal(model.relations.some((rel) => rel.source === 'CLM001' && rel.target === 'SC001'), true);
});

test('covers broken plane pointers and CLI exit 2 error handling', (context) => {
  const dir = createSampleModel(context);
  fs.rmSync(path.join(dir, 'knowledge/evidence.yaml'));

  const { model } = loadAndBuildNarrativeModel(dir);
  const blocking = getBlockingPointerDiagnostics(model);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0].code, 'missing_file');
  assert.equal(blocking[0].label, 'knowledge.evidence');
  assert.equal(Object.hasOwn(blocking[0], 'resolvedPath'), false, 'portable diagnostics omit absolute resolvedPath');

  const cliBroken = runCli([dir]);
  assert.equal(cliBroken.status, 2);
  assert.match(cliBroken.stderr, /Missing model file for knowledge\.evidence/);

  // Read-only broken delivery.slides does not fail CLI build.
  const slidesDir = createSampleModel(context);
  const manifest = YAML.parse(fs.readFileSync(path.join(slidesDir, 'narrative.yaml'), 'utf8'));
  manifest.planes.delivery.slides = 'delivery/slides.yaml';
  put(slidesDir, 'narrative.yaml', YAML.stringify(manifest));
  put(slidesDir, 'delivery/slides.yaml', 'slides: [unclosed');
  const slidesRun = runCli([slidesDir]);
  assert.equal(slidesRun.status, 0, slidesRun.stderr);

  const missingDir = runCli([path.join(os.tmpdir(), 'narrative-builder-missing-987654')]);
  assert.equal(missingDir.status, 2);

  const helpRun = runCli(['--help']);
  assert.equal(helpRun.status, 0);
  assert.match(helpRun.stdout, /Usage: narrative-model/);

  assert.throws(() => parseBuilderCliArgs(['node', 'cli.mjs', '--unknown']), /Unknown argument/);
  assert.throws(() => parseBuilderCliArgs(['node', 'cli.mjs', 'a', 'b']), /Unexpected extra positional argument/);
});

test('builds deployed examples/public-deck cleanly when present in the checkout', () => {
  if (!fs.existsSync(path.join(DEPLOYED_EXAMPLE, 'narrative.yaml'))) {
    return;
  }
  const run = runCli([DEPLOYED_EXAMPLE]);
  assert.equal(run.status, 0, run.stderr);
  const model = JSON.parse(run.stdout);
  assert.equal(model.metadata.diagnosticCount, 0);
  assert.ok(model.metadata.totalEntities > 0);
  assert.ok(model.metadata.totalRelations > 0);
});

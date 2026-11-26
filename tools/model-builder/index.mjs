// @ts-check
// Portable authored-graph model builder for Narrative v1 models.
// Reuses the standalone validator's reader and occurrence extractor so validation,
// model building, next-id, and semantic checking share one authored inventory.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { extractNarrativeOccurrences } from '../validator/core/occurrences.mjs';
import { NarrativeReadError, readNarrativeSource } from '../validator/core/reader.mjs';

export const NARRATIVE_MODEL_PLANES = Object.freeze([
  'root',
  'intent',
  'knowledge',
  'orchestration',
  'delivery',
  'assurance',
]);

/**
 * @param {{ file: string, path: string }} left
 * @param {{ file: string, path: string }} right
 * @returns {number}
 */
function compareLocations(left, right) {
  return left.file.localeCompare(right.file) || left.path.localeCompare(right.path);
}

/**
 * @template T
 * @param {readonly T[]} items
 * @param {(item: T) => string} keyOf
 * @returns {Record<string, number>}
 */
function countBySorted(items, keyOf) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  /** @type {Record<string, number>} */
  const sorted = {};
  for (const key of [...counts.keys()].sort((a, b) => a.localeCompare(b))) {
    sorted[key] = counts.get(key) ?? 0;
  }
  return sorted;
}

/**
 * @param {{ location: { file: string, path: string }, targetId: string, relationType: string }} left
 * @param {{ location: { file: string, path: string }, targetId: string, relationType: string }} right
 * @returns {number}
 */
function compareRefs(left, right) {
  return (
    compareLocations(left.location, right.location) ||
    left.targetId.localeCompare(right.targetId) ||
    left.relationType.localeCompare(right.relationType)
  );
}

/**
 * @param {any} ref
 */
function toSerializableReference(ref) {
  return {
    sourceId: ref.sourceId,
    targetId: ref.targetId,
    relationType: ref.relationType,
    field: ref.field,
    plane: ref.plane,
    pointerLabel: ref.pointerLabel,
    ...(ref.language !== undefined ? { language: ref.language } : {}),
    location: ref.location,
  };
}

/**
 * @param {any} diagnostic
 */
function toSerializableDiagnostic(diagnostic) {
  return {
    code: diagnostic.code,
    plane: diagnostic.plane,
    role: diagnostic.role,
    label: diagnostic.label,
    pointerPath: diagnostic.pointerPath,
    declaredFile: diagnostic.declaredFile,
    required: diagnostic.required,
    message: diagnostic.message,
    location: diagnostic.location,
  };
}

/**
 * Assemble a deterministic, path-portable authored Narrative graph JSON object
 * from a pre-loaded NarrativeSource.
 *
 * @param {any} source
 */
export function buildNarrativeModelFromSource(source) {
  const extracted = extractNarrativeOccurrences(source);

  /** @type {Map<string, any[]>} */
  const occurrencesById = new Map();
  for (const occ of extracted.entityOccurrences) {
    const list = occurrencesById.get(occ.id);
    if (list) {
      list.push(occ);
    } else {
      occurrencesById.set(occ.id, [occ]);
    }
  }

  /** @type {Map<string, any[]>} */
  const externalByOwner = new Map();
  for (const ext of extracted.externalLinks) {
    const list = externalByOwner.get(ext.ownerId);
    if (list) {
      list.push(ext);
    } else {
      externalByOwner.set(ext.ownerId, [ext]);
    }
  }

  /** @type {any[]} */
  const entities = [];
  for (const [id, occs] of occurrencesById.entries()) {
    const primary = occs[0];
    entities.push({
      id,
      type: primary.entityType,
      plane: primary.plane,
      pointerLabel: primary.pointerLabel,
      name: primary.name,
      ...(primary.parentId !== undefined ? { parentId: primary.parentId } : {}),
      ...(primary.language !== undefined ? { language: primary.language } : {}),
      location: primary.location,
      occurrences: occs.map((occ) => occ.location),
      ambiguous: occs.length > 1,
      externalLinks: externalByOwner.get(id) ?? [],
      data: primary.data,
    });
  }
  entities.sort((a, b) => a.id.localeCompare(b.id) || compareLocations(a.location, b.location));

  /** @type {Map<string, any>} */
  const relationMap = new Map();
  for (const ref of extracted.references) {
    if (!ref.sourceId || !ref.resolved) {
      continue;
    }
    const sourceOccs = occurrencesById.get(ref.sourceId);
    if (!sourceOccs || sourceOccs.length !== 1) {
      continue;
    }

    const relId = `${ref.sourceId}--${ref.relationType}--${ref.targetId}`;
    const existing = relationMap.get(relId);
    if (existing) {
      const alreadyPresent = existing.occurrences.some(
        (loc) => loc.file === ref.location.file && loc.path === ref.location.path,
      );
      if (!alreadyPresent) {
        existing.occurrences.push(ref.location);
        existing.occurrences.sort(compareLocations);
      }
    } else {
      relationMap.set(relId, {
        id: relId,
        source: ref.sourceId,
        target: ref.targetId,
        type: ref.relationType,
        predicate: ref.field,
        plane: ref.plane,
        location: ref.location,
        occurrences: [ref.location],
      });
    }
  }

  const relations = [...relationMap.values()].sort((a, b) => a.id.localeCompare(b.id));

  /** @type {Record<string, number>} */
  const byIdCount = {};
  for (const id of [...occurrencesById.keys()].sort((a, b) => a.localeCompare(b))) {
    byIdCount[id] = occurrencesById.get(id)?.length ?? 0;
  }

  const duplicates = extracted.duplicates.map((dup) => ({
    id: dup.id,
    occurrences: dup.occurrences.map((occ) => ({
      entityType: occ.entityType,
      plane: occ.plane,
      pointerLabel: occ.pointerLabel,
      location: occ.location,
    })),
  }));

  const unresolvedReferences = extracted.unresolvedReferences
    .map(toSerializableReference)
    .sort(compareRefs);

  const ambiguousReferences = extracted.ambiguousReferences
    .map(toSerializableReference)
    .sort(compareRefs);

  const diagnostics = (source.diagnostics ?? []).map(toSerializableDiagnostic);

  const rootVersion = typeof source.root?.version === 'string' ? source.root.version : null;

  return {
    schema: 'narrative',
    schemaVersion: '1.0',
    planes: [...NARRATIVE_MODEL_PLANES],
    entities,
    relations,
    occurrences: {
      byIdCount,
      duplicates,
      unresolvedReferences,
      ambiguousReferences,
    },
    diagnostics,
    metadata: {
      name: source.name ?? null,
      id: source.id ?? null,
      version: rootVersion,
      schemaVersion: '1.0',
      manifestFile: source.manifestFile,
      totalEntities: entities.length,
      totalRelations: relations.length,
      totalEntityOccurrences: extracted.entityOccurrences.length,
      duplicateIdCount: duplicates.length,
      unresolvedReferenceCount: unresolvedReferences.length,
      ambiguousReferenceCount: ambiguousReferences.length,
      diagnosticCount: diagnostics.length,
      entityTypeCounts: countBySorted(entities, (entity) => entity.type),
      planeCounts: countBySorted(entities, (entity) => entity.plane),
      relationTypeCounts: countBySorted(relations, (relation) => relation.type),
    },
  };
}

/**
 * Load a Narrative model directory or manifest file and build its authored graph JSON object.
 *
 * @param {string} inputPath
 */
export function loadAndBuildNarrativeModel(inputPath) {
  const source = readNarrativeSource(inputPath);
  return {
    source,
    model: buildNarrativeModelFromSource(source),
  };
}

/**
 * Return pointer diagnostics that prevent building a complete authored model.
 * Read-only legacy delivery.slides entries never fail a build.
 *
 * @param {{ diagnostics?: Array<{ role?: string, code?: string, message?: string }> }} model
 */
export function getBlockingPointerDiagnostics(model) {
  const diagnostics = Array.isArray(model.diagnostics) ? model.diagnostics : [];
  return diagnostics.filter((diag) => diag.role !== 'slides');
}

/**
 * Return CLI help text.
 *
 * @returns {string}
 */
export function getBuilderHelpText() {
  return [
    'Usage: narrative-model [PATH] [--model PATH] [--output PATH] [--pretty] [--stats] [--help]',
    '',
    'Builds a deterministic authored-graph model.json from a Narrative directory or manifest.',
    '',
    'Arguments:',
    '  PATH            Path to a directory containing narrative.yaml or a manifest file',
    '',
    'Options:',
    '  --model, -m     Path to a Narrative directory or manifest (default: .narrative/v1)',
    '  --output, -o    Write JSON output to a file instead of stdout',
    '  --pretty, -p    Pretty-print JSON with 2-space indentation',
    '  --stats         Print entity, plane, and relation counts to stderr and exit',
    '  --help, -h      Show this help message',
    '',
    'Exit codes:',
    '  0  Model built cleanly',
    '  2  Usage, manifest load, or broken plane pointer error',
  ].join('\n');
}

/**
 * Parse model-builder CLI arguments.
 *
 * @param {readonly string[]} argv
 */
export function parseBuilderCliArgs(argv) {
  const args = {
    model: path.resolve('.narrative/v1'),
    output: /** @type {string | null} */ (null),
    pretty: false,
    stats: false,
    help: false,
  };

  let modelSet = false;

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--pretty' || token === '-p') {
      args.pretty = true;
      continue;
    }
    if (token === '--stats') {
      args.stats = true;
      continue;
    }
    if (token === '--model' || token === '-m') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${token}`);
      }
      args.model = path.resolve(value);
      modelSet = true;
      i += 1;
      continue;
    }
    if (token === '--output' || token === '-o') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${token}`);
      }
      args.output = path.resolve(value);
      i += 1;
      continue;
    }
    if (token.startsWith('-')) {
      throw new Error(`Unknown argument: ${token}`);
    }
    if (modelSet) {
      throw new Error(`Unexpected extra positional argument: ${token}`);
    }
    args.model = path.resolve(token);
    modelSet = true;
  }

  return args;
}

/**
 * Format summary statistics for stderr display.
 *
 * @param {any} model
 * @returns {string}
 */
export function formatBuilderStats(model) {
  /** @type {string[]} */
  const lines = [];
  lines.push(`Entities:  ${model.metadata.totalEntities}`);
  lines.push(`Relations: ${model.metadata.totalRelations}`);
  lines.push('');
  lines.push('Entity types:');
  for (const [type, count] of Object.entries(model.metadata.entityTypeCounts)) {
    lines.push(`  ${type}: ${count}`);
  }
  lines.push('');
  lines.push('Planes:');
  for (const [plane, count] of Object.entries(model.metadata.planeCounts)) {
    lines.push(`  ${plane}: ${count}`);
  }
  lines.push('');
  lines.push('Relation types:');
  for (const [type, count] of Object.entries(model.metadata.relationTypeCounts)) {
    lines.push(`  ${type}: ${count}`);
  }
  return lines.join('\n');
}

/**
 * Execute the model-builder CLI, returning exit code 0 or 2.
 *
 * @param {readonly string[]} [argv]
 * @param {{ io?: { stdout: (text: string) => void, stderr: (text: string) => void } }} [options]
 * @returns {0 | 2}
 */
export function runBuilderCli(argv = process.argv, options = {}) {
  const io = options.io ?? {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => console.error(text),
  };

  let args;
  try {
    args = parseBuilderCliArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`Model builder failed: ${message}`);
    return 2;
  }

  if (args.help) {
    io.stdout(`${getBuilderHelpText()}\n`);
    return 0;
  }

  let built;
  try {
    built = loadAndBuildNarrativeModel(args.model);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`Model builder failed: ${message}`);
    return 2;
  }

  const blocking = getBlockingPointerDiagnostics(built.model);
  if (blocking.length > 0) {
    io.stderr('Model builder failed with pointer errors:');
    for (const diag of blocking) {
      io.stderr(`  - ${diag.message}`);
    }
    return 2;
  }

  if (args.stats) {
    io.stderr(formatBuilderStats(built.model));
    return 0;
  }

  const json = `${JSON.stringify(built.model, null, args.pretty ? 2 : undefined)}\n`;
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, json, 'utf8');
    io.stderr(`Entities:  ${built.model.metadata.totalEntities}`);
    io.stderr(`Relations: ${built.model.metadata.totalRelations}`);
    io.stderr(`Written:   ${args.output}`);
    return 0;
  }

  io.stdout(json);
  return 0;
}

export { NarrativeReadError };

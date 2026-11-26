// @ts-check
// Read-only next-ID allocator for Narrative models.
// Reads a built model.json snapshot and validates prefixes against the shipped metamodel schema.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const NEXT_ID_DIR = path.dirname(fileURLToPath(import.meta.url));
const PREFIX_KEY_RE = /^[A-Z]{1,5}$/;

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function compareVersionLinesDesc(left, right) {
  const leftParts = left.slice(1).split('.').map(Number);
  const rightParts = right.slice(1).split('.').map(Number);
  const majorDiff = (rightParts[0] ?? 0) - (leftParts[0] ?? 0);
  if (majorDiff !== 0) {
    return majorDiff;
  }
  return (rightParts[1] ?? 0) - (leftParts[1] ?? 0);
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Auto-detect the default Narrative metamodel schema path relative to this tool.
 * Checks deployed `../../schema/v1.6/narrative.metamodel.schema.yaml`, then highest
 * `../../schema/v<major>.<minor>`, then monorepo `../../v1/schema`.
 *
 * @param {string} [baseDir]
 * @returns {string}
 */
export function resolveDefaultMetamodelPath(baseDir = NEXT_ID_DIR) {
  const deployedSchemaParent = path.resolve(baseDir, '..', '..', 'schema');
  const pinnedCandidate = path.join(deployedSchemaParent, 'v1.6', 'narrative.metamodel.schema.yaml');
  if (fs.existsSync(pinnedCandidate)) {
    return pinnedCandidate;
  }
  if (fs.existsSync(deployedSchemaParent) && fs.statSync(deployedSchemaParent).isDirectory()) {
    const versionLines = fs.readdirSync(deployedSchemaParent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^v\d+\.\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareVersionLinesDesc);
    for (const line of versionLines) {
      const candidate = path.join(deployedSchemaParent, line, 'narrative.metamodel.schema.yaml');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  const sourceCandidate = path.resolve(baseDir, '..', '..', 'v1', 'schema', 'narrative.metamodel.schema.yaml');
  if (fs.existsSync(sourceCandidate)) {
    return sourceCandidate;
  }
  return path.resolve('schema/v1.6/narrative.metamodel.schema.yaml');
}

/**
 * Load the schema-backed authored ID prefix allowlist from `narrative.metamodel.schema.yaml`.
 * Reads `x-gdsm.schema_graph` and admits only entries backed by a shipped schema file
 * (excluding reserved entries whose `schema` is null).
 *
 * @param {string} [metamodelPath]
 * @returns {Map<string, { prefix: string, schema: string, entity: string, description: string }>}
 */
export function loadAllowedPrefixes(metamodelPath = resolveDefaultMetamodelPath()) {
  const resolved = path.resolve(metamodelPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Narrative metamodel schema not found: ${resolved}`);
  }
  const parsed = YAML.parse(fs.readFileSync(resolved, 'utf8'));
  const schemaGraph = parsed?.['x-gdsm']?.schema_graph;
  if (!schemaGraph || typeof schemaGraph !== 'object' || Array.isArray(schemaGraph)) {
    throw new Error(`Missing x-gdsm.schema_graph prefix inventory in ${resolved}`);
  }

  /** @type {Map<string, { prefix: string, schema: string, entity: string, description: string }>} */
  const allowed = new Map();
  for (const key of Object.keys(schemaGraph).sort((a, b) => a.localeCompare(b))) {
    if (!PREFIX_KEY_RE.test(key)) {
      continue;
    }
    const entry = schemaGraph[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    if (typeof entry.schema !== 'string' || entry.schema.trim().length === 0) {
      continue;
    }
    allowed.set(key, {
      prefix: key,
      schema: entry.schema,
      entity: typeof entry.entity === 'string' ? entry.entity : key,
      description: typeof entry.description === 'string' ? entry.description : '',
    });
  }

  if (allowed.size === 0) {
    throw new Error(`No schema-backed ID prefixes found in ${resolved}`);
  }
  return allowed;
}

/**
 * Suggest the next unused three-digit authored ID for `prefix` from a built model snapshot.
 * Inspects only authored `model.entities` (ignoring reference-only IDs).
 *
 * @param {unknown} model
 * @param {string} prefix
 * @param {ReadonlyMap<string, unknown>} allowedPrefixes
 * @returns {string}
 */
export function suggestNextId(model, prefix, allowedPrefixes) {
  if (typeof prefix !== 'string' || !allowedPrefixes.has(prefix)) {
    const known = [...allowedPrefixes.keys()].join(', ');
    throw new Error(`Unknown Narrative prefix: ${String(prefix)}. Known prefixes: ${known}`);
  }
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw new Error('Expected a built model JSON object with an entities array');
  }
  const entities = /** @type {Record<string, unknown>} */ (model).entities;
  if (!Array.isArray(entities)) {
    throw new Error('Expected a built model with an entities array');
  }

  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d{3})$`);
  let maximum = 0;

  for (const entity of entities) {
    if (!entity || typeof entity !== 'object' || Array.isArray(entity)) {
      throw new Error('Malformed built model: every entry in entities must be an object');
    }
    const id = /** @type {Record<string, unknown>} */ (entity).id;
    if (typeof id !== 'string') {
      throw new Error('Malformed built model: every entity must carry a string id');
    }
    const match = pattern.exec(id);
    if (match) {
      maximum = Math.max(maximum, Number(match[1]));
    }
  }

  if (maximum >= 999) {
    throw new Error(`Three-digit prefix range exhausted for ${prefix}`);
  }

  return `${prefix}${String(maximum + 1).padStart(3, '0')}`;
}

/**
 * Return CLI help text.
 *
 * @returns {string}
 */
export function getNextIdHelpText() {
  return [
    'Usage: narrative-next-id <model.json> <PREFIX> [--metamodel PATH] [--list] [--help]',
    '',
    'Suggests the next available 3-digit Narrative entity ID from a built model.json snapshot.',
    'Each call reads the snapshot only; rebuild model.json before allocating again after concurrent edits.',
    '',
    'Options:',
    '  --metamodel, -s  Path to narrative.metamodel.schema.yaml (auto-detected by default)',
    '  --list           List all schema-backed Narrative ID prefixes and exit',
    '  --help, -h       Show this help message',
    '',
    'Exit codes:',
    '  0  Suggested ID printed to stdout (or prefix list printed)',
    '  2  Usage error, unknown prefix, malformed model.json, or range exhausted at 999',
  ].join('\n');
}

/**
 * Parse next-id CLI arguments.
 *
 * @param {readonly string[]} argv
 * @param {string} [defaultMetamodelPath]
 */
export function parseNextIdCliArgs(argv, defaultMetamodelPath) {
  const args = {
    modelFile: /** @type {string | null} */ (null),
    prefix: /** @type {string | null} */ (null),
    metamodel: defaultMetamodelPath ? path.resolve(defaultMetamodelPath) : resolveDefaultMetamodelPath(),
    list: false,
    help: false,
  };

  /** @type {string[]} */
  const positional = [];

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--list') {
      args.list = true;
      continue;
    }
    if (token === '--metamodel' || token === '-s') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${token}`);
      }
      args.metamodel = path.resolve(value);
      i += 1;
      continue;
    }
    if (token.startsWith('-')) {
      throw new Error(`Unknown argument: ${token}`);
    }
    positional.push(token);
  }

  if (args.help || args.list) {
    if (positional.length > 0) {
      throw new Error(`Unexpected positional argument: ${positional[0]}`);
    }
    return args;
  }

  if (positional.length !== 2) {
    throw new Error('Usage: narrative-next-id <model.json> <PREFIX> [--metamodel PATH]');
  }

  args.modelFile = path.resolve(positional[0]);
  args.prefix = positional[1];
  return args;
}

/**
 * Execute the next-id CLI, returning exit code 0 or 2.
 *
 * @param {readonly string[]} [argv]
 * @param {{ defaultMetamodelPath?: string, io?: { stdout: (text: string) => void, stderr: (text: string) => void } }} [options]
 * @returns {0 | 2}
 */
export function runNextIdCli(argv = process.argv, options = {}) {
  const io = options.io ?? {
    stdout: (text) => console.log(text),
    stderr: (text) => console.error(text),
  };

  let args;
  try {
    args = parseNextIdCliArgs(argv, options.defaultMetamodelPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(message);
    return 2;
  }

  if (args.help) {
    io.stdout(getNextIdHelpText());
    return 0;
  }

  let allowedPrefixes;
  try {
    allowedPrefixes = loadAllowedPrefixes(args.metamodel);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(message);
    return 2;
  }

  if (args.list) {
    for (const entry of allowedPrefixes.values()) {
      io.stdout(`${entry.prefix}\t${entry.entity}\t${entry.schema}`);
    }
    return 0;
  }

  if (!args.modelFile || !args.prefix) {
    io.stderr('Usage: narrative-next-id <model.json> <PREFIX> [--metamodel PATH]');
    return 2;
  }

  if (!fs.existsSync(args.modelFile)) {
    io.stderr(`Built model file not found: ${args.modelFile}`);
    return 2;
  }

  let parsedModel;
  try {
    parsedModel = JSON.parse(fs.readFileSync(args.modelFile, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`Invalid model JSON (${args.modelFile}): ${message}`);
    return 2;
  }

  try {
    const next = suggestNextId(parsedModel, args.prefix, allowedPrefixes);
    io.stdout(next);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(message);
    return 2;
  }
}

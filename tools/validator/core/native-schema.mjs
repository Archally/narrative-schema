// @ts-check
// Narrative Ajv2020 schema registry for native `$id` URNs (`urn:narrative:*`).
// Preserves the schema suite's format policy (Ajv2020 without `ajv-formats`) so
// strict and compat validation verdicts remain deterministic across layouts.

import { suppressConditionalWrapper } from './story-time.mjs';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import Ajv2020Import from 'ajv/dist/2020.js';

/** @type {any} */
const Ajv2020 = typeof Ajv2020Import === 'function'
  ? Ajv2020Import
  : /** @type {any} */ (Ajv2020Import).default;

export const REQUIRED_NARRATIVE_SCHEMA_URNS = Object.freeze([
  'urn:narrative:talk:1.0.0',
  'urn:narrative:intent:1.0.0',
  'urn:narrative:concepts:1.0.0',
  'urn:narrative:claims:1.0.0',
  'urn:narrative:evidence:1.0.0',
  'urn:narrative:assets:1.0.0',
  'urn:narrative:storyworld:1.0.0',
  'urn:narrative:scenes:1.0.0',
  'urn:narrative:scenes:1.1.0',
  'urn:narrative:script:1.0.0',
  'urn:narrative:variants:1.0.0',
  'urn:narrative:qa:1.0.0',
  'urn:narrative:rehearsal:1.0.0',
  'urn:narrative:views:1.0.0',
  'urn:narrative:film:1.0.0',
]);

export class NarrativeSchemaRegistryError extends Error {
  /**
   * @param {string} message
   * @param {string} targetPath
   */
  constructor(message, targetPath) {
    super(message);
    this.name = 'NarrativeSchemaRegistryError';
    this.path = targetPath;
  }
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function walkSchemaFiles(dir) {
  /** @type {string[]} */
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (full.endsWith('.schema.yaml')) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

/**
 * @param {readonly { instancePath?: string, message?: string, keyword: string, schemaPath: string, params: { failingKeyword?: string } }[] | null | undefined} errors
 * @param {string} [resource]
 * @returns {{ instancePath: string, message: string, formatted: string }[]}
 */
export function formatAjvErrors(errors, resource) {
  if (!errors || errors.length === 0) {
    return [];
  }
  return errors.filter((err) => !suppressConditionalWrapper(err, resource)).map((err) => {
    const instancePath = err.instancePath || '/';
    const message = err.message ?? 'schema error';
    return {
      instancePath,
      message,
      formatted: `${instancePath} -> ${message}`,
    };
  });
}

/**
 * Resolve a schemas input directory to the folder that holds `*.schema.yaml` files.
 * Accepts either:
 *   1. A direct versioned schema folder (such as `schema/v1.5`) containing `narrative.talk.schema.yaml`, or
 *   2. A suite directory containing a `schema/` subdirectory.
 *
 * @param {string} schemasInputDir
 * @returns {{ suiteDir: string, schemaRoot: string }}
 */
export function resolveSchemaLocations(schemasInputDir) {
  const resolved = path.resolve(schemasInputDir);
  if (fs.existsSync(path.join(resolved, 'narrative.talk.schema.yaml'))) {
    return { suiteDir: resolved, schemaRoot: resolved };
  }
  const nestedSchema = path.join(resolved, 'schema');
  if (fs.existsSync(nestedSchema) && fs.statSync(nestedSchema).isDirectory()) {
    return { suiteDir: resolved, schemaRoot: nestedSchema };
  }
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    const topEntries = fs.readdirSync(resolved);
    if (topEntries.some((name) => name.endsWith('.schema.yaml'))) {
      return { suiteDir: resolved, schemaRoot: resolved };
    }
  }
  throw new NarrativeSchemaRegistryError(`Schema folder not found: ${nestedSchema}`, nestedSchema);
}

/**
 * Load all `*.schema.yaml` files under the resolved schema folder into an Ajv2020 registry
 * keyed by native `$id` URNs.
 *
 * @param {string} schemasInputDir
 */
export function loadNarrativeSchemaRegistry(schemasInputDir) {
  const { suiteDir, schemaRoot } = resolveSchemaLocations(schemasInputDir);

  /** @type {string[]} */
  let schemaFiles;
  try {
    schemaFiles = walkSchemaFiles(schemaRoot);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new NarrativeSchemaRegistryError(`Cannot read schema folder ${schemaRoot}: ${reason}`, schemaRoot);
  }

  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateSchema: false,
  });

  for (const file of schemaFiles) {
    /** @type {unknown} */
    let parsed;
    try {
      parsed = YAML.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new NarrativeSchemaRegistryError(`Cannot parse schema file ${file}: ${reason}`, file);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new NarrativeSchemaRegistryError(`Invalid schema file ${file}: expected a YAML object`, file);
    }
    try {
      ajv.addSchema(parsed);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new NarrativeSchemaRegistryError(`Cannot register schema ${file}: ${reason}`, file);
    }
  }

  /** @type {Map<string, any>} */
  const validators = new Map();
  for (const urn of REQUIRED_NARRATIVE_SCHEMA_URNS) {
    const validate = ajv.getSchema(urn);
    if (!validate) {
      throw new NarrativeSchemaRegistryError(`Missing schema in registry: ${urn}`, schemaRoot);
    }
    validators.set(urn, validate);
  }

  const scenesSchemaV1 = /** @type {Record<string, unknown>} */ (validators.get('urn:narrative:scenes:1.0.0').schema);
  const scenesSchemaV1_1 = /** @type {Record<string, unknown>} */ (validators.get('urn:narrative:scenes:1.1.0').schema);

  return {
    suiteDir,
    schemaRoot,
    /** @param {string} urn */
    getValidator(urn) {
      return validators.get(urn);
    },
    /** @param {string | null} [urn] */
    getScenesSchema(urn) {
      return urn === 'urn:narrative:scenes:1.1.0' ? scenesSchemaV1_1 : scenesSchemaV1;
    },
  };
}

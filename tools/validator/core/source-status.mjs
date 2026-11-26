// @ts-check
// Source-loading and schema-availability classification for Narrative validation.
// Separates hard load failures (exit 2) from loaded-source validation findings (exit 1).
// Read-only authored slides (`delivery.slides`) never trigger a load error or baseline finding.

import path from 'node:path';
import { NarrativeReadError, readNarrativeSource } from './reader.mjs';
import { NarrativeSchemaRegistryError, loadNarrativeSchemaRegistry } from './native-schema.mjs';

/**
 * Load schemas and authored Narrative source for validation, returning a structured
 * load-error result instead of throwing for expected operational failures.
 *
 * @param {string} modelInputPath
 * @param {string} schemasInputDir
 */
export function loadValidationInputs(modelInputPath, schemasInputDir) {
  const attemptedModelPath = path.resolve(modelInputPath);
  const attemptedSchemasPath = path.resolve(schemasInputDir);

  let registry;
  try {
    registry = loadNarrativeSchemaRegistry(attemptedSchemasPath);
  } catch (error) {
    if (error instanceof NarrativeSchemaRegistryError) {
      return {
        status: /** @type {const} */ ('load_error'),
        source: null,
        registry: null,
        schemaBackedPointers: [],
        loadError: {
          code: 'schemas_unavailable',
          path: error.path,
          message: error.message,
        },
        attemptedModelPath,
        attemptedSchemasPath,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: /** @type {const} */ ('load_error'),
      source: null,
      registry: null,
      schemaBackedPointers: [],
      loadError: {
        code: 'schemas_unavailable',
        path: attemptedSchemasPath,
        message,
      },
      attemptedModelPath,
      attemptedSchemasPath,
    };
  }

  let source;
  try {
    source = readNarrativeSource(attemptedModelPath);
  } catch (error) {
    if (error instanceof NarrativeReadError) {
      return {
        status: /** @type {const} */ ('load_error'),
        source: null,
        registry,
        schemaBackedPointers: [],
        loadError: {
          code: error.code,
          path: error.path ?? attemptedModelPath,
          message: error.message,
        },
        attemptedModelPath: error.path ?? attemptedModelPath,
        attemptedSchemasPath,
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: /** @type {const} */ ('load_error'),
      source: null,
      registry,
      schemaBackedPointers: [],
      loadError: {
        code: 'manifest_read_error',
        path: attemptedModelPath,
        message,
      },
      attemptedModelPath,
      attemptedSchemasPath,
    };
  }

  const schemaBackedPointers = source.pointers.filter(
    (pointer) => !pointer.readOnly && pointer.schemaUrn !== null,
  );

  for (const pointer of schemaBackedPointers) {
    if (pointer.status === 'unreadable' || pointer.status === 'parse_error') {
      const diag = source.diagnostics.find(
        (d) =>
          d.label === pointer.label &&
          (d.code === 'read_error' || d.code === 'parse_error'),
      );
      const code = pointer.status === 'parse_error' ? 'plane_parse_error' : 'plane_read_error';
      return {
        status: /** @type {const} */ ('load_error'),
        source,
        registry,
        schemaBackedPointers,
        loadError: {
          code,
          path: pointer.resolvedPath ?? source.manifestPath,
          message:
            diag?.message ??
            `Failed to load ${pointer.label} (${pointer.declaredFile ?? 'unknown file'})`,
        },
        attemptedModelPath: source.manifestPath,
        attemptedSchemasPath,
      };
    }
  }

  return {
    status: /** @type {const} */ ('loaded'),
    source,
    registry,
    schemaBackedPointers,
    loadError: null,
  };
}

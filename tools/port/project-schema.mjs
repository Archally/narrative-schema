// @ts-check
// Deterministic projection of Narrative JSON Schema YAML files for public release.
// Strips internal schema-building metadata under x-gdsm while preserving every JSON Schema
// validation keyword, $id URN, $ref pointer, consumer x-gdsm field, and surrounding comments.

import { readFileSync } from 'node:fs';
import { parseDocument, isMap } from 'yaml';

export const DEFAULT_STRIP_X_GDSM_KEYS = Object.freeze([
  'modeling_guidance',
  'fitness',
  'competency_questions',
  'tasks',
  'designed_for',
]);

/**
 * Normalize line endings to LF.
 * @param {string} text
 * @returns {string}
 */
export function normalizeLineEndings(text) {
  return text.replace(/\r\n/g, '\n');
}

/**
 * Project a Narrative schema YAML document by stripping the listed x-gdsm subkeys.
 * Returns LF-normalized YAML text. Files without any targeted x-gdsm keys are returned
 * byte-for-byte unchanged (after LF normalization).
 *
 * @param {string} sourceText
 * @param {readonly string[]} [stripKeys]
 * @returns {string}
 */
export function projectSchemaText(sourceText, stripKeys = DEFAULT_STRIP_X_GDSM_KEYS) {
  const normalized = normalizeLineEndings(sourceText);
  const document = parseDocument(normalized);
  if (document.errors.length > 0) {
    const firstError = document.errors[0].message;
    throw new Error(`Invalid YAML schema during projection: ${firstError}`);
  }
  const xGdsm = document.get('x-gdsm', true);
  let changed = false;
  if (isMap(xGdsm)) {
    for (const key of stripKeys) {
      if (xGdsm.has(key)) {
        xGdsm.delete(key);
        changed = true;
      }
    }
    if (changed && xGdsm.items.length === 0) {
      document.delete('x-gdsm');
    }
  }
  if (!changed) {
    return normalized;
  }
  const rendered = normalizeLineEndings(document.toString({ lineWidth: 0 }));
  if (normalized.endsWith('\n') && !rendered.endsWith('\n')) {
    return `${rendered}\n`;
  }
  return rendered;
}

/**
 * Read and deterministically project a Narrative schema file from disk.
 *
 * @param {string} filePath
 * @param {readonly string[]} [stripKeys]
 * @returns {string}
 */
export function projectSchemaFile(filePath, stripKeys = DEFAULT_STRIP_X_GDSM_KEYS) {
  return projectSchemaText(readFileSync(filePath, 'utf8'), stripKeys);
}

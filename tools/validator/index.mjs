// @ts-check
// Public programmatic entry point and CLI runner for the standalone Narrative validator.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { collectGraphFindings, validateNarrative } from './core/baseline.mjs';
import {
  REQUIRED_NARRATIVE_SCHEMA_URNS,
  NarrativeSchemaRegistryError,
  formatAjvErrors,
  loadNarrativeSchemaRegistry,
  resolveSchemaLocations,
} from './core/native-schema.mjs';
import { extractNarrativeOccurrences } from './core/occurrences.mjs';
import {
  NARRATIVE_PLANES,
  NARRATIVE_ROOT_SCHEMA_URN,
  NARRATIVE_SCENES_SCHEMA_URN_V1,
  NARRATIVE_SCENES_SCHEMA_URN_V1_1,
  NARRATIVE_STORYWORLD_SCHEMA_URN,
  NarrativeReadError,
  readNarrativeSource,
  resolveManifestPath,
  resolveScenesSchemaUrn,
} from './core/reader.mjs';
import { loadValidationInputs } from './core/source-status.mjs';

const VALIDATOR_DIR = path.dirname(fileURLToPath(import.meta.url));

/**
 * Compare two `v<major>.<minor>` directory names descending.
 *
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
 * Auto-detect the default Narrative schema folder relative to this validator module.
 * Checks deployed `../../schema/v1.6` (and highest `v<major>.<minor>` under `../../schema`),
 * then falls back to `../../v1/schema` and `./schema/v1.6`.
 *
 * @param {string} [baseDir]
 * @returns {string}
 */
export function resolveDefaultSchemasDir(baseDir = VALIDATOR_DIR) {
  const deployedSchemaParent = path.resolve(baseDir, '..', '..', 'schema');
  const pinnedLine = path.join(deployedSchemaParent, 'v1.6');
  if (fs.existsSync(path.join(pinnedLine, 'narrative.talk.schema.yaml'))) {
    return pinnedLine;
  }
  if (fs.existsSync(deployedSchemaParent) && fs.statSync(deployedSchemaParent).isDirectory()) {
    const versionLines = fs.readdirSync(deployedSchemaParent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^v\d+\.\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareVersionLinesDesc);
    for (const line of versionLines) {
      const candidate = path.join(deployedSchemaParent, line);
      if (fs.existsSync(path.join(candidate, 'narrative.talk.schema.yaml'))) {
        return candidate;
      }
    }
  }
  const sourceLayout = path.resolve(baseDir, '..', '..', 'v1', 'schema');
  if (fs.existsSync(path.join(sourceLayout, 'narrative.talk.schema.yaml'))) {
    return sourceLayout;
  }
  return path.resolve('schema/v1.6');
}

/**
 * Return standalone CLI usage text.
 *
 * @returns {string}
 */
export function getStandaloneHelpText() {
  return [
    'Usage: narrative-validate [PATH] [--model PATH] [--schemas PATH] [--compat] [--json] [--help]',
    '',
    'Defaults:',
    '  --model, -m    .narrative/v1 (or positional PATH)',
    '  --schemas, -s  schema/v1.6 (auto-detected relative to the validator)',
    '  --compat, -c   relax strict schema failures into warnings (cross-schema and graph errors remain fatal)',
    '  --json         emit the structured validation report as JSON',
    '  --help, -h     show this help message',
    '',
    'Checks performed:',
    '  1) Schema validation (Ajv draft-2020-12; format annotations uri, date-time, date are advisory)',
    '  2) Cross-file reference integrity and duplicate ID warnings',
    '  3) Scene structure checks (beats, framework, pays_off order), opt-in branching graph checks, and storyworld checks',
    '  4) Delivery variant checks, picture subject uniqueness, external link uniqueness, and gap warnings',
    '  5) Film checks when planes.orchestration.film names a film file',
    '',
    'Exit codes:',
    '  0  Passed (warnings or info lines may be present)',
    '  1  Validation failed (schema, cross-reference, structure, graph, storyworld, variant, film, picture, or link errors)',
    '  2  Runner or usage error (invalid flags, missing root/manifest, YAML parse error, unavailable schemas)',
  ].join('\n');
}

/**
 * Parse standalone validator CLI arguments.
 * Throws an Error on missing option values, unknown flags, or extra positional paths.
 *
 * @param {readonly string[]} argv
 * @param {string} [defaultSchemasDir]
 */
export function parseStandaloneCliArgs(argv, defaultSchemasDir) {
  const args = {
    model: path.resolve('.narrative/v1'),
    schemas: defaultSchemasDir ? path.resolve(defaultSchemasDir) : resolveDefaultSchemasDir(),
    compat: false,
    json: false,
    help: false,
  };

  let positionalModelSet = false;
  let flagModelSet = false;

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }
    if (token === '--compat' || token === '-c') {
      args.compat = true;
      continue;
    }
    if (token === '--json') {
      args.json = true;
      continue;
    }
    if (token === '--model' || token === '-m') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${token}`);
      }
      args.model = path.resolve(value);
      flagModelSet = true;
      i += 1;
      continue;
    }
    if (token === '--schemas' || token === '-s') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${token}`);
      }
      args.schemas = path.resolve(value);
      i += 1;
      continue;
    }
    if (token.startsWith('-')) {
      throw new Error(`Unknown argument: ${token}`);
    }
    if (positionalModelSet || flagModelSet) {
      throw new Error(`Unexpected extra positional argument: ${token}`);
    }
    args.model = path.resolve(token);
    positionalModelSet = true;
  }

  return args;
}

/**
 * Format a validation report as human-readable text.
 *
 * @param {any} report
 * @returns {string}
 */
export function formatValidationReportText(report) {
  if (report.load_status === 'load_error') {
    return `Validation runner failed: ${report.load_error?.message ?? 'unknown load error'}`;
  }

  /** @type {string[]} */
  const lines = [];
  lines.push(`Model: ${report.model_path}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push('');

  if (report.sections.schema.length > 0) {
    lines.push('Schema Errors:');
    for (const e of report.sections.schema) {
      lines.push(`  - ${e}`);
    }
    lines.push('');
  } else {
    lines.push('Schema Errors: none');
    lines.push('');
  }

  if (report.sections.cross.length > 0) {
    lines.push('Cross-Schema Errors:');
    for (const e of report.sections.cross) {
      lines.push(`  - ${e}`);
    }
    lines.push('');
  } else {
    lines.push('Cross-Schema Errors: none');
    lines.push('');
  }

  if (report.sections.warnings.length > 0) {
    lines.push('Gap Warnings:');
    for (const w of report.sections.warnings) {
      lines.push(`  - ${w}`);
    }
    lines.push('');
  } else {
    lines.push('Gap Warnings: none');
    lines.push('');
  }

  if (report.sections.info.length > 0) {
    lines.push('Info:');
    for (const info of report.sections.info) {
      lines.push(`  - ${info}`);
    }
    lines.push('');
  }

  const errorCount = report.summary.errors;
  const warningCount = report.summary.warnings;
  const infoNote = report.summary.infos > 0 ? `, ${report.summary.infos} info line(s)` : '';
  if (errorCount > 0) {
    lines.push(`FAILED with ${errorCount} error(s), ${warningCount} warning(s)${infoNote}.`);
  } else {
    lines.push(`PASSED with ${warningCount} warning(s)${infoNote}.`);
  }

  return lines.join('\n');
}

/**
 * Execute the standalone validator CLI, returning exit code 0, 1, or 2.
 *
 * @param {readonly string[]} [argv]
 * @param {{ defaultSchemasDir?: string, io?: { stdout: (text: string) => void, stderr: (text: string) => void } }} [options]
 * @returns {0 | 1 | 2}
 */
export function runStandaloneCli(argv = process.argv, options = {}) {
  const io = options.io ?? {
    stdout: (text) => console.log(text),
    stderr: (text) => console.error(text),
  };

  let args;
  try {
    args = parseStandaloneCliArgs(argv, options.defaultSchemasDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`Validation runner failed: ${message}`);
    return 2;
  }

  if (args.help) {
    io.stdout(getStandaloneHelpText());
    return 0;
  }

  const report = validateNarrative({
    modelPath: args.model,
    schemasPath: args.schemas,
    compat: args.compat,
  });

  if (args.json) {
    io.stdout(JSON.stringify(report, null, 2));
    return report.exit_code;
  }

  const text = formatValidationReportText(report);
  if (report.load_status === 'load_error') {
    io.stderr(text);
    return 2;
  }

  io.stdout(text);
  return report.exit_code;
}

export {
  NARRATIVE_PLANES,
  NARRATIVE_ROOT_SCHEMA_URN,
  NARRATIVE_SCENES_SCHEMA_URN_V1,
  NARRATIVE_SCENES_SCHEMA_URN_V1_1,
  NARRATIVE_STORYWORLD_SCHEMA_URN,
  REQUIRED_NARRATIVE_SCHEMA_URNS,
  NarrativeReadError,
  NarrativeSchemaRegistryError,
  collectGraphFindings,
  extractNarrativeOccurrences,
  formatAjvErrors,
  loadNarrativeSchemaRegistry,
  loadValidationInputs,
  readNarrativeSource,
  resolveManifestPath,
  resolveScenesSchemaUrn,
  resolveSchemaLocations,
  validateNarrative,
};

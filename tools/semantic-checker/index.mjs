// @ts-check
// Public Narrative semantic checker built as a thin adapter over @archally/semantic-checker.
// Evaluates five declarative YAML rules and three custom extensions over the built authored graph.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  loadExtensions,
  loadRules,
  runChecker,
} from '@archally/semantic-checker';
import {
  getBlockingPointerDiagnostics,
  loadAndBuildNarrativeModel,
} from '../model-builder/index.mjs';
import { toNarrativeCheckableModel } from './adapter.mjs';

export const DEFAULT_NARRATIVE_RULES_DIR = fileURLToPath(
  new URL('./rules', import.meta.url),
);

export const NARRATIVE_LINT_CONFIG_FILES = Object.freeze([
  '.narrative-lint.yaml',
  '.narrative-lint.yml',
]);

/** @type {Record<string, number>} */
const SEVERITY_RANK = {
  error: 0,
  warn: 1,
  info: 2,
};

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Load a rule-pack config override from an explicit file path, or auto-discover
 * `.narrative-lint.yaml` / `.narrative-lint.yml` in `modelRootDir` when omitted.
 *
 * @param {string} modelRootDir
 * @param {string} [explicitConfigPath]
 * @returns {{ config: Record<string, any>, configPath: string | null }}
 */
export function loadNarrativeSemanticConfig(modelRootDir, explicitConfigPath) {
  if (explicitConfigPath !== undefined) {
    const resolved = path.resolve(explicitConfigPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Semantic rules config file not found: ${resolved}`);
    }
    const parsed = YAML.parse(fs.readFileSync(resolved, 'utf8'));
    if (parsed !== null && parsed !== undefined && !isRecord(parsed)) {
      throw new Error(`Semantic rules config must be a YAML mapping: ${resolved}`);
    }
    return {
      config: parsed ?? {},
      configPath: resolved,
    };
  }

  for (const fileName of NARRATIVE_LINT_CONFIG_FILES) {
    const candidate = path.join(modelRootDir, fileName);
    if (fs.existsSync(candidate)) {
      const parsed = YAML.parse(fs.readFileSync(candidate, 'utf8'));
      if (parsed !== null && parsed !== undefined && !isRecord(parsed)) {
        throw new Error(`Semantic rules config must be a YAML mapping: ${candidate}`);
      }
      return {
        config: parsed ?? {},
        configPath: candidate,
      };
    }
  }

  return { config: {}, configPath: null };
}

/**
 * List all Narrative semantic checker rules (declarative + custom extension rules).
 *
 * @param {string} [rulesPath]
 */
export async function listNarrativeSemanticRules(rulesPath = DEFAULT_NARRATIVE_RULES_DIR) {
  const rules = await loadRules(rulesPath);
  return rules.map((rule) => ({
    id: rule.id,
    severity: rule.severity,
    description: rule.description,
    kind: rule.check?.custom ? 'custom' : 'declarative',
  }));
}

/**
 * Deterministic issue comparator matching the monorepo Narrative semantic core.
 *
 * @param {any} a
 * @param {any} b
 * @returns {number}
 */
function compareIssues(a, b) {
  return (
    (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99) ||
    a.ruleId.localeCompare(b.ruleId) ||
    (a.file ?? '').localeCompare(b.file ?? '') ||
    (a.path ?? '').localeCompare(b.path ?? '') ||
    (a.entityId ?? '').localeCompare(b.entityId ?? '') ||
    a.message.localeCompare(b.message)
  );
}

/**
 * Run the Narrative semantic checker over a built model object using @archally/semantic-checker.
 *
 * @param {any} builtModel
 * @param {{
 *   rulesPath?: string,
 *   config?: Record<string, any>,
 *   configPath?: string | null,
 *   strict?: boolean,
 * }} [options]
 */
export async function runNarrativeSemanticCheck(builtModel, options = {}) {
  const rulesPath = options.rulesPath ?? DEFAULT_NARRATIVE_RULES_DIR;
  const config = options.config ?? {};
  const strict = Boolean(options.strict);

  const rules = await loadRules(rulesPath);
  const extensions = await loadExtensions(rules);
  const adapted = toNarrativeCheckableModel(builtModel);
  const rawIssues = runChecker(adapted.checkableModel, rules, config, extensions);

  const issues = rawIssues.map((issue) => {
    const mapped = issue.entityId ? adapted.subjectMap.get(issue.entityId) : undefined;
    if (mapped) {
      return {
        ruleId: issue.ruleId,
        severity: issue.severity,
        message: issue.message,
        entityId: mapped.entityId,
        ...(mapped.targetId !== undefined ? { targetId: mapped.targetId } : {}),
        ...(mapped.file !== undefined ? { file: mapped.file } : {}),
        ...(mapped.path !== undefined ? { path: mapped.path } : {}),
      };
    }

    const authored = issue.entityId ? adapted.authoredById.get(issue.entityId) : undefined;
    const file = issue.file !== undefined ? issue.file : authored?.location?.file;
    const yamlPath = authored?.location?.path;

    return {
      ruleId: issue.ruleId,
      severity: issue.severity,
      message: issue.message,
      ...(issue.entityId !== undefined ? { entityId: issue.entityId } : {}),
      ...(file !== undefined ? { file } : {}),
      ...(yamlPath !== undefined ? { path: yamlPath } : {}),
    };
  });

  issues.sort(compareIssues);

  const counts = {
    error: issues.filter((issue) => issue.severity === 'error').length,
    warn: issues.filter((issue) => issue.severity === 'warn').length,
    info: issues.filter((issue) => issue.severity === 'info').length,
  };

  const passed = counts.error === 0 && (!strict || counts.warn === 0);
  const declarativeRules = rules.filter((rule) => !rule.check?.custom).length;
  const customRules = rules.length - declarativeRules;

  return {
    status: /** @type {const} */ ('checked'),
    rules_loaded: rules.length,
    declarative_rules: declarativeRules,
    custom_rules: customRules,
    entities: adapted.authoredEntityCount,
    relations: adapted.authoredRelationCount,
    strict,
    config_path: options.configPath ?? null,
    counts,
    passed,
    exit_code: /** @type {0 | 1} */ (passed ? 0 : 1),
    issues,
  };
}

/**
 * Load either a built model JSON file or an authored Narrative directory/manifest.
 *
 * @param {string} inputPath
 */
function loadSemanticInput(inputPath) {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Narrative model path not found: ${resolved}`);
  }
  const stats = fs.statSync(resolved);
  if (stats.isFile() && resolved.endsWith('.json')) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid built model JSON (${resolved}): ${detail}`);
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.entities) || !Array.isArray(parsed.relations)) {
      throw new Error(`Expected a built model JSON with entities and relations: ${resolved}`);
    }
    return {
      model: parsed,
      modelRootDir: path.dirname(resolved),
      displayTarget: resolved,
    };
  }

  const built = loadAndBuildNarrativeModel(resolved);
  const blocking = getBlockingPointerDiagnostics(built.model);
  if (blocking.length > 0) {
    const details = blocking.map((diag) => diag.message).join('; ');
    throw new Error(`Model has broken plane pointer(s): ${details}`);
  }
  return {
    model: built.model,
    modelRootDir: built.source.rootDir,
    displayTarget: built.source.manifestPath,
  };
}

/**
 * Return CLI help text.
 *
 * @returns {string}
 */
export function getSemanticHelpText() {
  return [
    'Usage: narrative-check [PATH] [--model PATH] [--config PATH] [--rules PATH] [--strict] [--json] [--list] [--help]',
    '',
    'Runs Narrative semantic checks (5 declarative YAML rules + 3 custom extensions) via @archally/semantic-checker.',
    '',
    'Arguments:',
    '  PATH           Narrative directory, narrative.yaml manifest, or built model.json (default: .narrative/v1)',
    '',
    'Options:',
    '  --model, -m    Path to Narrative directory, manifest, or model.json',
    '  --config, -c   Path to .narrative-lint.yaml override config (auto-discovers in model root)',
    '  --rules, -r    Override rule pack file or directory',
    '  --strict       Treat warnings as failing (exit 1)',
    '  --json         Emit structured JSON output',
    '  --list         List all loaded rules and default severities',
    '  --help, -h     Show this help message',
    '',
    'Exit codes:',
    '  0  Passed (warnings/info allowed unless --strict)',
    '  1  Check completed with failing findings',
    '  2  Usage, config, model load, rule pack, or engine error',
  ].join('\n');
}

/**
 * Parse semantic-checker CLI arguments.
 *
 * @param {readonly string[]} argv
 */
export function parseSemanticCliArgs(argv) {
  const args = {
    model: path.resolve('.narrative/v1'),
    config: /** @type {string | undefined} */ (undefined),
    rules: /** @type {string | undefined} */ (undefined),
    strict: false,
    json: false,
    list: false,
    help: false,
  };

  let modelSet = false;

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
    if (token === '--strict') {
      args.strict = true;
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
      modelSet = true;
      i += 1;
      continue;
    }
    if (token === '--config' || token === '-c') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${token}`);
      }
      args.config = path.resolve(value);
      i += 1;
      continue;
    }
    if (token === '--rules' || token === '-r') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${token}`);
      }
      args.rules = path.resolve(value);
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
 * Format a completed semantic check result as human-readable text.
 *
 * @param {any} result
 * @param {string} displayTarget
 * @returns {string}
 */
export function formatSemanticReportText(result, displayTarget) {
  /** @type {string[]} */
  const lines = [];
  lines.push(`Model:     ${displayTarget}`);
  lines.push(`Config:    ${result.config_path ?? '(defaults)'}`);
  lines.push(`Rules:     ${result.rules_loaded} (${result.declarative_rules} declarative, ${result.custom_rules} custom)`);
  lines.push(`Entities:  ${result.entities}`);
  lines.push(`Relations: ${result.relations}`);
  lines.push('');

  const groups = [
    { label: 'Errors', items: result.issues.filter((issue) => issue.severity === 'error') },
    { label: 'Warnings', items: result.issues.filter((issue) => issue.severity === 'warn') },
    { label: 'Info', items: result.issues.filter((issue) => issue.severity === 'info') },
  ];

  for (const group of groups) {
    if (group.items.length === 0) {
      continue;
    }
    lines.push(`${group.label}:`);
    for (const issue of group.items) {
      const loc = issue.file ? ` (${issue.file}${issue.path ? `#${issue.path}` : ''})` : '';
      lines.push(`  [${issue.ruleId}] ${issue.message}${loc}`);
    }
    lines.push('');
  }

  const summary = `${result.counts.error} error(s), ${result.counts.warn} warning(s), ${result.counts.info} info(s)`;
  if (!result.passed) {
    lines.push(`FAILED: ${summary}${result.strict ? ' (strict)' : ''}.`);
  } else if (result.issues.length > 0) {
    lines.push(`PASSED: ${summary}.`);
  } else {
    lines.push('PASSED: no issues found.');
  }

  return lines.join('\n');
}

/**
 * Format an engine/operational error distinctly from a completed check with findings.
 *
 * @param {unknown} error
 */
function buildEngineErrorReport(error) {
  const err = error instanceof Error ? error : new Error(String(error));
  const details = Array.isArray(/** @type {any} */ (err).details)
    ? /** @type {any} */ (err).details
    : undefined;
  return {
    status: /** @type {const} */ ('engine_error'),
    passed: false,
    exit_code: /** @type {const} */ (2),
    error: {
      name: err.name || 'Error',
      message: err.message,
      ...(details ? { details } : {}),
    },
  };
}

/**
 * Execute the Narrative semantic-checker CLI, returning exit code 0, 1, or 2.
 *
 * @param {readonly string[]} [argv]
 * @param {{ io?: { stdout: (text: string) => void, stderr: (text: string) => void } }} [options]
 * @returns {Promise<0 | 1 | 2>}
 */
export async function runSemanticCli(argv = process.argv, options = {}) {
  const io = options.io ?? {
    stdout: (text) => console.log(text),
    stderr: (text) => console.error(text),
  };

  let args;
  try {
    args = parseSemanticCliArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`Semantic check failed: ${message}`);
    return 2;
  }

  if (args.help) {
    io.stdout(getSemanticHelpText());
    return 0;
  }

  try {
    if (args.list) {
      const rules = await listNarrativeSemanticRules(args.rules ?? DEFAULT_NARRATIVE_RULES_DIR);
      if (args.json) {
        io.stdout(JSON.stringify({ status: 'listed', rules }, null, 2));
        return 0;
      }
      const lines = ['Available rules:', ''];
      for (const rule of rules) {
        lines.push(`  ${rule.id} (default: ${rule.severity}, ${rule.kind})`);
        lines.push(`    ${rule.description}`);
        lines.push('');
      }
      io.stdout(lines.join('\n').trimEnd());
      return 0;
    }

    const input = loadSemanticInput(args.model);
    const loadedConfig = loadNarrativeSemanticConfig(input.modelRootDir, args.config);
    const result = await runNarrativeSemanticCheck(input.model, {
      rulesPath: args.rules ?? DEFAULT_NARRATIVE_RULES_DIR,
      config: loadedConfig.config,
      configPath: loadedConfig.configPath,
      strict: args.strict,
    });

    if (args.json) {
      io.stdout(JSON.stringify(result, null, 2));
      return result.exit_code;
    }

    io.stdout(formatSemanticReportText(result, input.displayTarget));
    return result.exit_code;
  } catch (error) {
    const report = buildEngineErrorReport(error);
    if (args.json) {
      io.stdout(JSON.stringify(report, null, 2));
      return 2;
    }
    io.stderr(`Semantic check failed (${report.error.name}): ${report.error.message}`);
    return 2;
  }
}

export { toNarrativeCheckableModel };

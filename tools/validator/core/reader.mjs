// @ts-check
// Pure reader for Narrative v1 manifests and declared plane pointer files.
// Depends only on Node built-ins and `yaml`.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const NARRATIVE_ROOT_SCHEMA_URN = 'urn:narrative:talk:1.0.0';
export const NARRATIVE_SCENES_SCHEMA_URN_V1 = 'urn:narrative:scenes:1.0.0';
export const NARRATIVE_SCENES_SCHEMA_URN_V1_1 = 'urn:narrative:scenes:1.1.0';
export const NARRATIVE_STORYWORLD_SCHEMA_URN = 'urn:narrative:storyworld:1.0.0';

/**
 * Presence-dispatched scenes schema URN selection.
 * Own-property presence of `graph` selects `urn:narrative:scenes:1.1.0` even for null, empty,
 * malformed graph values, or mismatched version. Absence always selects `urn:narrative:scenes:1.0.0`.
 *
 * @param {unknown} doc
 * @returns {'urn:narrative:scenes:1.0.0' | 'urn:narrative:scenes:1.1.0'}
 */
export function resolveScenesSchemaUrn(doc) {
  return isRecord(doc) && Object.prototype.hasOwnProperty.call(doc, 'graph')
    ? NARRATIVE_SCENES_SCHEMA_URN_V1_1
    : NARRATIVE_SCENES_SCHEMA_URN_V1;
}

export const NARRATIVE_PLANES = Object.freeze([
  'intent',
  'knowledge',
  'orchestration',
  'delivery',
  'assurance',
]);

/**
 * Raised when the narrative root directory or manifest cannot be resolved, read, or parsed.
 * Pointer-level issues inside a loaded manifest are reported as diagnostics instead of throwing.
 */
export class NarrativeReadError extends Error {
  /**
   * @param {'root_not_found' | 'manifest_not_found' | 'manifest_read_error' | 'manifest_parse_error' | 'manifest_invalid'} code
   * @param {string} message
   * @param {string} [targetPath]
   */
  constructor(code, message, targetPath) {
    super(message);
    this.name = 'NarrativeReadError';
    this.code = code;
    if (targetPath !== undefined) {
      this.path = targetPath;
    }
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} filePath
 * @returns {string}
 */
function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

/**
 * Resolve a directory or manifest file path to the absolute manifest file path.
 *
 * @param {string} inputPath
 * @returns {string}
 */
export function resolveManifestPath(inputPath) {
  const absolute = path.resolve(inputPath);
  if (!fs.existsSync(absolute)) {
    throw new NarrativeReadError('root_not_found', `Narrative path not found: ${absolute}`, absolute);
  }
  const stat = fs.statSync(absolute);
  const manifestPath = stat.isDirectory() ? path.join(absolute, 'narrative.yaml') : absolute;
  if (!fs.existsSync(manifestPath)) {
    throw new NarrativeReadError(
      'manifest_not_found',
      `Narrative manifest not found: ${manifestPath}`,
      manifestPath,
    );
  }
  return manifestPath;
}

/**
 * Single-pointer specifications in deterministic traversal order.
 * `delivery.scripts` is expanded immediately after `delivery.script`.
 */
const SINGLE_POINTER_SPECS = [
  {
    plane: 'intent',
    role: 'intent',
    label: 'intent',
    pointerPath: 'planes.intent.intent',
    schemaUrn: 'urn:narrative:intent:1.0.0',
    required: true,
    readOnly: false,
  },
  {
    plane: 'knowledge',
    role: 'concepts',
    label: 'knowledge.concepts',
    pointerPath: 'planes.knowledge.concepts',
    schemaUrn: 'urn:narrative:concepts:1.0.0',
    required: true,
    readOnly: false,
  },
  {
    plane: 'knowledge',
    role: 'claims',
    label: 'knowledge.claims',
    pointerPath: 'planes.knowledge.claims',
    schemaUrn: 'urn:narrative:claims:1.0.0',
    required: true,
    readOnly: false,
  },
  {
    plane: 'knowledge',
    role: 'evidence',
    label: 'knowledge.evidence',
    pointerPath: 'planes.knowledge.evidence',
    schemaUrn: 'urn:narrative:evidence:1.0.0',
    required: false,
    readOnly: false,
  },
  {
    plane: 'knowledge',
    role: 'assets',
    label: 'knowledge.assets',
    pointerPath: 'planes.knowledge.assets',
    schemaUrn: 'urn:narrative:assets:1.0.0',
    required: false,
    readOnly: false,
  },
  {
    plane: 'knowledge',
    role: 'storyworld',
    label: 'knowledge.storyworld',
    pointerPath: 'planes.knowledge.storyworld',
    schemaUrn: NARRATIVE_STORYWORLD_SCHEMA_URN,
    required: false,
    readOnly: false,
  },
  {
    plane: 'orchestration',
    role: 'scenes',
    label: 'orchestration.scenes',
    pointerPath: 'planes.orchestration.scenes',
    schemaUrn: 'urn:narrative:scenes:1.0.0',
    required: true,
    readOnly: false,
  },
  {
    plane: 'orchestration',
    role: 'film',
    label: 'orchestration.film',
    pointerPath: 'planes.orchestration.film',
    schemaUrn: 'urn:narrative:film:1.0.0',
    required: false,
    readOnly: false,
  },
  {
    plane: 'delivery',
    role: 'script',
    label: 'delivery.script',
    pointerPath: 'planes.delivery.script',
    schemaUrn: 'urn:narrative:script:1.0.0',
    required: false,
    readOnly: false,
  },
];

const POST_SCRIPTS_POINTER_SPECS = [
  {
    plane: 'delivery',
    role: 'slides',
    label: 'delivery.slides',
    pointerPath: 'planes.delivery.slides',
    schemaUrn: null,
    required: false,
    readOnly: true,
  },
  {
    plane: 'delivery',
    role: 'variants',
    label: 'delivery.variants',
    pointerPath: 'planes.delivery.variants',
    schemaUrn: 'urn:narrative:variants:1.0.0',
    required: false,
    readOnly: false,
  },
  {
    plane: 'assurance',
    role: 'qa',
    label: 'assurance.qa',
    pointerPath: 'planes.assurance.qa',
    schemaUrn: 'urn:narrative:qa:1.0.0',
    required: false,
    readOnly: false,
  },
  {
    plane: 'assurance',
    role: 'rehearsal',
    label: 'assurance.rehearsal',
    pointerPath: 'planes.assurance.rehearsal',
    schemaUrn: 'urn:narrative:rehearsal:1.0.0',
    required: false,
    readOnly: false,
  },
  {
    plane: 'assurance',
    role: 'views',
    label: 'assurance.views',
    pointerPath: 'planes.assurance.views',
    schemaUrn: 'urn:narrative:views:1.0.0',
    required: false,
    readOnly: false,
  },
];

/**
 * @param {{
 *   plane: string,
 *   role: string,
 *   label: string,
 *   pointerPath: string,
 *   schemaUrn: string | null,
 *   required: boolean,
 *   readOnly: boolean,
 * }} spec
 * @param {unknown} rawValue
 * @param {string} rootDir
 * @param {string} manifestFile
 * @param {any[]} diagnostics
 * @param {number} [index]
 */
function readPointerEntry(spec, rawValue, rootDir, manifestFile, diagnostics, index) {
  const declaredAt = { file: manifestFile, path: spec.pointerPath };

  if (rawValue === undefined || rawValue === null) {
    if (spec.required) {
      diagnostics.push({
        code: 'missing_required_pointer',
        plane: spec.plane,
        role: spec.role,
        label: spec.label,
        pointerPath: spec.pointerPath,
        declaredFile: null,
        resolvedPath: null,
        schemaUrn: spec.schemaUrn,
        required: spec.required,
        message: `Missing required file pointer: ${spec.pointerPath}`,
        location: declaredAt,
      });
    }
    return {
      plane: spec.plane,
      role: spec.role,
      label: spec.label,
      pointerPath: spec.pointerPath,
      schemaUrn: spec.schemaUrn,
      required: spec.required,
      readOnly: spec.readOnly,
      status: 'omitted',
      declaredFile: null,
      resolvedPath: null,
      relativeFile: null,
      content: undefined,
      location: declaredAt,
      declaredAt,
      ...(index !== undefined ? { index } : {}),
    };
  }

  if (typeof rawValue !== 'string' || rawValue.trim() === '') {
    diagnostics.push({
      code: 'invalid_pointer',
      plane: spec.plane,
      role: spec.role,
      label: spec.label,
      pointerPath: spec.pointerPath,
      declaredFile: typeof rawValue === 'string' ? rawValue : null,
      resolvedPath: null,
      schemaUrn: spec.schemaUrn,
      required: spec.required,
      message: `Invalid file pointer at ${spec.pointerPath}: expected a non-empty relative path string`,
      location: declaredAt,
    });
    return {
      plane: spec.plane,
      role: spec.role,
      label: spec.label,
      pointerPath: spec.pointerPath,
      schemaUrn: spec.schemaUrn,
      required: spec.required,
      readOnly: spec.readOnly,
      status: 'invalid_pointer',
      declaredFile: typeof rawValue === 'string' ? rawValue : null,
      resolvedPath: null,
      relativeFile: null,
      content: undefined,
      location: declaredAt,
      declaredAt,
      ...(index !== undefined ? { index } : {}),
    };
  }

  const declaredFile = rawValue;
  const resolvedPath = path.resolve(rootDir, declaredFile);
  const relativeFile = toPosix(path.relative(rootDir, resolvedPath));

  if (!fs.existsSync(resolvedPath)) {
    diagnostics.push({
      code: 'missing_file',
      plane: spec.plane,
      role: spec.role,
      label: spec.label,
      pointerPath: spec.pointerPath,
      declaredFile,
      resolvedPath,
      schemaUrn: spec.schemaUrn,
      required: spec.required,
      message: `Missing model file for ${spec.label}: ${declaredFile}`,
      location: declaredAt,
    });
    return {
      plane: spec.plane,
      role: spec.role,
      label: spec.label,
      pointerPath: spec.pointerPath,
      schemaUrn: spec.schemaUrn,
      required: spec.required,
      readOnly: spec.readOnly,
      status: 'missing',
      declaredFile,
      resolvedPath,
      relativeFile,
      content: undefined,
      location: { file: relativeFile, path: 'root' },
      declaredAt,
      ...(index !== undefined ? { index } : {}),
    };
  }

  let rawText;
  try {
    rawText = fs.readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    diagnostics.push({
      code: 'read_error',
      plane: spec.plane,
      role: spec.role,
      label: spec.label,
      pointerPath: spec.pointerPath,
      declaredFile,
      resolvedPath,
      schemaUrn: spec.schemaUrn,
      required: spec.required,
      message: `Cannot read model file for ${spec.label} (${declaredFile}): ${reason}`,
      location: declaredAt,
    });
    return {
      plane: spec.plane,
      role: spec.role,
      label: spec.label,
      pointerPath: spec.pointerPath,
      schemaUrn: spec.schemaUrn,
      required: spec.required,
      readOnly: spec.readOnly,
      status: 'unreadable',
      declaredFile,
      resolvedPath,
      relativeFile,
      content: undefined,
      location: { file: relativeFile, path: 'root' },
      declaredAt,
      ...(index !== undefined ? { index } : {}),
    };
  }

  let parsed;
  try {
    parsed = YAML.parse(rawText);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    diagnostics.push({
      code: 'parse_error',
      plane: spec.plane,
      role: spec.role,
      label: spec.label,
      pointerPath: spec.pointerPath,
      declaredFile,
      resolvedPath,
      schemaUrn: spec.schemaUrn,
      required: spec.required,
      message: `YAML parse error in ${spec.label} (${declaredFile}): ${reason}`,
      location: { file: relativeFile, path: 'root' },
    });
    return {
      plane: spec.plane,
      role: spec.role,
      label: spec.label,
      pointerPath: spec.pointerPath,
      schemaUrn: spec.schemaUrn,
      required: spec.required,
      readOnly: spec.readOnly,
      status: 'parse_error',
      declaredFile,
      resolvedPath,
      relativeFile,
      content: undefined,
      location: { file: relativeFile, path: 'root' },
      declaredAt,
      ...(index !== undefined ? { index } : {}),
    };
  }

  const resolvedSchemaUrn = spec.role === 'scenes'
    ? resolveScenesSchemaUrn(parsed)
    : spec.schemaUrn;

  return {
    plane: spec.plane,
    role: spec.role,
    label: spec.label,
    pointerPath: spec.pointerPath,
    schemaUrn: resolvedSchemaUrn,
    required: spec.required,
    readOnly: spec.readOnly,
    status: 'loaded',
    declaredFile,
    resolvedPath,
    relativeFile,
    content: parsed,
    location: { file: relativeFile, path: 'root' },
    declaredAt,
    ...(index !== undefined ? { index } : {}),
  };
}

/**
 * Read a Narrative manifest and all explicitly declared plane pointer files.
 * Built presentation files (for example `build/presentation.yaml`) are never added to the pointer list.
 *
 * @param {string} inputPath - Directory containing `narrative.yaml` or direct path to manifest file.
 */
export function readNarrativeSource(inputPath) {
  const manifestPath = resolveManifestPath(inputPath);
  const rootDir = path.dirname(manifestPath);
  const manifestFile = toPosix(path.relative(rootDir, manifestPath)) || path.basename(manifestPath);

  let rawManifest;
  try {
    rawManifest = fs.readFileSync(manifestPath, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new NarrativeReadError(
      'manifest_read_error',
      `Cannot read narrative manifest ${manifestPath}: ${reason}`,
      manifestPath,
    );
  }

  let root;
  try {
    root = YAML.parse(rawManifest);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new NarrativeReadError(
      'manifest_parse_error',
      `Cannot parse narrative manifest ${manifestPath}: ${reason}`,
      manifestPath,
    );
  }

  if (!isRecord(root)) {
    throw new NarrativeReadError(
      'manifest_invalid',
      `Invalid narrative manifest ${manifestPath}: expected a YAML object`,
      manifestPath,
    );
  }

  const planes = isRecord(root.planes) ? root.planes : {};
  /** @type {any[]} */
  const diagnostics = [];
  /** @type {any[]} */
  const pointers = [];

  /**
   * @param {string} planeName
   * @param {string} fieldName
   */
  const planeValue = (planeName, fieldName) => {
    const section = planes[planeName];
    return isRecord(section) ? section[fieldName] : undefined;
  };

  for (const spec of SINGLE_POINTER_SPECS) {
    const rawValue = planeValue(spec.plane, spec.role);
    pointers.push(readPointerEntry(spec, rawValue, rootDir, manifestFile, diagnostics));
  }

  const rawScripts = planeValue('delivery', 'scripts');
  if (Array.isArray(rawScripts)) {
    rawScripts.forEach((scriptPath, index) => {
      const spec = {
        plane: 'delivery',
        role: 'scripts',
        label: `delivery.scripts[${index}]`,
        pointerPath: `planes.delivery.scripts[${index}]`,
        schemaUrn: 'urn:narrative:script:1.0.0',
        required: false,
        readOnly: false,
      };
      pointers.push(readPointerEntry(spec, scriptPath, rootDir, manifestFile, diagnostics, index));
    });
  } else if (rawScripts !== undefined && rawScripts !== null) {
    diagnostics.push({
      code: 'invalid_pointer',
      plane: 'delivery',
      role: 'scripts',
      label: 'delivery.scripts',
      pointerPath: 'planes.delivery.scripts',
      declaredFile: null,
      resolvedPath: null,
      schemaUrn: 'urn:narrative:script:1.0.0',
      required: false,
      message: 'Invalid file pointer at planes.delivery.scripts: expected an array of relative path strings',
      location: { file: manifestFile, path: 'planes.delivery.scripts' },
    });
  }

  for (const spec of POST_SCRIPTS_POINTER_SPECS) {
    const rawValue = planeValue(spec.plane, spec.role);
    pointers.push(readPointerEntry(spec, rawValue, rootDir, manifestFile, diagnostics));
  }

  const hasIr = fs.existsSync(path.join(rootDir, 'build', 'presentation.yaml'));

  return {
    manifestPath,
    rootDir,
    manifestFile,
    ...(typeof root.id === 'string' ? { id: root.id } : {}),
    ...(typeof root.name === 'string' ? { name: root.name } : {}),
    ...(typeof root.version === 'string' ? { version: root.version } : {}),
    rootSchemaUrn: NARRATIVE_ROOT_SCHEMA_URN,
    root,
    location: { file: manifestFile, path: 'root' },
    hasIr,
    pointers,
    diagnostics,
  };
}

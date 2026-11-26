// @ts-check
// Conformance validator for authored Narrative v1 models.
// Runs JSON Schema 2020-12, duplicate-ID, cross-file reference, structure, branching-graph,
// delivery-variant, film, picture, external-link, and gap checks into one structured report.

import { extractNarrativeOccurrences } from './occurrences.mjs';
import { formatAjvErrors } from './native-schema.mjs';
import { loadValidationInputs } from './source-status.mjs';

const ID_RE = /^[A-Z]{1,5}[0-9]{3}$/;

const LEGACY_REF_KEYS = new Set([
  'prerequisites',
  'depends_on_claims',
  'key_terms',
  'evidence_refs',
  'asset_refs',
  'scene_refs',
  'question_refs',
  'backs_claims',
  'supports_concepts',
  'used_in_scenes',
  'supports_goals',
  'relevant_scenes',
  'anticipated_questions',
  'concepts',
  'claims',
  'evidence',
  'assets',
  'scenes',
  'questions',
  'goals',
  'prev',
  'next',
  'scene_ids',
  'claim_ids',
]);

const SCENE_ID_RE = /^SC[0-9]{3}$/;
const TRANSITION_ID_RE = /^TR[0-9]{3}$/;
const GRAPH_CODE_RE = /^[a-z][a-z0-9_]*$/;
const GRAPH_TEXT_RE = /\S/;
const GRAPH_ALLOWED_KEYS = new Set(['entry', 'endings', 'state', 'transitions']);
const GRAPH_ENDING_ALLOWED_KEYS = new Set(['scene_id', 'code', 'label', 'outcome_summary']);
const GRAPH_VAR_ALLOWED_KEYS = new Set(['type', 'initial', 'values']);
const GRAPH_TRANSITION_ALLOWED_KEYS = new Set(['id', 'from', 'to', 'kind', 'label', 'when', 'effects']);
const GRAPH_MAX_STATE_VARS = 16;
const GRAPH_MAX_ENUM_VALUES = 16;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @returns {boolean}
 */
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isGraphText(value) {
  return typeof value === 'string' && value.length > 0 && GRAPH_TEXT_RE.test(value);
}

/**
 * @param {string} field
 * @returns {boolean}
 */
function isCheckedRefField(field) {
  const leaf = field.includes('.') ? field.slice(field.lastIndexOf('.') + 1) : field;
  return leaf.endsWith('_ref') || leaf.endsWith('_refs') || LEGACY_REF_KEYS.has(leaf);
}

/**
 * @param {{ pointerLabel: string, location: { path: string } }} ref
 * @returns {string}
 */
function formatRefLocation(ref) {
  const normalized = ref.location.path.replace(/(\[\d+\])\./g, '.$1.');
  return `${ref.pointerLabel}.${normalized}`;
}

/**
 * @param {{ pointerLabel: string, location: { path: string } }} occurrence
 * @returns {string}
 */
function formatOccurrenceLocation(occurrence) {
  if (occurrence.pointerLabel === 'root' && occurrence.location.path === 'root') {
    return 'root';
  }
  const normalized = occurrence.location.path.replace(/(\[\d+\])/g, '.$1');
  return `${occurrence.pointerLabel}.${normalized}`;
}

/**
 * @param {readonly any[]} pointers
 * @returns {Map<string, any>}
 */
function getPointerMap(pointers) {
  /** @type {Map<string, any>} */
  const map = new Map();
  for (const pointer of pointers) {
    if (pointer.status === 'loaded') {
      map.set(pointer.label, pointer);
    }
  }
  return map;
}

/**
 * @param {ReadonlyMap<string, any>} pointerMap
 * @param {string} label
 * @returns {Record<string, unknown> | undefined}
 */
function getDoc(pointerMap, label) {
  const entry = pointerMap.get(label);
  return entry && isRecord(entry.content) ? entry.content : undefined;
}

/**
 * @param {ReadonlyMap<string, any>} pointerMap
 * @param {string} label
 * @returns {string}
 */
function getFile(pointerMap, label) {
  return pointerMap.get(label)?.location.file ?? label;
}

/**
 * @param {ReadonlyMap<string, any>} pointerMap
 * @param {Record<string, unknown>} scenesSchema
 * @param {any[]} findings
 */
function collectStructureFindings(pointerMap, scenesSchema, findings) {
  const scenesDoc = getDoc(pointerMap, 'orchestration.scenes');
  if (!scenesDoc) {
    return;
  }
  const scenes = scenesDoc.scenes;
  if (!Array.isArray(scenes)) {
    return;
  }

  const file = getFile(pointerMap, 'orchestration.scenes');
  const defs = /** @type {Record<string, { enum?: string[] }>} */ (scenesSchema.$defs ?? {});
  const framework = scenesDoc.structure_framework;
  const frameworks = defs.structure_framework?.enum ?? [];
  const frameworkIsValid = typeof framework === 'string' && frameworks.includes(framework);
  const allowedBeats = frameworkIsValid ? (defs[`beat_${framework}`]?.enum ?? []) : [];
  const declaredBeats = frameworks.flatMap((name) => defs[`beat_${name}`]?.enum ?? []);

  /** @type {Map<string, number>} */
  const sceneIndexes = new Map();
  scenes.forEach((rawScene, index) => {
    if (isRecord(rawScene) && typeof rawScene.id === 'string') {
      sceneIndexes.set(rawScene.id, index);
    }
  });

  scenes.forEach((rawScene, index) => {
    if (!isRecord(rawScene)) {
      return;
    }
    const sceneId = String(rawScene.id ?? '?');
    const beat = rawScene.beat;

    if (typeof beat === 'string' && declaredBeats.includes(beat)) {
      if (framework === undefined) {
        findings.push({
          layer: 'structure',
          code: 'structure_beat_requires_framework',
          severity: 'error',
          file,
          path: `scenes[${index}].beat`,
          pointerLabel: 'orchestration.scenes',
          section: 'cross',
          message:
            `Structure: scene ${sceneId} beat '${beat}' requires root structure_framework ` +
            `(allowed frameworks: ${frameworks.join(', ')})`,
        });
      } else if (frameworkIsValid && !allowedBeats.includes(beat)) {
        findings.push({
          layer: 'structure',
          code: 'structure_beat_not_allowed',
          severity: 'error',
          file,
          path: `scenes[${index}].beat`,
          pointerLabel: 'orchestration.scenes',
          section: 'cross',
          message:
            `Structure: scene ${sceneId} framework '${framework}' beat '${beat}' is not allowed ` +
            `(allowed beats: ${allowedBeats.join(', ')})`,
        });
      }
    }

    const paysOff = rawScene.pays_off;
    if (!Array.isArray(paysOff)) {
      return;
    }

    for (const target of new Set(paysOff)) {
      if (typeof target !== 'string' || !SCENE_ID_RE.test(target)) {
        continue;
      }
      if (!sceneIndexes.has(target)) {
        findings.push({
          layer: 'structure',
          code: 'structure_payoff_missing_scene',
          severity: 'error',
          file,
          path: `scenes[${index}].pays_off`,
          pointerLabel: 'orchestration.scenes',
          section: 'cross',
          message: `Structure: scene ${sceneId} pays_off target '${target}' does not exist in scenes`,
        });
      } else if (target === sceneId) {
        findings.push({
          layer: 'structure',
          code: 'structure_payoff_self',
          severity: 'error',
          file,
          path: `scenes[${index}].pays_off`,
          pointerLabel: 'orchestration.scenes',
          section: 'cross',
          message: `Structure: scene ${sceneId} pays_off target '${target}' must differ from its own id`,
        });
      } else if ((sceneIndexes.get(target) ?? 0) >= index) {
        findings.push({
          layer: 'structure',
          code: 'structure_payoff_not_earlier',
          severity: 'error',
          file,
          path: `scenes[${index}].pays_off`,
          pointerLabel: 'orchestration.scenes',
          section: 'cross',
          message: `Structure: scene ${sceneId} pays_off target '${target}' must come earlier in scenes`,
        });
      }
    }
  });
}

/**
 * Validate opt-in branching graph invariants whenever `orchestration.scenes` declares `graph`.
 *
 * @param {ReadonlyMap<string, any>} pointerMap
 * @param {any[]} findings
 */
export function collectGraphFindings(pointerMap, findings) {
  const scenesDoc = getDoc(pointerMap, 'orchestration.scenes');
  if (!scenesDoc || !hasOwn(scenesDoc, 'graph')) {
    return;
  }

  const file = getFile(pointerMap, 'orchestration.scenes');
  /**
   * @param {string} code
   * @param {string} yamlPath
   * @param {string} message
   */
  const pushGraphError = (code, yamlPath, message) => {
    findings.push({
      layer: 'graph',
      code,
      severity: 'error',
      file,
      path: yamlPath,
      pointerLabel: 'orchestration.scenes',
      section: 'cross',
      message: `Graph: ${message}`,
    });
  };

  if (scenesDoc.version !== '1.1.0') {
    pushGraphError(
      'graph_invalid_version',
      'version',
      `scenes document with graph requires version '1.1.0' (found ${JSON.stringify(scenesDoc.version)})`,
    );
  }

  /** @type {Map<string, number>} */
  const sceneIdCounts = new Map();
  const rawScenes = Array.isArray(scenesDoc.scenes) ? scenesDoc.scenes : [];
  rawScenes.forEach((rawScene, index) => {
    if (!isRecord(rawScene) || typeof rawScene.id !== 'string') {
      return;
    }
    const id = rawScene.id;
    const count = (sceneIdCounts.get(id) ?? 0) + 1;
    sceneIdCounts.set(id, count);
    if (count > 1) {
      pushGraphError(
        'graph_duplicate_scene_id',
        `scenes[${index}].id`,
        `duplicate scene ID '${id}' within orchestration.scenes is not permitted when graph is declared`,
      );
    }
  });

  const rawGraph = scenesDoc.graph;
  if (!isRecord(rawGraph)) {
    pushGraphError(
      'graph_invalid_shape',
      'graph',
      'graph must be a YAML object declaring entry, endings, and transitions',
    );
    return;
  }

  for (const key of Object.keys(rawGraph)) {
    if (!GRAPH_ALLOWED_KEYS.has(key)) {
      pushGraphError('graph_unknown_property', `graph.${key}`, `unknown graph property '${key}'`);
    }
  }

  /**
   * @param {unknown} ref
   * @param {string} yamlPath
   * @param {string} label
   * @returns {string | null}
   */
  const checkSceneRef = (ref, yamlPath, label) => {
    if (typeof ref !== 'string' || !SCENE_ID_RE.test(ref)) {
      pushGraphError(
        'graph_invalid_scene_ref',
        yamlPath,
        `${label} must be a valid scene ID matching ^SC[0-9]{3}$`,
      );
      return null;
    }
    const count = sceneIdCounts.get(ref) ?? 0;
    if (count === 0) {
      pushGraphError('graph_missing_scene_ref', yamlPath, `${label} references missing scene '${ref}'`);
      return null;
    }
    if (count > 1) {
      pushGraphError(
        'graph_ambiguous_scene_ref',
        yamlPath,
        `${label} references ambiguous duplicate scene '${ref}'`,
      );
      return null;
    }
    return ref;
  };

  checkSceneRef(rawGraph.entry, 'graph.entry', 'graph.entry');

  /** @type {Set<string>} */
  const endingSceneIds = new Set();
  /** @type {Set<string>} */
  const endingCodes = new Set();
  const rawEndings = rawGraph.endings;
  if (!Array.isArray(rawEndings) || rawEndings.length === 0) {
    pushGraphError(
      'graph_invalid_endings',
      'graph.endings',
      'graph.endings must be a non-empty array of ending declarations',
    );
  } else {
    rawEndings.forEach((rawEnding, index) => {
      const basePath = `graph.endings[${index}]`;
      if (!isRecord(rawEnding)) {
        pushGraphError('graph_invalid_ending', basePath, 'ending entry must be an object');
        return;
      }
      for (const key of Object.keys(rawEnding)) {
        if (!GRAPH_ENDING_ALLOWED_KEYS.has(key)) {
          pushGraphError(
            'graph_unknown_property',
            `${basePath}.${key}`,
            `unknown ending property '${key}'`,
          );
        }
      }
      const resolvedSceneId = checkSceneRef(
        rawEnding.scene_id,
        `${basePath}.scene_id`,
        `${basePath}.scene_id`,
      );
      if (resolvedSceneId !== null) {
        if (endingSceneIds.has(resolvedSceneId)) {
          pushGraphError(
            'graph_duplicate_ending_scene_id',
            `${basePath}.scene_id`,
            `ending scene '${resolvedSceneId}' is declared more than once`,
          );
        } else {
          endingSceneIds.add(resolvedSceneId);
        }
      }
      const code = rawEnding.code;
      if (typeof code !== 'string' || !GRAPH_CODE_RE.test(code)) {
        pushGraphError(
          'graph_invalid_ending_code',
          `${basePath}.code`,
          'ending code must match ^[a-z][a-z0-9_]*$',
        );
      } else if (endingCodes.has(code)) {
        pushGraphError('graph_duplicate_ending_code', `${basePath}.code`, `duplicate ending code '${code}'`);
      } else {
        endingCodes.add(code);
      }
      if (!isGraphText(rawEnding.label)) {
        pushGraphError(
          'graph_invalid_ending_label',
          `${basePath}.label`,
          'ending label must be a non-empty non-whitespace string',
        );
      }
      if (hasOwn(rawEnding, 'outcome_summary') && !isGraphText(rawEnding.outcome_summary)) {
        pushGraphError(
          'graph_invalid_ending_summary',
          `${basePath}.outcome_summary`,
          'ending outcome_summary must be a non-empty non-whitespace string',
        );
      }
    });
  }

  /** @type {Map<string, { type: 'boolean' } | { type: 'enum', values: Set<string> }>} */
  const stateVars = new Map();
  if (hasOwn(rawGraph, 'state')) {
    const rawState = rawGraph.state;
    if (!isRecord(rawState)) {
      pushGraphError('graph_invalid_state', 'graph.state', 'graph.state must be an object');
    } else {
      const entries = Object.entries(rawState);
      if (entries.length > GRAPH_MAX_STATE_VARS) {
        pushGraphError(
          'graph_state_limit_exceeded',
          'graph.state',
          `graph.state declares ${entries.length} variables (maximum is ${GRAPH_MAX_STATE_VARS})`,
        );
      }
      for (const [varName, rawVar] of entries) {
        const varPath = `graph.state.${varName}`;
        if (!GRAPH_CODE_RE.test(varName)) {
          pushGraphError(
            'graph_invalid_state_key',
            varPath,
            `state variable key '${varName}' must match ^[a-z][a-z0-9_]*$`,
          );
        }
        if (!isRecord(rawVar)) {
          pushGraphError(
            'graph_invalid_state_var',
            varPath,
            `state variable '${varName}' must be an object`,
          );
          continue;
        }
        for (const key of Object.keys(rawVar)) {
          if (!GRAPH_VAR_ALLOWED_KEYS.has(key)) {
            pushGraphError(
              'graph_unknown_property',
              `${varPath}.${key}`,
              `unknown property '${key}' on state variable '${varName}'`,
            );
          }
        }
        const varType = rawVar.type;
        if (varType === 'boolean') {
          if (typeof rawVar.initial !== 'boolean') {
            pushGraphError(
              'graph_invalid_state_initial',
              `${varPath}.initial`,
              `boolean state variable '${varName}' requires a boolean initial value`,
            );
          }
          if (hasOwn(rawVar, 'values')) {
            pushGraphError(
              'graph_boolean_has_values',
              `${varPath}.values`,
              `boolean state variable '${varName}' must not declare values`,
            );
          }
          stateVars.set(varName, { type: 'boolean' });
        } else if (varType === 'enum') {
          const rawValues = rawVar.values;
          /** @type {Set<string>} */
          const valueSet = new Set();
          if (!Array.isArray(rawValues) || rawValues.length === 0 || rawValues.length > GRAPH_MAX_ENUM_VALUES) {
            pushGraphError(
              'graph_invalid_enum_values',
              `${varPath}.values`,
              `enum state variable '${varName}' requires 1..${GRAPH_MAX_ENUM_VALUES} values`,
            );
          } else {
            rawValues.forEach((v, vIdx) => {
              if (!isGraphText(v)) {
                pushGraphError(
                  'graph_invalid_enum_value',
                  `${varPath}.values[${vIdx}]`,
                  `enum value for '${varName}' must be a non-empty non-whitespace string`,
                );
              } else if (valueSet.has(v)) {
                pushGraphError(
                  'graph_duplicate_enum_value',
                  `${varPath}.values[${vIdx}]`,
                  `duplicate enum value '${v}' on state variable '${varName}'`,
                );
              } else {
                valueSet.add(v);
              }
            });
          }
          if (typeof rawVar.initial !== 'string') {
            pushGraphError(
              'graph_invalid_state_initial',
              `${varPath}.initial`,
              `enum state variable '${varName}' requires a string initial value`,
            );
          } else if (valueSet.size > 0 && !valueSet.has(rawVar.initial)) {
            pushGraphError(
              'graph_enum_initial_not_in_values',
              `${varPath}.initial`,
              `enum state variable '${varName}' initial value '${rawVar.initial}' is absent from values`,
            );
          }
          stateVars.set(varName, { type: 'enum', values: valueSet });
        } else {
          pushGraphError(
            'graph_invalid_state_type',
            `${varPath}.type`,
            `state variable '${varName}' type must be 'boolean' or 'enum'`,
          );
        }
      }
    }
  }

  const rawTransitions = rawGraph.transitions;
  if (!Array.isArray(rawTransitions)) {
    pushGraphError(
      'graph_invalid_transitions',
      'graph.transitions',
      'graph.transitions must be an array',
    );
    return;
  }

  /** @type {Set<string>} */
  const seenTransitionIds = new Set();
  /** @type {Map<string, number>} */
  const defaultCountByFrom = new Map();

  /**
   * @param {unknown} rawMap
   * @param {string} yamlPath
   * @param {'when' | 'effects'} kindLabel
   */
  const checkAssignments = (rawMap, yamlPath, kindLabel) => {
    if (!isRecord(rawMap)) {
      pushGraphError(
        kindLabel === 'when' ? 'graph_invalid_guard' : 'graph_invalid_effects',
        yamlPath,
        `transition ${kindLabel} must be an object`,
      );
      return;
    }
    const entries = Object.entries(rawMap);
    if (entries.length > GRAPH_MAX_STATE_VARS) {
      pushGraphError(
        kindLabel === 'when' ? 'graph_invalid_guard' : 'graph_invalid_effects',
        yamlPath,
        `transition ${kindLabel} exceeds maximum of ${GRAPH_MAX_STATE_VARS} entries`,
      );
    }
    for (const [key, val] of entries) {
      const entryPath = `${yamlPath}.${key}`;
      const spec = stateVars.get(key);
      if (!spec) {
        pushGraphError(
          'graph_undeclared_state_var',
          entryPath,
          `transition ${kindLabel} references undeclared state variable '${key}'`,
        );
        continue;
      }
      if (spec.type === 'boolean') {
        if (typeof val !== 'boolean') {
          pushGraphError(
            'graph_out_of_domain_value',
            entryPath,
            `transition ${kindLabel} for boolean variable '${key}' requires a boolean value`,
          );
        }
      } else if (typeof val !== 'string' || !spec.values.has(val)) {
        pushGraphError(
          'graph_out_of_domain_value',
          entryPath,
          `transition ${kindLabel} for enum variable '${key}' uses value ${JSON.stringify(val)} outside declared values`,
        );
      }
    }
  };

  rawTransitions.forEach((rawTr, index) => {
    const basePath = `graph.transitions[${index}]`;
    if (!isRecord(rawTr)) {
      pushGraphError('graph_invalid_transition', basePath, 'transition entry must be an object');
      return;
    }
    for (const key of Object.keys(rawTr)) {
      if (!GRAPH_TRANSITION_ALLOWED_KEYS.has(key)) {
        pushGraphError(
          'graph_unknown_property',
          `${basePath}.${key}`,
          `unknown transition property '${key}'`,
        );
      }
    }
    const trId = rawTr.id;
    if (typeof trId !== 'string' || !TRANSITION_ID_RE.test(trId)) {
      pushGraphError(
        'graph_invalid_transition_id',
        `${basePath}.id`,
        'transition id must match ^TR[0-9]{3}$',
      );
    } else if (seenTransitionIds.has(trId)) {
      pushGraphError(
        'graph_duplicate_transition_id',
        `${basePath}.id`,
        `duplicate transition ID '${trId}'`,
      );
    } else {
      seenTransitionIds.add(trId);
    }

    const fromScene = checkSceneRef(rawTr.from, `${basePath}.from`, `${basePath}.from`);
    checkSceneRef(rawTr.to, `${basePath}.to`, `${basePath}.to`);

    if (fromScene !== null && endingSceneIds.has(fromScene)) {
      pushGraphError(
        'graph_ending_outgoing_transition',
        `${basePath}.from`,
        `ending scene '${fromScene}' must not have outgoing transition '${String(trId ?? '?')}'`,
      );
    }

    const kind = rawTr.kind;
    if (kind !== 'choice' && kind !== 'default') {
      pushGraphError(
        'graph_invalid_transition_kind',
        `${basePath}.kind`,
        `transition kind must be 'choice' or 'default'`,
      );
    }

    if (!isGraphText(rawTr.label)) {
      pushGraphError(
        'graph_invalid_transition_label',
        `${basePath}.label`,
        'transition label must be a non-empty non-whitespace string',
      );
    }

    if (kind === 'default') {
      if (hasOwn(rawTr, 'when')) {
        pushGraphError(
          'graph_default_with_when',
          `${basePath}.when`,
          `default transition '${String(trId ?? '?')}' must not declare a 'when' guard`,
        );
      }
      if (fromScene !== null) {
        const count = (defaultCountByFrom.get(fromScene) ?? 0) + 1;
        defaultCountByFrom.set(fromScene, count);
        if (count > 1) {
          pushGraphError(
            'graph_multiple_defaults',
            basePath,
            `scene '${fromScene}' declares more than one default transition`,
          );
        }
      }
    } else if (hasOwn(rawTr, 'when')) {
      checkAssignments(rawTr.when, `${basePath}.when`, 'when');
    }

    if (hasOwn(rawTr, 'effects')) {
      checkAssignments(rawTr.effects, `${basePath}.effects`, 'effects');
    }
  });
}

/**
 * @param {ReadonlyMap<string, any>} pointerMap
 * @param {any[]} findings
 */
function collectVariantFindings(pointerMap, findings) {
  const variantsDoc = getDoc(pointerMap, 'delivery.variants');
  if (!variantsDoc) {
    return;
  }

  const file = getFile(pointerMap, 'delivery.variants');
  const scenesDoc = getDoc(pointerMap, 'orchestration.scenes');
  /** @type {Map<string, Record<string, unknown>>} */
  const scenes = new Map();
  const rawScenes = Array.isArray(scenesDoc?.scenes) ? scenesDoc.scenes : [];
  for (const scene of rawScenes) {
    if (isRecord(scene) && typeof scene.id === 'string') {
      scenes.set(scene.id, scene);
    }
  }

  const variants = Array.isArray(variantsDoc.variants) ? variantsDoc.variants : [];
  variants.forEach((rawVariant, variantIndex) => {
    if (!isRecord(rawVariant)) {
      return;
    }
    const basePath = `variants[${variantIndex}]`;
    const label = `${String(rawVariant.id ?? '?')} (${String(rawVariant.name ?? 'unnamed')})`;
    const selection = isRecord(rawVariant.scene_selection) ? rawVariant.scene_selection : {};
    const selected = Array.isArray(selection.scene_ids) ? selection.scene_ids : [];

    /** @type {Set<string>} */
    const seen = new Set();
    selected.forEach((id, selIdx) => {
      if (typeof id !== 'string') {
        return;
      }
      if (seen.has(id)) {
        findings.push({
          layer: 'variant',
          code: 'variant_duplicate_scene',
          severity: 'error',
          file,
          path: `${basePath}.scene_selection.scene_ids[${selIdx}]`,
          pointerLabel: 'delivery.variants',
          section: 'cross',
          message: `Variant ${label}: scene ${id} is selected more than once`,
        });
      }
      seen.add(id);
    });

    /** @type {Map<string, Record<string, unknown>>} */
    const overrides = new Map();
    const rawOverrides = Array.isArray(selection.overrides) ? selection.overrides : [];
    rawOverrides.forEach((rawOverride, ovIdx) => {
      if (!isRecord(rawOverride)) {
        return;
      }
      const ref = rawOverride.scene_ref;
      if (typeof ref !== 'string' || !ref) {
        return;
      }
      if (!seen.has(ref)) {
        findings.push({
          layer: 'variant',
          code: 'variant_override_unselected_scene',
          severity: 'error',
          file,
          path: `${basePath}.scene_selection.overrides[${ovIdx}].scene_ref`,
          pointerLabel: 'delivery.variants',
          section: 'cross',
          message:
            `Variant ${label}: override targets scene ${ref}, which this variant does not deliver - ` +
            `it would have no effect`,
        });
        return;
      }
      overrides.set(ref, rawOverride);
    });

    const durationMinutes = rawVariant.duration_minutes;
    if (typeof durationMinutes !== 'number') {
      return;
    }

    let sum = 0;
    /** @type {string[]} */
    const missingTimeboxes = [];
    for (const id of seen) {
      const override = overrides.get(id);
      if (typeof override?.timebox_minutes === 'number') {
        sum += override.timebox_minutes;
        continue;
      }
      const scene = scenes.get(id);
      const timebox = isRecord(scene?.timebox) ? scene.timebox : undefined;
      const target = timebox?.target;
      if (typeof target === 'number') {
        sum += target;
      } else {
        missingTimeboxes.push(id);
      }
    }

    const omitted = [...scenes.keys()].filter((id) => !seen.has(id));
    const omittedNote = omitted.length > 0 ? `; omits ${omitted.join(', ')}` : '';

    if (missingTimeboxes.length > 0) {
      findings.push({
        layer: 'variant',
        code: 'variant_missing_timebox',
        severity: 'warning',
        file,
        path: `${basePath}.scene_selection`,
        pointerLabel: 'delivery.variants',
        section: 'warnings',
        message:
          `Variant ${label}: no timebox target for ${missingTimeboxes.join(', ')}, so the sum below ` +
          `understates the run`,
      });
    }

    if (sum > durationMinutes) {
      findings.push({
        layer: 'variant',
        code: 'variant_over_duration',
        severity: 'error',
        file,
        path: `${basePath}.duration_minutes`,
        pointerLabel: 'delivery.variants',
        section: 'cross',
        message:
          `Variant ${label}: selected scenes sum to ${sum} minutes against a declared ` +
          `${durationMinutes}, over by ${sum - durationMinutes} ` +
          `(${seen.size} scene(s)${omittedNote})`,
      });
    } else if (sum < durationMinutes * 0.8) {
      findings.push({
        layer: 'variant',
        code: 'variant_under_duration',
        severity: 'warning',
        file,
        path: `${basePath}.duration_minutes`,
        pointerLabel: 'delivery.variants',
        section: 'warnings',
        message:
          `Variant ${label}: selected scenes sum to ${sum} minutes against a declared ` +
          `${durationMinutes}, leaving ${durationMinutes - sum} unfilled ` +
          `(${seen.size} scene(s)${omittedNote})`,
      });
    }
  });
}

/**
 * @param {ReadonlyMap<string, any>} pointerMap
 * @param {readonly any[]} schemaBackedPointers
 * @param {any[]} findings
 */
function collectFilmFindings(pointerMap, schemaBackedPointers, findings) {
  const film = getDoc(pointerMap, 'orchestration.film');
  if (!film) {
    return;
  }

  const filmFile = getFile(pointerMap, 'orchestration.film');
  const variantsFile = getFile(pointerMap, 'delivery.variants');
  const COMMITTED = new Set(['rehearsed', 'delivered']);
  const SPOKEN = new Set(['recorded', 'synthesized']);

  /**
   * @param {boolean} committed
   * @param {string} code
   * @param {string} file
   * @param {string} yamlPath
   * @param {string} pointerLabel
   * @param {string} message
   */
  const pushGraded = (committed, code, file, yamlPath, pointerLabel, message) => {
    findings.push({
      layer: 'film',
      code,
      severity: committed ? 'error' : 'warning',
      file,
      path: yamlPath,
      pointerLabel,
      section: committed ? 'cross' : 'warnings',
      message,
    });
  };

  const lines = (Array.isArray(film.lines) ? film.lines : []).filter(
    (line) => isRecord(line) && typeof line.id === 'string',
  );
  const texts = (Array.isArray(film.on_screen_texts) ? film.on_screen_texts : []).filter(
    (text) => isRecord(text) && typeof text.id === 'string',
  );
  const shots = (Array.isArray(film.shots) ? film.shots : []).filter(
    (shot) => isRecord(shot) && typeof shot.id === 'string',
  );

  /** @type {Map<string, number>} */
  const lineIndex = new Map(lines.map((line, index) => [String(line.id), index]));
  /** @type {Map<string, Record<string, unknown>>} */
  const textById = new Map(texts.map((text) => [String(text.id), text]));

  /**
   * @param {Record<string, unknown>} shot
   * @returns {string[]}
   */
  const shotTexts = (shot) => {
    const visual = isRecord(shot.visual) ? shot.visual : undefined;
    if (Array.isArray(visual?.text_refs)) {
      return visual.text_refs.filter((v) => typeof v === 'string');
    }
    const card = isRecord(visual?.card) ? visual.card : undefined;
    if (Array.isArray(card?.text_refs)) {
      return card.text_refs.filter((v) => typeof v === 'string');
    }
    return [];
  };

  const scripts = schemaBackedPointers
    .filter(
      (p) =>
        p.status === 'loaded' &&
        (p.label === 'delivery.script' || p.label.startsWith('delivery.scripts[')) &&
        isRecord(p.content),
    )
    .map((p) => {
      const doc = /** @type {Record<string, unknown>} */ (p.content);
      const voice = isRecord(doc.voice) ? doc.voice : undefined;
      return {
        label: p.label,
        file: p.location.file,
        doc,
        language: typeof voice?.language === 'string' ? voice.language : undefined,
      };
    });

  /** @type {Map<string, (typeof scripts)[number]>} */
  const scriptByLanguage = new Map();
  for (const script of scripts) {
    if (typeof script.language !== 'string') {
      continue;
    }
    if (scriptByLanguage.has(script.language)) {
      const existing = scriptByLanguage.get(script.language);
      findings.push({
        layer: 'film',
        code: 'film_duplicate_script_language',
        severity: 'error',
        file: script.file,
        path: 'voice.language',
        pointerLabel: script.label,
        section: 'cross',
        message:
          `Film check 5: ${script.label} and ${existing?.label ?? ''} both declare ` +
          `voice.language ${script.language}, so a cut in that language has two sets of words`,
      });
      continue;
    }
    scriptByLanguage.set(script.language, script);
  }

  const variantsDoc = getDoc(pointerMap, 'delivery.variants');
  const rawVariants = Array.isArray(variantsDoc?.variants) ? variantsDoc.variants : [];
  const filmVariants = rawVariants
    .map((variant, index) => ({ variant, index }))
    .filter((entry) => isRecord(entry.variant) && isRecord(entry.variant.film))
    .map(({ variant, index }) => {
      const selection = isRecord(variant.scene_selection) ? variant.scene_selection : {};
      const selected = new Set(
        (Array.isArray(selection.scene_ids) ? selection.scene_ids : []).filter(
          (id) => typeof id === 'string',
        ),
      );
      const filmBlock = /** @type {Record<string, unknown>} */ (variant.film);
      const voice = isRecord(filmBlock.voice) ? filmBlock.voice : undefined;
      return {
        variant,
        index,
        label: `${String(variant.id ?? '?')} (${String(variant.name ?? 'unnamed')})`,
        selected,
        committed: typeof variant.status === 'string' && COMMITTED.has(variant.status),
        source: typeof voice?.source === 'string' ? voice.source : undefined,
      };
    });

  /** @type {Set<string>} */
  const seenScenes = new Set();
  /** @type {string | null} */
  let previousScene = null;
  lines.forEach((line, idx) => {
    const sceneRef = String(line.scene_ref ?? '');
    if (sceneRef !== previousScene && seenScenes.has(sceneRef)) {
      findings.push({
        layer: 'film',
        code: 'film_non_contiguous_lines',
        severity: 'error',
        file: filmFile,
        path: `lines[${idx}].scene_ref`,
        pointerLabel: 'orchestration.film',
        section: 'cross',
        message:
          `Film check 2: line ${String(line.id)} (scene_ref ${sceneRef}) follows a line of another scene, ` +
          `so the lines of scene ${sceneRef} are not contiguous`,
      });
    }
    seenScenes.add(sceneRef);
    previousScene = sceneRef;
  });

  const scenesWithLines = new Set(lines.map((line) => String(line.scene_ref ?? '')));
  const scenesShowingText = new Set(
    shots.filter((shot) => shotTexts(shot).length > 0).map((shot) => String(shot.scene_ref ?? '')),
  );
  for (const cut of filmVariants) {
    const silent = [...cut.selected].filter((sceneId) => {
      if (scenesWithLines.has(sceneId)) {
        return false;
      }
      if (cut.source && SPOKEN.has(cut.source)) {
        return true;
      }
      if (cut.source === 'none') {
        return !scenesShowingText.has(sceneId);
      }
      return false;
    });
    if (silent.length > 0) {
      const what = cut.source === 'none'
        ? 'no line and no shot listing a text in visual.text_refs'
        : 'no line';
      findings.push({
        layer: 'film',
        code: 'film_silent_scene',
        severity: 'warning',
        file: variantsFile,
        path: `variants[${cut.index}].scene_selection.scene_ids`,
        pointerLabel: 'delivery.variants',
        section: 'warnings',
        message:
          `Film check 2: variant ${cut.label}, voice.source ${cut.source}: selected scene(s) ${silent.join(', ')} ` +
          `have ${what}, so the viewer gets nothing to ${cut.source === 'none' ? 'read' : 'hear'} there`,
      });
    }
  }

  /** @type {Map<string, string[]>} */
  const coveredBy = new Map();
  shots.forEach((shot, shotIdx) => {
    const spans = isRecord(shot.spans) ? shot.spans : undefined;
    const from = typeof spans?.from_line_ref === 'string' ? spans.from_line_ref : undefined;
    if (!from) {
      return;
    }
    const to = typeof spans?.to_line_ref === 'string' ? spans.to_line_ref : from;
    if (!lineIndex.has(from) || !lineIndex.has(to)) {
      return;
    }
    const start = lineIndex.get(from) ?? 0;
    const end = lineIndex.get(to) ?? 0;
    const shotId = String(shot.id);
    if (end < start) {
      findings.push({
        layer: 'film',
        code: 'film_span_backwards',
        severity: 'error',
        file: filmFile,
        path: `shots[${shotIdx}].spans`,
        pointerLabel: 'orchestration.film',
        section: 'cross',
        message: `Film check 3: shot ${shotId} spans runs backwards, from_line_ref ${from} to to_line_ref ${to}`,
      });
      return;
    }
    for (let i = start; i <= end; i += 1) {
      const line = lines[i];
      if (!line) {
        continue;
      }
      const lineId = String(line.id);
      if (line.scene_ref !== shot.scene_ref) {
        findings.push({
          layer: 'film',
          code: 'film_span_cross_scene',
          severity: 'error',
          file: filmFile,
          path: `shots[${shotIdx}].spans`,
          pointerLabel: 'orchestration.film',
          section: 'cross',
          message:
            `Film check 3: shot ${shotId} (scene_ref ${String(shot.scene_ref)}) spans line ${lineId} of scene ` +
            `${String(line.scene_ref)}, outside its own scene`,
        });
      }
      const owners = coveredBy.get(lineId) ?? [];
      owners.push(shotId);
      coveredBy.set(lineId, owners);
    }
  });
  for (const [lineId, owners] of coveredBy) {
    if (owners.length > 1) {
      findings.push({
        layer: 'film',
        code: 'film_line_multi_shot',
        severity: 'error',
        file: filmFile,
        path: 'shots',
        pointerLabel: 'orchestration.film',
        section: 'cross',
        message: `Film check 3: line ${lineId} is covered by more than one shot (${owners.join(', ')})`,
      });
    }
  }

  /** @type {Map<string, boolean>} */
  const sceneCommitted = new Map();
  if (filmVariants.length === 0) {
    for (const sceneId of scenesWithLines) {
      sceneCommitted.set(sceneId, false);
    }
  } else {
    for (const cut of filmVariants) {
      for (const sceneId of cut.selected) {
        sceneCommitted.set(sceneId, (sceneCommitted.get(sceneId) ?? false) || cut.committed);
      }
    }
  }
  const uncovered = lines.filter(
    (line) => sceneCommitted.has(String(line.scene_ref ?? '')) && !coveredBy.has(String(line.id)),
  );
  if (uncovered.length > 0 && shots.length === 0) {
    const committed = uncovered.some((line) => sceneCommitted.get(String(line.scene_ref ?? '')));
    pushGraded(
      Boolean(committed),
      'film_no_shots',
      filmFile,
      'shots',
      'orchestration.film',
      `Film check 3: the film has no shots yet, so ${uncovered.length} line(s) are covered by no shot` +
        (committed ? ' although a cut selecting them is rehearsed or delivered' : ''),
    );
  } else if (uncovered.length > 0) {
    for (const committed of [true, false]) {
      const group = uncovered.filter(
        (line) => sceneCommitted.get(String(line.scene_ref ?? '')) === committed,
      );
      if (group.length === 0) {
        continue;
      }
      pushGraded(
        committed,
        'film_uncovered_lines',
        filmFile,
        'shots',
        'orchestration.film',
        `Film check 3: line(s) covered by no shot's spans: ${group
          .map((line) => `${String(line.id)} (${String(line.scene_ref)})`)
          .join(', ')}` +
          (committed ? ', selected by a cut that is rehearsed or delivered' : ''),
      );
    }
  }

  shots.forEach((shot, shotIdx) => {
    const shotId = String(shot.id);
    for (const textId of shotTexts(shot)) {
      const anchor = textById.get(textId)?.anchor_line_ref;
      if (typeof anchor !== 'string' || !lineIndex.has(anchor)) {
        continue;
      }
      const spans = isRecord(shot.spans) ? shot.spans : undefined;
      const from = typeof spans?.from_line_ref === 'string' ? spans.from_line_ref : undefined;
      if (!from) {
        findings.push({
          layer: 'film',
          code: 'film_anchor_no_span',
          severity: 'error',
          file: filmFile,
          path: `shots[${shotIdx}].visual`,
          pointerLabel: 'orchestration.film',
          section: 'cross',
          message: `Film check 9: shot ${shotId} shows ${textId}, whose anchor_line_ref is ${anchor}, but the shot spans no line`,
        });
        continue;
      }
      const to = typeof spans?.to_line_ref === 'string' ? spans.to_line_ref : from;
      const anchorIdx = lineIndex.get(anchor) ?? 0;
      if (!lineIndex.has(from) || !lineIndex.has(to)) {
        continue;
      }
      const fromIdx = lineIndex.get(from) ?? 0;
      const toIdx = lineIndex.get(to) ?? 0;
      if (anchorIdx < fromIdx || anchorIdx > toIdx) {
        findings.push({
          layer: 'film',
          code: 'film_anchor_outside_span',
          severity: 'error',
          file: filmFile,
          path: `shots[${shotIdx}].visual`,
          pointerLabel: 'orchestration.film',
          section: 'cross',
          message:
            `Film check 9: shot ${shotId} shows ${textId}, whose anchor_line_ref ${anchor} lies outside the ` +
            `shot's spans (${from}${to !== from ? ` to ${to}` : ''})`,
        });
      }
    }
  });

  const assetsDoc = getDoc(pointerMap, 'knowledge.assets');
  /** @type {Map<string, Record<string, unknown>>} */
  const assets = new Map(
    (Array.isArray(assetsDoc?.assets) ? assetsDoc.assets : [])
      .filter((asset) => isRecord(asset) && typeof asset.id === 'string')
      .map((asset) => [String(asset.id), asset]),
  );
  /** @type {Set<string>} */
  const reportedAnalogies = new Set();
  shots.forEach((shot, shotIdx) => {
    const visual = isRecord(shot.visual) ? shot.visual : undefined;
    const assetRef = typeof visual?.asset_ref === 'string' ? visual.asset_ref : undefined;
    const asset = assetRef ? assets.get(assetRef) : undefined;
    if (!asset || asset.kind !== 'analogy') {
      return;
    }
    const assetId = String(asset.id);
    if (reportedAnalogies.has(assetId)) {
      return;
    }
    const illustrates = isRecord(asset.illustrates) ? asset.illustrates : undefined;
    const claims = illustrates?.claims;
    if (!Array.isArray(claims) || claims.length === 0) {
      reportedAnalogies.add(assetId);
      findings.push({
        layer: 'film',
        code: 'film_analogy_missing_claim',
        severity: 'error',
        file: filmFile,
        path: `shots[${shotIdx}].visual.asset_ref`,
        pointerLabel: 'orchestration.film',
        section: 'cross',
        message: `Film check 9: asset ${assetId} of kind analogy is shown by shot ${String(shot.id)} but names no claim in illustrates.claims`,
      });
    }
  });

  const intentDoc = getDoc(pointerMap, 'intent');
  const intentConstraints = isRecord(intentDoc?.constraints) ? intentDoc.constraints : undefined;
  const intentMinutes = typeof intentConstraints?.duration_minutes === 'number'
    ? intentConstraints.duration_minutes
    : undefined;

  for (const cut of filmVariants) {
    const cutShots = shots.filter((shot) => cut.selected.has(String(shot.scene_ref ?? '')));
    const cutLines = lines.filter((line) => cut.selected.has(String(line.scene_ref ?? '')));
    const shownTexts = [...new Set(cutShots.flatMap((shot) => shotTexts(shot)))];

    const calls = shownTexts.filter((textId) => textById.get(textId)?.role === 'call_to_action');
    if (calls.length > 1) {
      pushGraded(
        cut.committed,
        'film_multiple_cta',
        variantsFile,
        `variants[${cut.index}]`,
        'delivery.variants',
        `Film check 9: variant ${cut.label} shows ${calls.length} on-screen text(s) of role call_to_action ` +
          `in visual.text_refs (${calls.join(', ')}); a cut shows at most one`,
      );
    }

    const language = cut.variant.language;
    const script = typeof language === 'string' ? scriptByLanguage.get(language) : undefined;
    if (!script) {
      pushGraded(
        cut.committed,
        'film_missing_language_script',
        variantsFile,
        `variants[${cut.index}].language`,
        'delivery.variants',
        typeof language === 'string'
          ? `Film check 6: variant ${cut.label} is in language ${language}, and no script declares voice.language ${language}`
          : `Film check 6: variant ${cut.label} declares no language, so no script can word it`,
      );
      if (cut.source && SPOKEN.has(cut.source)) {
        findings.push({
          layer: 'film',
          code: 'film_timing_no_script',
          severity: 'info',
          file: variantsFile,
          path: `variants[${cut.index}]`,
          pointerLabel: 'delivery.variants',
          section: 'info',
          message: `Film check 7: variant ${cut.label}: no running time estimated, because no script words this cut`,
        });
      }
    } else {
      const scriptBody = isRecord(script.doc.script) ? script.doc.script : undefined;
      /** @type {Map<string, string>} */
      const lineWords = new Map();
      for (const rawScene of Array.isArray(scriptBody?.scenes) ? scriptBody.scenes : []) {
        if (!isRecord(rawScene)) {
          continue;
        }
        for (const entry of Array.isArray(rawScene.lines) ? rawScene.lines : []) {
          if (isRecord(entry) && typeof entry.line_ref === 'string' && typeof entry.text === 'string') {
            lineWords.set(entry.line_ref, entry.text);
          }
        }
      }
      const textWords = new Set(
        (Array.isArray(scriptBody?.on_screen) ? scriptBody.on_screen : [])
          .filter((entry) => isRecord(entry) && typeof entry.text === 'string')
          .map((entry) => String(entry.text_ref)),
      );

      const missingLines = cutLines.filter((line) => !lineWords.has(String(line.id)));
      if (missingLines.length > 0) {
        pushGraded(
          cut.committed,
          'film_missing_line_text',
          script.file,
          'script.scenes',
          script.label,
          `Film check 6: variant ${cut.label}: ${script.label} (${String(language)}) has no text in script.scenes[].lines ` +
            `for line(s) ${missingLines
              .map((line) => `${String(line.id)} (${String(line.scene_ref)})`)
              .join(', ')}`,
        );
      }

      const missingTexts = shownTexts.filter((textId) => textById.has(textId) && !textWords.has(textId));
      if (missingTexts.length > 0) {
        pushGraded(
          cut.committed,
          'film_missing_on_screen_text',
          script.file,
          'script.on_screen',
          script.label,
          `Film check 6: variant ${cut.label}: ${script.label} (${String(language)}) has no text in script.on_screen ` +
            `for on-screen text(s) ${missingTexts.join(', ')}`,
        );
      }

      if (cut.source && SPOKEN.has(cut.source)) {
        const voice = isRecord(script.doc.voice) ? script.doc.voice : undefined;
        const pacing = isRecord(voice?.pacing) ? voice.pacing : {};
        const wpm = pacing.words_per_minute_target;
        if (typeof wpm !== 'number' || wpm <= 0) {
          findings.push({
            layer: 'film',
            code: 'film_timing_no_wpm',
            severity: 'info',
            file: script.file,
            path: 'voice.pacing.words_per_minute_target',
            pointerLabel: script.label,
            section: 'info',
            message:
              `Film check 7: variant ${cut.label}: no running time estimated, because ${script.label} has no ` +
              `voice.pacing.words_per_minute_target`,
          });
        } else {
          const counted = cutLines.filter((line) => lineWords.has(String(line.id)));
          const words = counted.reduce(
            (sum, line) => sum + (lineWords.get(String(line.id)) ?? '').split(/\s+/).filter(Boolean).length,
            0,
          );
          const speech = (words / wpm) * 60;
          const pause = typeof pacing.seconds_between_lines === 'number' ? pacing.seconds_between_lines : 0;
          const pauses = Math.max(counted.length - 1, 0);
          const spanless = cutShots.filter((shot) => {
            const spans = isRecord(shot.spans) ? shot.spans : undefined;
            return !spans?.from_line_ref;
          });
          const timed = spanless.filter((shot) => typeof shot.duration_seconds === 'number');
          const timedSeconds = timed.reduce(
            (sum, shot) => sum + Number(shot.duration_seconds),
            0,
          );
          const untimed = spanless.length - timed.length;
          const transitions = cutShots.filter(
            (shot) => Boolean(shot.transition_in) && shot.transition_in !== 'cut',
          ).length;
          const notWorded = cutLines.length - counted.length;
          const total = speech + pauses * pause + timedSeconds;
          const lowerBound = untimed > 0 || transitions > 0 || notWorded > 0;
          const leftOut = [
            untimed ? `${untimed} span-less shot(s) without duration_seconds` : null,
            transitions ? `${transitions} transition(s)` : null,
            notWorded ? `${notWorded} line(s) with no text` : null,
          ].filter((item) => item !== null);
          const arithmetic =
            `${words} words / ${wpm} wpm = ${speech.toFixed(1)} s + ${pauses} pause(s) x ${pause} s + ` +
            `${timed.length} span-less shot(s) with duration_seconds = ${timedSeconds} s, total ` +
            `${total.toFixed(1)} s; ` +
            (lowerBound
              ? `a lower bound: it leaves out ${leftOut.join(', ')}, and scene holds`
              : 'scene holds are not counted');

          findings.push({
            layer: 'film',
            code: 'film_timing_estimate',
            severity: 'info',
            file: variantsFile,
            path: `variants[${cut.index}].film`,
            pointerLabel: 'delivery.variants',
            section: 'info',
            message: `Film check 7: variant ${cut.label}, voice.source ${cut.source}, spoken estimate: ${arithmetic}`,
          });

          const filmBlock = /** @type {Record<string, unknown>} */ (cut.variant.film);
          const max = filmBlock.max_seconds;
          if (typeof max === 'number' && total > max) {
            findings.push({
              layer: 'film',
              code: 'film_timing_over_max',
              severity: 'error',
              file: variantsFile,
              path: `variants[${cut.index}].film.max_seconds`,
              pointerLabel: 'delivery.variants',
              section: 'cross',
              message:
                `Film check 7: variant ${cut.label} runs at least ${total.toFixed(1)} s against film.max_seconds ` +
                `${max}, over by ${(total - max).toFixed(1)} s (${arithmetic})`,
            });
          }

          const cutMinutes = cut.variant.duration_minutes;
          const budget = typeof cutMinutes === 'number'
            ? { minutes: cutMinutes, field: 'variant duration_minutes' }
            : { minutes: intentMinutes, field: 'intent.constraints.duration_minutes' };

          if (typeof budget.minutes === 'number') {
            const target = budget.minutes * 60;
            if (total > target * 1.2) {
              findings.push({
                layer: 'film',
                code: 'film_timing_over_budget',
                severity: 'warning',
                file: variantsFile,
                path: `variants[${cut.index}].film`,
                pointerLabel: 'delivery.variants',
                section: 'warnings',
                message:
                  `Film check 7: variant ${cut.label} runs at least ${total.toFixed(1)} s, more than 20% above ` +
                  `${budget.field} (${budget.minutes} min = ${target} s)`,
              });
            } else if (total < target * 0.8) {
              const baseMessage =
                `Film check 7: variant ${cut.label} estimates ${total.toFixed(1)} s, more than 20% below ` +
                `${budget.field} (${budget.minutes} min = ${target} s)`;
              if (lowerBound) {
                findings.push({
                  layer: 'film',
                  code: 'film_timing_under_budget_lower_bound',
                  severity: 'info',
                  file: variantsFile,
                  path: `variants[${cut.index}].film`,
                  pointerLabel: 'delivery.variants',
                  section: 'info',
                  message: `${baseMessage}; not a warning, since the estimate leaves out ${leftOut.join(', ')}`,
                });
              } else {
                findings.push({
                  layer: 'film',
                  code: 'film_timing_under_budget',
                  severity: 'warning',
                  file: variantsFile,
                  path: `variants[${cut.index}].film`,
                  pointerLabel: 'delivery.variants',
                  section: 'warnings',
                  message: baseMessage,
                });
              }
            }
          }
        }
      }
    }

    if (cut.source === 'none') {
      findings.push({
        layer: 'film',
        code: 'film_timing_voiceless_info',
        severity: 'info',
        file: variantsFile,
        path: `variants[${cut.index}].film`,
        pointerLabel: 'delivery.variants',
        section: 'info',
        message:
          `Film check 7: variant ${cut.label}: running time of a voiceless cut is computed by generate-film-ir ` +
          `from the film tokens; this validator does not check it`,
      });
    }
  }
}

/**
 * @param {ReadonlyMap<string, any>} pointerMap
 * @param {any[]} findings
 */
function collectPictureFindings(pointerMap, findings) {
  const assetsDoc = getDoc(pointerMap, 'knowledge.assets');
  if (!assetsDoc) {
    return;
  }
  const file = getFile(pointerMap, 'knowledge.assets');
  const assets = Array.isArray(assetsDoc.assets) ? assetsDoc.assets : [];
  assets.forEach((rawAsset, assetIdx) => {
    if (!isRecord(rawAsset)) {
      return;
    }
    const media = isRecord(rawAsset.media) ? rawAsset.media : undefined;
    const shows = isRecord(media?.shows) ? media.shows : undefined;
    const subjects = shows?.subjects;
    if (!Array.isArray(subjects)) {
      return;
    }
    /** @type {Set<string>} */
    const seen = new Set();
    subjects.forEach((rawSubject, subjectIdx) => {
      if (!isRecord(rawSubject) || typeof rawSubject.id !== 'string') {
        return;
      }
      const subjectId = rawSubject.id;
      if (seen.has(subjectId)) {
        findings.push({
          layer: 'picture',
          code: 'picture_duplicate_subject_id',
          severity: 'error',
          file,
          path: `assets[${assetIdx}].media.shows.subjects[${subjectIdx}].id`,
          pointerLabel: 'knowledge.assets',
          section: 'cross',
          message: `Picture check 1: asset ${String(rawAsset.id)} names subject ${subjectId} more than once in media.shows.subjects`,
        });
      }
      seen.add(subjectId);
    });
  });
}

/**
 * @param {ReadonlyMap<string, any>} pointerMap
 * @param {any[]} findings
 */
function collectLinkFindings(pointerMap, findings) {
  /** @type {Array<{ kind: string, entity: Record<string, unknown>, field: string, file: string, pointerLabel: string, basePath: string }>} */
  const owners = [];

  const intentDoc = getDoc(pointerMap, 'intent');
  if (intentDoc && Array.isArray(intentDoc.goals)) {
    const file = getFile(pointerMap, 'intent');
    intentDoc.goals.forEach((goal, index) => {
      if (isRecord(goal)) {
        owners.push({
          kind: 'goal',
          entity: goal,
          field: 'external_goals',
          file,
          pointerLabel: 'intent',
          basePath: `goals[${index}]`,
        });
      }
    });
  }

  const conceptsDoc = getDoc(pointerMap, 'knowledge.concepts');
  if (conceptsDoc && Array.isArray(conceptsDoc.concepts)) {
    const file = getFile(pointerMap, 'knowledge.concepts');
    conceptsDoc.concepts.forEach((concept, index) => {
      if (isRecord(concept)) {
        owners.push({
          kind: 'concept',
          entity: concept,
          field: 'external_concepts',
          file,
          pointerLabel: 'knowledge.concepts',
          basePath: `concepts[${index}]`,
        });
      }
    });
  }

  for (const { kind, entity, field, file, pointerLabel, basePath } of owners) {
    const links = entity[field];
    if (!Array.isArray(links)) {
      continue;
    }
    /** @type {Set<string>} */
    const seen = new Set();
    links.forEach((rawLink, linkIdx) => {
      if (!isRecord(rawLink) || typeof rawLink.entity_id !== 'string') {
        return;
      }
      const key = `${String(rawLink.model)}/${String(rawLink.project)}/${rawLink.entity_id}`;
      if (seen.has(key)) {
        findings.push({
          layer: 'link',
          code: 'link_duplicate_external_entity',
          severity: 'error',
          file,
          path: `${basePath}.${field}[${linkIdx}]`,
          pointerLabel,
          section: 'cross',
          message: `Link check 1: ${kind} ${String(entity.id)} names ${key} more than once in ${field}`,
        });
      }
      seen.add(key);
    });
  }
}

/**
 * @param {ReadonlyMap<string, any>} pointerMap
 * @param {any[]} findings
 */
function collectGapFindings(pointerMap, findings) {
  const intent = getDoc(pointerMap, 'intent');
  const claims = getDoc(pointerMap, 'knowledge.claims');
  const scenes = getDoc(pointerMap, 'orchestration.scenes');
  const evidence = getDoc(pointerMap, 'knowledge.evidence');

  if (intent && scenes) {
    const intentFile = getFile(pointerMap, 'intent');
    /** @type {Set<string>} */
    const goalIds = new Set();
    /** @type {Map<string, string>} */
    const goalPathById = new Map();
    (Array.isArray(intent.goals) ? intent.goals : []).forEach((g, idx) => {
      if (isRecord(g) && typeof g.id === 'string' && g.id.length > 0) {
        goalIds.add(g.id);
        goalPathById.set(g.id, `goals[${idx}]`);
      }
    });
    /** @type {Set<string>} */
    const covered = new Set();
    for (const sc of Array.isArray(scenes.scenes) ? scenes.scenes : []) {
      if (!isRecord(sc)) {
        continue;
      }
      for (const g of Array.isArray(sc.supports_goals) ? sc.supports_goals : []) {
        if (typeof g === 'string') {
          covered.add(g);
        }
      }
      const covers = isRecord(sc.covers) ? sc.covers : undefined;
      for (const g of Array.isArray(covers?.goals) ? covers.goals : []) {
        if (typeof g === 'string') {
          covered.add(g);
        }
      }
    }
    for (const g of goalIds) {
      if (!covered.has(g)) {
        findings.push({
          layer: 'gap',
          code: 'gap_uncovered_goal',
          severity: 'warning',
          file: intentFile,
          path: goalPathById.get(g) ?? 'goals',
          pointerLabel: 'intent',
          section: 'warnings',
          message: `Gap: goal ${g} is not covered by any scene`,
        });
      }
    }
  }

  if (claims) {
    const claimsFile = getFile(pointerMap, 'knowledge.claims');
    (Array.isArray(claims.claims) ? claims.claims : []).forEach((claim, idx) => {
      if (!isRecord(claim)) {
        return;
      }
      const evidenceRefs = claim.evidence_refs;
      if (claim.strength === 'strong' && (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0)) {
        findings.push({
          layer: 'gap',
          code: 'gap_strong_claim_no_evidence',
          severity: 'warning',
          file: claimsFile,
          path: `claims[${idx}].evidence_refs`,
          pointerLabel: 'knowledge.claims',
          section: 'warnings',
          message: `Gap: strong claim ${String(claim.id)} has no evidence_refs`,
        });
      }
    });
  }

  if (evidence) {
    const evidenceFile = getFile(pointerMap, 'knowledge.evidence');
    /** @type {Set<string>} */
    const referenced = new Set();
    for (const claim of Array.isArray(claims?.claims) ? claims.claims : []) {
      if (!isRecord(claim)) {
        continue;
      }
      for (const e of Array.isArray(claim.evidence_refs) ? claim.evidence_refs : []) {
        if (typeof e === 'string') {
          referenced.add(e);
        }
      }
    }
    (Array.isArray(evidence.evidence) ? evidence.evidence : []).forEach((item, idx) => {
      if (!isRecord(item) || typeof item.id !== 'string') {
        return;
      }
      if (!referenced.has(item.id)) {
        findings.push({
          layer: 'gap',
          code: 'gap_unreferenced_evidence',
          severity: 'warning',
          file: evidenceFile,
          path: `evidence[${idx}]`,
          pointerLabel: 'knowledge.evidence',
          section: 'warnings',
          message: `Gap: evidence ${item.id} is not referenced by any claim`,
        });
      }
    });
  }
}

/**
 * @param {any} source
 * @param {any} registry
 * @param {readonly any[]} schemaBackedPointers
 * @param {'strict' | 'compat'} mode
 */
function validateLoadedNarrative(source, registry, schemaBackedPointers, mode) {
  /** @type {any[]} */
  const schemaFindings = [];
  /** @type {any[]} */
  const otherFindings = [];
  let filesChecked = 1;

  const validateRoot = registry.getValidator(source.rootSchemaUrn);
  if (validateRoot && !validateRoot(source.root)) {
    for (const err of formatAjvErrors(validateRoot.errors)) {
      schemaFindings.push({
        layer: 'schema',
        code: 'schema_violation',
        severity: 'error',
        file: source.manifestFile,
        path: err.instancePath,
        pointerLabel: 'root',
        section: 'schema',
        message: `root: ${err.formatted}`,
      });
    }
  }

  for (const pointer of schemaBackedPointers) {
    if (pointer.status === 'omitted') {
      if (pointer.required) {
        schemaFindings.push({
          layer: 'schema',
          code: 'missing_required_pointer',
          severity: 'error',
          file: source.manifestFile,
          path: pointer.pointerPath,
          pointerLabel: pointer.label,
          section: 'schema',
          message: `Missing required file pointer: planes.${pointer.label}`,
        });
      }
      continue;
    }

    if (pointer.status === 'invalid_pointer') {
      if (pointer.required && pointer.declaredFile === '') {
        schemaFindings.push({
          layer: 'schema',
          code: 'missing_required_pointer',
          severity: 'error',
          file: source.manifestFile,
          path: pointer.pointerPath,
          pointerLabel: pointer.label,
          section: 'schema',
          message: `Missing required file pointer: planes.${pointer.label}`,
        });
      }
      continue;
    }

    if (pointer.status === 'missing') {
      schemaFindings.push({
        layer: 'schema',
        code: 'missing_model_file',
        severity: 'error',
        file: source.manifestFile,
        path: pointer.pointerPath,
        pointerLabel: pointer.label,
        section: 'schema',
        message: `Missing model file for ${pointer.label}: ${pointer.declaredFile ?? ''}`,
      });
      continue;
    }

    if (pointer.status !== 'loaded' || !pointer.schemaUrn) {
      continue;
    }

    filesChecked += 1;
    const validatePlane = registry.getValidator(pointer.schemaUrn);
    if (validatePlane && !validatePlane(pointer.content)) {
      for (const err of formatAjvErrors(validatePlane.errors)) {
        schemaFindings.push({
          layer: 'schema',
          code: 'schema_violation',
          severity: 'error',
          file: pointer.location.file,
          path: err.instancePath,
          pointerLabel: pointer.label,
          section: 'schema',
          message: `${pointer.label}: ${err.formatted}`,
        });
      }
    }
  }

  const validationSource = {
    ...source,
    pointers: [...schemaBackedPointers],
  };
  const occurrences = extractNarrativeOccurrences(validationSource);

  for (const duplicate of occurrences.duplicates) {
    if (!ID_RE.test(duplicate.id)) {
      continue;
    }
    const first = duplicate.occurrences[0];
    const locs = duplicate.occurrences.map(formatOccurrenceLocation);
    otherFindings.push({
      layer: 'duplicate',
      code: 'duplicate_id',
      severity: 'warning',
      file: first.location.file,
      path: first.location.path,
      pointerLabel: first.pointerLabel,
      section: 'warnings',
      message: `Potential duplicate ID '${duplicate.id}' in: ${locs.join(', ')}`,
    });
  }

  for (const ref of occurrences.unresolvedReferences) {
    if (!ID_RE.test(ref.targetId)) {
      continue;
    }
    if (!isCheckedRefField(ref.field)) {
      continue;
    }
    const formattedLoc = formatRefLocation(ref);
    otherFindings.push({
      layer: 'reference',
      code: 'missing_reference',
      severity: 'error',
      file: ref.location.file,
      path: ref.location.path,
      pointerLabel: ref.pointerLabel,
      section: 'cross',
      message: `Missing reference '${ref.targetId}' at ${formattedLoc}`,
    });
  }

  const pointerMap = getPointerMap(schemaBackedPointers);
  const scenesPointer = pointerMap.get('orchestration.scenes');
  collectStructureFindings(pointerMap, registry.getScenesSchema(scenesPointer?.schemaUrn), otherFindings);
  collectGraphFindings(pointerMap, otherFindings);
  collectVariantFindings(pointerMap, otherFindings);
  collectFilmFindings(pointerMap, schemaBackedPointers, otherFindings);
  collectPictureFindings(pointerMap, otherFindings);
  collectLinkFindings(pointerMap, otherFindings);
  collectGapFindings(pointerMap, otherFindings);

  /** @type {any[]} */
  const finalFindings = [];
  if (mode === 'compat' && schemaFindings.length > 0) {
    finalFindings.push(...otherFindings);
    for (const schemaErr of schemaFindings) {
      finalFindings.push({
        ...schemaErr,
        code: 'compat_schema_warning',
        severity: 'warning',
        section: 'warnings',
        message: `Compat schema warning: ${schemaErr.message}`,
      });
    }
    finalFindings.push({
      layer: 'schema',
      code: 'compat_mode_active',
      severity: 'warning',
      file: source.manifestFile,
      path: 'root',
      pointerLabel: 'root',
      section: 'warnings',
      message: 'Compat mode active: schema violations are non-fatal.',
    });
  } else {
    finalFindings.push(...schemaFindings, ...otherFindings);
  }

  const sections = {
    schema: finalFindings.filter((f) => f.section === 'schema').map((f) => f.message),
    cross: finalFindings.filter((f) => f.section === 'cross').map((f) => f.message),
    warnings: finalFindings.filter((f) => f.section === 'warnings').map((f) => f.message),
    info: finalFindings.filter((f) => f.section === 'info').map((f) => f.message),
  };

  const schemaErrorsCount = sections.schema.length;
  const crossErrorsCount = sections.cross.length;
  const totalErrors = schemaErrorsCount + crossErrorsCount;
  /** @type {0 | 1} */
  const exitCode = totalErrors > 0 ? 1 : 0;

  return {
    valid: exitCode === 0,
    exit_code: exitCode,
    mode,
    load_status: /** @type {const} */ ('loaded'),
    load_error: null,
    model_path: source.manifestPath,
    schemas_path: registry.suiteDir,
    findings: finalFindings,
    lens_findings: [],
    lenses: [],
    sections,
    summary: {
      errors: totalErrors,
      schema_errors: schemaErrorsCount,
      cross_errors: crossErrorsCount,
      warnings: sections.warnings.length,
      infos: sections.info.length,
      lens_findings: 0,
      files_checked: filesChecked,
    },
  };
}

/**
 * Validate an authored Narrative model directory or manifest against the Narrative schema suite.
 *
 * @param {{ modelPath: string, schemasPath: string, compat?: boolean }} options
 */
export function validateNarrative(options) {
  /** @type {'strict' | 'compat'} */
  const mode = options.compat ? 'compat' : 'strict';
  const loaded = loadValidationInputs(options.modelPath, options.schemasPath);

  if (loaded.status === 'load_error') {
    const loadFinding = {
      layer: 'load',
      code: loaded.loadError.code,
      severity: 'error',
      file: loaded.loadError.path,
      path: 'root',
      section: 'schema',
      message: loaded.loadError.message,
    };
    return {
      valid: false,
      exit_code: /** @type {const} */ (2),
      mode,
      load_status: /** @type {const} */ ('load_error'),
      load_error: loaded.loadError,
      model_path: loaded.attemptedModelPath,
      schemas_path: loaded.attemptedSchemasPath,
      findings: [loadFinding],
      lens_findings: [],
      lenses: [],
      sections: {
        schema: [],
        cross: [],
        warnings: [],
        info: [],
      },
      summary: {
        errors: 1,
        schema_errors: 0,
        cross_errors: 0,
        warnings: 0,
        infos: 0,
        lens_findings: 0,
        files_checked: 0,
      },
    };
  }

  return validateLoadedNarrative(
    loaded.source,
    loaded.registry,
    loaded.schemaBackedPointers,
    mode,
  );
}

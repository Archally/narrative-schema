// @ts-check
// Thin adapter projecting a built Narrative authored-graph model into
// @archally/semantic-checker's CheckableModel IR, including scoped internal subjects
// for multi-finding custom rules while preserving authored counts and provenance mapping.

export const NARRATIVE_CHECKER_PLANES = Object.freeze([
  'root',
  'intent',
  'knowledge',
  'orchestration',
  'delivery',
  'assurance',
]);

export const INTERNAL_SUBSTITUTION_SUBJECT_TYPE = '__narrative_asset_substitution_ref';
export const INTERNAL_TIMEBOX_SUBJECT_TYPE = '__narrative_timebox_check';

const SUBSTITUTION_FIELDS = /** @type {const} */ (['replace_ref', 'with_ref']);
const TIMEBOX_SLOTS = /** @type {const} */ ([
  { slot: 'min-target', suffix: '.timebox.min' },
  { slot: 'target-max', suffix: '.timebox.max' },
  { slot: 'min-max', suffix: '.timebox' },
]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function asNonEmptyString(value) {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

/**
 * @template T
 * @param {readonly T[]} items
 * @param {(item: T) => string} keyOf
 * @returns {Record<string, number>}
 */
function countBy(items, keyOf) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/**
 * Project a built Narrative model into a CheckableModel plus lookup maps that translate
 * internal custom-rule subject keys back to authored entity IDs, files, YAML paths, and targets.
 *
 * @param {any} builtModel
 */
export function toNarrativeCheckableModel(builtModel) {
  const authoredEntities = Array.isArray(builtModel?.entities) ? builtModel.entities : [];
  const authoredRelations = Array.isArray(builtModel?.relations) ? builtModel.relations : [];

  /** @type {Map<string, any>} */
  const authoredById = new Map();
  /** @type {Map<string, { entityId: string, file?: string, path?: string, targetId?: string }>} */
  const subjectMap = new Map();

  /** @type {any[]} */
  const entities = [];

  for (const entity of authoredEntities) {
    authoredById.set(entity.id, entity);
    entities.push({
      id: entity.id,
      displayId: entity.id,
      name: entity.name,
      type: entity.type,
      plane: entity.plane,
      slices: [],
      fileOrigin: entity.location?.file,
      data: isRecord(entity.data) ? entity.data : {},
    });
  }

  // Project one internal subject per variant asset_substitutions field candidate so engine v0.1.1
  // can emit distinct findings with exact YAML paths and target IDs for multiple bad fields.
  for (const entity of authoredEntities) {
    if (entity.type !== 'variant') {
      continue;
    }
    const substitutions = entity.data?.asset_substitutions;
    if (!Array.isArray(substitutions)) {
      continue;
    }
    substitutions.forEach((rawSub, subIdx) => {
      if (!isRecord(rawSub)) {
        return;
      }
      for (const field of SUBSTITUTION_FIELDS) {
        const subjectId = `${INTERNAL_SUBSTITUTION_SUBJECT_TYPE}::${entity.id}::${subIdx}::${field}`;
        const yamlPath = entity.location?.path
          ? `${entity.location.path}.asset_substitutions[${subIdx}].${field}`
          : `asset_substitutions[${subIdx}].${field}`;
        const refId = asNonEmptyString(rawSub[field]);
        subjectMap.set(subjectId, {
          entityId: entity.id,
          ...(entity.location?.file !== undefined ? { file: entity.location.file } : {}),
          path: yamlPath,
          ...(refId !== undefined ? { targetId: refId } : {}),
        });
        entities.push({
          id: subjectId,
          displayId: subjectId,
          name: entity.name,
          type: INTERNAL_SUBSTITUTION_SUBJECT_TYPE,
          slices: [],
          fileOrigin: entity.location?.file,
          data: {
            __narrativeInternal: true,
            variantId: entity.id,
            subIdx,
            field,
            refValue: rawSub[field],
          },
        });
      }
    });
  }

  // Project three internal check slots per scene timebox so both target-anchored findings
  // (`min > target` and `target > max`) and the `min > max` fallback evaluate independently in the extension.
  for (const entity of authoredEntities) {
    if (entity.type !== 'scene') {
      continue;
    }
    const timebox = entity.data?.timebox;
    if (!isRecord(timebox)) {
      continue;
    }
    for (const entry of TIMEBOX_SLOTS) {
      const subjectId = `${INTERNAL_TIMEBOX_SUBJECT_TYPE}::${entity.id}::${entry.slot}`;
      const yamlPath = entity.location?.path
        ? `${entity.location.path}${entry.suffix}`
        : entry.suffix.slice(1);
      subjectMap.set(subjectId, {
        entityId: entity.id,
        ...(entity.location?.file !== undefined ? { file: entity.location.file } : {}),
        path: yamlPath,
      });
      entities.push({
        id: subjectId,
        displayId: subjectId,
        name: entity.name,
        type: INTERNAL_TIMEBOX_SUBJECT_TYPE,
        slices: [],
        fileOrigin: entity.location?.file,
        data: {
          __narrativeInternal: true,
          sceneId: entity.id,
          slot: entry.slot,
          timebox,
        },
      });
    }
  }

  const relations = authoredRelations.map((relation) => ({
    id: relation.id,
    source: relation.source,
    target: relation.target,
    type: relation.type,
    predicate: relation.predicate,
  }));

  /** @type {Record<string, number>} */
  const entityOccurrenceCounts = isRecord(builtModel?.occurrences?.byIdCount)
    ? { ...builtModel.occurrences.byIdCount }
    : countBy(authoredEntities, (entity) => entity.id);

  const checkableModel = {
    schema: 'narrative',
    schemaVersion: builtModel?.metadata?.schemaVersion ?? '1.0',
    structure: {
      planes: NARRATIVE_CHECKER_PLANES.map((id) => ({ id })),
      layers: [],
      slices: [],
    },
    entities,
    relations,
    metadata: {
      name: builtModel?.metadata?.name ?? builtModel?.metadata?.id ?? null,
      version: builtModel?.metadata?.version ?? null,
      schemaVersion: builtModel?.metadata?.schemaVersion ?? '1.0',
      entityTypeCounts: builtModel?.metadata?.entityTypeCounts ?? countBy(authoredEntities, (e) => e.type),
      planeCounts: builtModel?.metadata?.planeCounts ?? countBy(authoredEntities, (e) => e.plane),
      relationTypeCounts: builtModel?.metadata?.relationTypeCounts ?? countBy(authoredRelations, (r) => r.type),
      entityOccurrenceCounts,
    },
  };

  return {
    checkableModel,
    authoredById,
    subjectMap,
    authoredEntityCount: authoredEntities.length,
    authoredRelationCount: authoredRelations.length,
  };
}

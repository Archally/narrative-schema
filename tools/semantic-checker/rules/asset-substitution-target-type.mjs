// @ts-check
// Custom extension for `asset-substitution-target-type`.
// Evaluates one projected variant substitution field candidate (`replace_ref` or `with_ref`).
// Suppresses missing or ambiguous target IDs (owned by baseline validation) and flags any
// uniquely resolved non-asset target.

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
 * Resolve how many authored entity definitions exist for `refId`.
 * Uses `model.metadata.entityOccurrenceCounts` when available so duplicate definitions
 * collapsed into one CheckableEntity are still detected as ambiguous.
 *
 * @param {any} model
 * @param {string} refId
 * @returns {number}
 */
function getOccurrenceCount(model, refId) {
  const counts = model?.metadata?.entityOccurrenceCounts;
  if (counts && typeof counts === 'object' && !Array.isArray(counts)) {
    const count = counts[refId];
    if (typeof count === 'number') {
      return count;
    }
    return 0;
  }
  let matches = 0;
  for (const entity of model?.entities ?? []) {
    if (entity.data?.__narrativeInternal === true) {
      continue;
    }
    if (entity.id === refId) {
      matches += 1;
    }
  }
  return matches;
}

/**
 * @param {any} model
 * @param {any} subject
 * @returns {{ ok: boolean, message?: string }}
 */
export default function checkAssetSubstitutionTargetType(model, subject) {
  if (!subject || !subject.data) {
    return { ok: true };
  }

  const variantId = asNonEmptyString(subject.data.variantId);
  const field = asNonEmptyString(subject.data.field);
  const refId = asNonEmptyString(subject.data.refValue);
  if (!variantId || !field || !refId) {
    return { ok: true };
  }

  // Suppress missing or ambiguous IDs (owned by baseline validation).
  const occurrenceCount = getOccurrenceCount(model, refId);
  if (occurrenceCount !== 1) {
    return { ok: true };
  }

  const target = (model.entities ?? []).find(
    (entity) => entity.data?.__narrativeInternal !== true && entity.id === refId,
  );
  if (!target || target.type === 'asset') {
    return { ok: true };
  }

  return {
    ok: false,
    message: `Variant ${variantId} ${field} '${refId}' resolves to ${target.type}, expected asset.`,
  };
}

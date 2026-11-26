// @ts-check
// Custom extension for `unused-scene-in-variants`.
// Flags an authored scene when at least one variant declares explicit `scene_selection.scene_ids`
// and the scene is not included in the union of those selections.

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
 * @param {any} model
 * @param {any} subject
 * @returns {{ ok: boolean, message?: string }}
 */
export default function checkUnusedSceneInVariants(model, subject) {
  if (!subject || subject.type !== 'scene') {
    return { ok: true };
  }

  /** @type {Set<string>} */
  const selectedSceneIds = new Set();
  let hasExplicitSelection = false;

  for (const entity of model.entities ?? []) {
    if (entity.type !== 'variant') {
      continue;
    }
    const selection = entity.data?.scene_selection;
    if (!isRecord(selection)) {
      continue;
    }
    const sceneIds = selection.scene_ids;
    if (!Array.isArray(sceneIds) || sceneIds.length === 0) {
      continue;
    }
    hasExplicitSelection = true;
    for (const rawId of sceneIds) {
      const id = asNonEmptyString(rawId);
      if (id) {
        selectedSceneIds.add(id);
      }
    }
  }

  if (!hasExplicitSelection) {
    return { ok: true };
  }

  if (selectedSceneIds.has(subject.id)) {
    return { ok: true };
  }

  return {
    ok: false,
    message: `Scene ${subject.id} (${subject.name ?? subject.id}) is not included in any variant's explicit scene_selection.scene_ids.`,
  };
}

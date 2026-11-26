// @ts-check
// Custom extension for `timebox-ordering`.
// Evaluates one projected scene timebox check slot (`min-target`, `target-max`, or `min-max`),
// preserving zero and fractional values and suppressing the `min-max` fallback whenever either
// target-anchored pair produces a finding on the same scene.

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {any} _model
 * @param {any} subject
 * @returns {{ ok: boolean, message?: string }}
 */
export default function checkTimeboxOrdering(_model, subject) {
  if (!subject || !subject.data) {
    return { ok: true };
  }

  const sceneId = typeof subject.data.sceneId === 'string' ? subject.data.sceneId : '';
  const slot = typeof subject.data.slot === 'string' ? subject.data.slot : '';
  const timebox = subject.data.timebox;
  if (!sceneId || !slot || !timebox || typeof timebox !== 'object' || Array.isArray(timebox)) {
    return { ok: true };
  }

  const min = timebox.min;
  const target = timebox.target;
  const max = timebox.max;

  const hasMin = isFiniteNumber(min);
  const hasTarget = isFiniteNumber(target);
  const hasMax = isFiniteNumber(max);

  if (slot === 'min-target') {
    if (hasMin && hasTarget && min > target) {
      return {
        ok: false,
        message: `Scene ${sceneId} timebox.min (${min}) exceeds timebox.target (${target}).`,
      };
    }
    return { ok: true };
  }

  if (slot === 'target-max') {
    if (hasTarget && hasMax && target > max) {
      return {
        ok: false,
        message: `Scene ${sceneId} timebox.max (${max}) is less than timebox.target (${target}).`,
      };
    }
    return { ok: true };
  }

  if (slot === 'min-max') {
    const reportedPair = (hasMin && hasTarget && min > target) || (hasTarget && hasMax && target > max);
    if (!reportedPair && hasMin && hasMax && min > max) {
      return {
        ok: false,
        message: `Scene ${sceneId} timebox.min (${min}) exceeds timebox.max (${max}).`,
      };
    }
    return { ok: true };
  }

  return { ok: true };
}

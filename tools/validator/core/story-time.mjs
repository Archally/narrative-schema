const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const rows = (value) => Array.isArray(value) ? value : [];
const owns = (record, field) => isRecord(record) && Object.hasOwn(record, field);

export const storyTimeFields = ['before', 'overlaps', 'recounts_events'];

const conditionalPathsByResource = new Map([
  ['urn:narrative:scenes:1.0.0', new Set(['#/if'])],
  ['urn:narrative:scenes:1.1.0', new Set(['#/if'])],
  ['urn:narrative:intent:1.0.0', new Set(['#/properties/constraints/if'])],
  ['urn:narrative:storyworld:1.0.0',
    new Set([0, 1, 2, 3, 4].map((index) => `#/$defs/object_effect/allOf/${index}/if`))],
]);

export function suppressConditionalWrapper(error, resource) {
  // Ajv can report a referenced graph conditional as #/if as well.
  if (error.schemaPath === '#/if' && error.instancePath !== '') return false;
  const branch = error.params?.failingKeyword;
  return error.keyword === 'if' && (branch === 'then' || branch === 'else') &&
    conditionalPathsByResource.get(resource)?.has(error.schemaPath) === true;
}

export function storyPrecedence(events, resolve = (target) => target) {
  const indexes = new Map();
  events.forEach((event, index) => {
    if (isRecord(event) && typeof event.id === 'string' && !indexes.has(event.id)) indexes.set(event.id, index);
  });
  const edges = new Map([...indexes.keys()].map((id) => [id, new Map()]));
  function add(from, to, kind) {
    if (!indexes.has(from) || !indexes.has(to)) return;
    const outgoing = edges.get(from);
    outgoing.set(to, (outgoing.get(to) ?? 0) | kind);
  }
  events.forEach((event, index) => {
    if (!isRecord(event) || indexes.get(event.id) !== index) return;
    for (const field of ['before', 'recounts_events', 'requires_events']) {
      rows(event[field]).forEach((target, targetIndex) => {
        const id = resolve(target, `story_events[${index}].${field}[${targetIndex}]`, field);
        if (!id || id === event.id) return;
        add(field === 'before' ? event.id : id, field === 'before' ? id : event.id, field === 'requires_events' ? 1 : 2);
      });
    }
  });
  const reach = new Map();
  function precedes(from, to) {
    if (!edges.has(from)) return false;
    if (!reach.has(from)) {
      const reachable = new Set();
      const pending = [...edges.get(from).keys()];
      while (pending.length) {
        const target = pending.pop();
        if (reachable.has(target)) continue;
        reachable.add(target);
        for (const next of edges.get(target).keys()) pending.push(next);
      }
      reach.set(from, reachable);
    }
    return reach.get(from).has(to);
  }
  return { indexes, edges, precedes };
}

function reportCycles({ edges, indexes, precedes }, issue) {
  const reported = new Set();
  for (const [from, outgoing] of edges) {
    for (const [to, kind] of outgoing) {
      if (!(kind & 2) || !precedes(to, from)) continue;
      const path = [from, to];
      const visited = new Set(path);
      function walk(current) {
        for (const next of edges.get(current).keys()) {
          if (next === from) {
            const requiresOnly = path.every((id, index) =>
              edges.get(id).get(path[(index + 1) % path.length]) & 1);
            if (requiresOnly) continue;
            const first = path.indexOf([...path].sort()[0]);
            const cycle = [...path.slice(first), ...path.slice(0, first)];
            const key = cycle.join(' -> ');
            if (reported.has(key)) continue;
            reported.add(key);
            issue('storyworld_story_time_cycle', `story_events[${indexes.get(cycle[0])}]`,
              `story time cycle ${key} -> ${cycle[0]}`);
            continue;
          }
          if (visited.has(next) || !precedes(next, from)) continue;
          visited.add(next);
          path.push(next);
          walk(next);
          path.pop();
          visited.delete(next);
        }
      }
      walk(to);
    }
  }
}

function exclusivePositions(first, second, transitions) {
  const a = rows(first.on_transitions);
  const b = rows(second.on_transitions);
  if (!a.length || !b.length || a.some((id) => b.includes(id))) return false;
  const combined = [...a, ...b].map((id) => transitions.get(id));
  const scene = second.occurs_in;
  return combined.every((transition) => transition?.from === scene) ||
    combined.every((transition) => transition?.to === scene && transition.from !== scene);
}

export function checkStoryTime(doc, transitions, checkRef, issue) {
  rows(doc.characters).forEach((character, characterIndex) => {
    rows(character?.appearances).forEach((appearance, appearanceIndex) => {
      const sequence = appearance?.presence_sequence;
      if (!Array.isArray(sequence) || sequence.length < 2) return;
      const summary = ['on_screen', 'heard', 'mentioned'].find((presence) => sequence.includes(presence));
      if (summary && summary !== appearance.presence) {
        issue('storyworld_presence_summary_mismatch', `characters[${characterIndex}].appearances[${appearanceIndex}].presence`,
          `presence sequence summarizes to ${summary}`);
      }
    });
  });
  const ids = new Set();
  rows(doc.story_objects).forEach((object, index) => {
    if (!isRecord(object)) return;
    const path = `story_objects[${index}]`;
    if (typeof object.id === 'string') {
      if (ids.has(object.id)) {
        issue('storyworld_duplicate_object_id', `${path}.id`, `duplicate story object id '${object.id}'`);
      }
      ids.add(object.id);
    }
    checkRef(object.initial_holder, 'character', `${path}.initial_holder`);
  });

  const events = rows(doc.story_events);
  const resolvedTargets = new Map();
  events.forEach((event, index) => {
    for (const field of storyTimeFields) {
      rows(event?.[field]).forEach((target, targetIndex) => {
        const path = `story_events[${index}].${field}[${targetIndex}]`;
        resolvedTargets.set(path, checkRef(target, 'story_event', path));
      });
    }
  });
  const precedence = resolvedTargets.size > 0 ? storyPrecedence(events, (target, path, field) =>
    field === 'requires_events' ? target : resolvedTargets.get(path)) : undefined;
  if (precedence) reportCycles(precedence, issue);

  const positioned = new Map();
  events.forEach((event, index) => {
    if (!isRecord(event)) return;
    const path = `story_events[${index}]`;
    for (const field of storyTimeFields) {
      rows(event[field]).forEach((target, targetIndex) => {
        const targetPath = `${path}.${field}[${targetIndex}]`;
        const resolved = resolvedTargets.get(targetPath);
        if (typeof target === 'string' && target === event.id) {
          issue('storyworld_story_time_self_reference', targetPath, `${event.id} names itself in ${field}`);
        } else if (field === 'overlaps' && resolved &&
            (precedence.precedes(event.id, resolved) || precedence.precedes(resolved, event.id))) {
          issue('storyworld_story_time_conflict', targetPath, `${event.id} and ${resolved} overlap but are ordered in story time`);
        }
      });
    }
    rows(event.object_effects).forEach((effect, effectIndex) => {
      if (!isRecord(effect)) return;
      const effectPath = `${path}.object_effects[${effectIndex}]`;
      checkRef(effect.object, 'story_object', `${effectPath}.object`);
      for (const participant of ['from', 'to', 'by']) {
        checkRef(effect[participant], 'character', `${effectPath}.${participant}`);
      }
      if (effect.action === 'transfer' && typeof effect.from === 'string' && effect.from === effect.to) {
        issue('storyworld_object_effect_same_holder', effectPath, `transfer names ${effect.from} as both holders`);
      }
    });
    if (!Number.isInteger(event.telling_position) || event.telling_position < 1 || typeof event.occurs_in !== 'string') return;
    const key = `${event.occurs_in}:${event.telling_position}`;
    const earlier = positioned.get(key) ?? [];
    if (earlier.some((other) => !exclusivePositions(other, event, transitions))) {
      issue('storyworld_telling_position_collision', `${path}.telling_position`,
        `position ${event.telling_position} is shared by events in ${event.occurs_in}`);
    }
    earlier.push(event);
    positioned.set(key, earlier);
  });
}

export function isUntimed(scenes) {
  return owns(scenes, 'timing') && scenes.timing === 'untimed';
}

export function checkOutlineTiming(scenes, intent, variants, issue) {
  const constraints = isRecord(intent?.constraints) ? intent.constraints : undefined;
  if (!isUntimed(scenes)) {
    if (scenes && constraints?.format === 'reading_outline' && !owns(constraints, 'duration_minutes')) {
      issue('timing_reading_outline_requires_duration', 'intent', 'constraints', 'Timed reading outlines require an intent duration');
    }
    return;
  }
  if (!intent) return;
  if (constraints?.format !== 'reading_outline') {
    issue('timing_untimed_requires_reading_outline', 'orchestration.scenes', 'timing', 'Untimed scenes require the reading_outline format');
  }
  if (owns(constraints, 'duration_minutes')) {
    issue('timing_untimed_intent_duration', 'intent', 'constraints.duration_minutes', 'Untimed reading outlines cannot declare an intent duration');
  }
  rows(variants?.variants).forEach((variant, index) => {
    if (!isRecord(variant)) return;
    const path = `variants[${index}]`;
    for (const [property, code, message] of [
      ['duration_minutes', 'timing_untimed_variant_budget', 'a duration'],
      ['film', 'timing_untimed_variant_film', 'film settings'],
    ]) {
      if (owns(variant, property)) {
        issue(code, 'delivery.variants', `${path}.${property}`, `Untimed variants cannot declare ${message}`);
      }
    }
    if (isRecord(variant.scene_selection) && owns(variant.scene_selection, 'overrides')) {
      issue('timing_untimed_variant_override', 'delivery.variants', `${path}.scene_selection.overrides`, 'Untimed variants cannot declare scene overrides');
    }
  });
}

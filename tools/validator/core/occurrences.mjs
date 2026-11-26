// @ts-check
// Pure occurrence extraction for Narrative authored sources.
// Extracts schema-defined authored entities, typed local references, duplicate definitions,
// and external model links with exact file and YAML path provenance.

/** @type {readonly (readonly [string, string])[]} */
const REFS_CATEGORY_RELATION = [
  ['goals', 'references_goal'],
  ['concepts', 'references_concept'],
  ['claims', 'references_claim'],
  ['evidence', 'references_evidence'],
  ['assets', 'references_asset'],
  ['scenes', 'references_scene'],
  ['questions', 'references_question'],
];

/** @type {readonly (readonly [string, string])[]} */
const COVERS_CATEGORY_RELATION = [
  ['goals', 'covers_goal'],
  ['concepts', 'covers_concept'],
  ['claims', 'covers_claim'],
  ['evidence', 'covers_evidence'],
  ['assets', 'covers_asset'],
  ['scenes', 'covers_scene'],
  ['questions', 'covers_question'],
];

/** @type {readonly (readonly [string, string])[]} */
const SCRIPT_REFS_CATEGORY_RELATION = [
  ['concepts', 'script_references_concept'],
  ['claims', 'script_references_claim'],
  ['evidence', 'script_references_evidence'],
  ['assets', 'script_references_asset'],
  ['questions', 'script_references_question'],
];

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
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * @param {any} collector
 * @param {any} params
 */
function addEntity(collector, params) {
  collector.entityOccurrences.push({
    ...params,
    occurrenceId: `${params.id}@${params.location.file}#${params.location.path}`,
  });
}

/**
 * @param {any} collector
 * @param {string | null} sourceId
 * @param {unknown} targetId
 * @param {string} relationType
 * @param {string} field
 * @param {string} plane
 * @param {string} pointerLabel
 * @param {string} file
 * @param {string} yamlPath
 * @param {string} [language]
 */
function addRef(collector, sourceId, targetId, relationType, field, plane, pointerLabel, file, yamlPath, language) {
  const target = asNonEmptyString(targetId);
  if (!target) {
    return;
  }
  collector.rawReferences.push({
    sourceId,
    targetId: target,
    relationType,
    field,
    plane,
    pointerLabel,
    ...(language !== undefined ? { language } : {}),
    location: { file, path: yamlPath },
  });
}

/**
 * @param {any} collector
 * @param {string | null} sourceId
 * @param {unknown} values
 * @param {string} relationType
 * @param {string} field
 * @param {string} plane
 * @param {string} pointerLabel
 * @param {string} file
 * @param {string} yamlPath
 * @param {string} [language]
 */
function addRefArray(collector, sourceId, values, relationType, field, plane, pointerLabel, file, yamlPath, language) {
  const list = asArray(values);
  list.forEach((item, index) => {
    addRef(
      collector,
      sourceId,
      item,
      relationType,
      field,
      plane,
      pointerLabel,
      file,
      `${yamlPath}[${index}]`,
      language,
    );
  });
}

/**
 * @param {any} collector
 * @param {string | null} sourceId
 * @param {unknown} obj
 * @param {readonly (readonly [string, string])[]} mapping
 * @param {string} plane
 * @param {string} pointerLabel
 * @param {string} file
 * @param {string} yamlPath
 * @param {string} [language]
 */
function addRefObject(collector, sourceId, obj, mapping, plane, pointerLabel, file, yamlPath, language) {
  if (!isRecord(obj)) {
    return;
  }
  for (const [key, relationType] of mapping) {
    addRefArray(
      collector,
      sourceId,
      obj[key],
      relationType,
      key,
      plane,
      pointerLabel,
      file,
      `${yamlPath}.${key}`,
      language,
    );
  }
}

/**
 * @param {any} collector
 * @param {string} ownerId
 * @param {string} ownerType
 * @param {string} field
 * @param {string} plane
 * @param {string} pointerLabel
 * @param {string} file
 * @param {string} yamlPath
 * @param {unknown} values
 */
function addExternalLinks(collector, ownerId, ownerType, field, plane, pointerLabel, file, yamlPath, values) {
  asArray(values).forEach((item, index) => {
    if (!isRecord(item)) {
      return;
    }
    collector.externalLinks.push({
      ownerId,
      ownerType,
      field,
      plane,
      pointerLabel,
      link: { ...item },
      location: { file, path: `${yamlPath}[${index}]` },
    });
  });
}

/**
 * @param {any} collector
 * @param {string} ownerId
 * @param {unknown} anchor
 * @param {string} plane
 * @param {string} pointerLabel
 * @param {string} file
 * @param {string} yamlPath
 */
function addAudioAnchorRefs(collector, ownerId, anchor, plane, pointerLabel, file, yamlPath) {
  if (!isRecord(anchor)) {
    return;
  }
  addRef(collector, ownerId, anchor.shot_ref, 'anchored_to_shot', 'shot_ref', plane, pointerLabel, file, `${yamlPath}.shot_ref`);
  addRef(collector, ownerId, anchor.line_ref, 'anchored_to_line', 'line_ref', plane, pointerLabel, file, `${yamlPath}.line_ref`);
  const visualEvent = anchor.visual_event;
  if (isRecord(visualEvent)) {
    addRef(
      collector,
      ownerId,
      visualEvent.shot_ref,
      'anchored_to_shot',
      'shot_ref',
      plane,
      pointerLabel,
      file,
      `${yamlPath}.visual_event.shot_ref`,
    );
  }
}

/**
 * @param {any} collector
 * @param {any} pointer
 */
function extractIntent(collector, pointer) {
  if (!isRecord(pointer.content)) {
    return;
  }
  const file = pointer.location.file;
  asArray(pointer.content.goals).forEach((rawGoal, index) => {
    if (!isRecord(rawGoal)) {
      return;
    }
    const id = asNonEmptyString(rawGoal.id);
    if (!id) {
      return;
    }
    const basePath = `goals[${index}]`;
    addEntity(collector, {
      id,
      entityType: 'goal',
      plane: 'intent',
      pointerLabel: pointer.label,
      name: asNonEmptyString(rawGoal.statement) ?? id,
      location: { file, path: basePath },
      data: rawGoal,
    });
    addExternalLinks(
      collector,
      id,
      'goal',
      'external_goals',
      'intent',
      pointer.label,
      file,
      `${basePath}.external_goals`,
      rawGoal.external_goals,
    );
  });
}

/**
 * @param {any} collector
 * @param {any} pointer
 */
function extractConcepts(collector, pointer) {
  if (!isRecord(pointer.content)) {
    return;
  }
  const file = pointer.location.file;
  asArray(pointer.content.concepts).forEach((rawConcept, index) => {
    if (!isRecord(rawConcept)) {
      return;
    }
    const id = asNonEmptyString(rawConcept.id);
    if (!id) {
      return;
    }
    const basePath = `concepts[${index}]`;
    addEntity(collector, {
      id,
      entityType: 'concept',
      plane: 'knowledge',
      pointerLabel: pointer.label,
      name: asNonEmptyString(rawConcept.term) ?? id,
      location: { file, path: basePath },
      data: rawConcept,
    });
    addRefArray(collector, id, rawConcept.prerequisites, 'requires_concept', 'prerequisites', 'knowledge', pointer.label, file, `${basePath}.prerequisites`);
    addRefArray(collector, id, rawConcept.used_in_claims, 'used_in_claim', 'used_in_claims', 'knowledge', pointer.label, file, `${basePath}.used_in_claims`);
    addRefArray(collector, id, rawConcept.taught_in_scenes, 'taught_in_scene', 'taught_in_scenes', 'knowledge', pointer.label, file, `${basePath}.taught_in_scenes`);
    addRefArray(collector, id, rawConcept.illustrated_by_assets, 'illustrated_by_asset', 'illustrated_by_assets', 'knowledge', pointer.label, file, `${basePath}.illustrated_by_assets`);
    addRefArray(collector, id, rawConcept.anticipated_questions, 'has_anticipated_question', 'anticipated_questions', 'knowledge', pointer.label, file, `${basePath}.anticipated_questions`);
    addExternalLinks(
      collector,
      id,
      'concept',
      'external_concepts',
      'knowledge',
      pointer.label,
      file,
      `${basePath}.external_concepts`,
      rawConcept.external_concepts,
    );
  });
}

/**
 * @param {any} collector
 * @param {any} pointer
 */
function extractClaims(collector, pointer) {
  if (!isRecord(pointer.content)) {
    return;
  }
  const file = pointer.location.file;
  asArray(pointer.content.claims).forEach((rawClaim, index) => {
    if (!isRecord(rawClaim)) {
      return;
    }
    const id = asNonEmptyString(rawClaim.id);
    if (!id) {
      return;
    }
    const basePath = `claims[${index}]`;
    addEntity(collector, {
      id,
      entityType: 'claim',
      plane: 'knowledge',
      pointerLabel: pointer.label,
      name: asNonEmptyString(rawClaim.title) ?? id,
      location: { file, path: basePath },
      data: rawClaim,
    });
    addRefArray(collector, id, rawClaim.supports_goals, 'supports_goal', 'supports_goals', 'knowledge', pointer.label, file, `${basePath}.supports_goals`);
    addRefArray(collector, id, rawClaim.depends_on_claims, 'depends_on_claim', 'depends_on_claims', 'knowledge', pointer.label, file, `${basePath}.depends_on_claims`);
    addRefArray(collector, id, rawClaim.key_terms, 'uses_concept', 'key_terms', 'knowledge', pointer.label, file, `${basePath}.key_terms`);
    addRefArray(collector, id, rawClaim.evidence_refs, 'backed_by_evidence', 'evidence_refs', 'knowledge', pointer.label, file, `${basePath}.evidence_refs`);
    addRefArray(collector, id, rawClaim.asset_refs, 'illustrated_by_asset', 'asset_refs', 'knowledge', pointer.label, file, `${basePath}.asset_refs`);
    addRefArray(collector, id, rawClaim.scene_refs, 'covered_in_scene', 'scene_refs', 'knowledge', pointer.label, file, `${basePath}.scene_refs`);
    addRefArray(collector, id, rawClaim.question_refs, 'challenged_by_question', 'question_refs', 'knowledge', pointer.label, file, `${basePath}.question_refs`);
  });
}

/**
 * @param {any} collector
 * @param {any} pointer
 */
function extractEvidence(collector, pointer) {
  if (!isRecord(pointer.content)) {
    return;
  }
  const file = pointer.location.file;
  asArray(pointer.content.evidence).forEach((rawItem, index) => {
    if (!isRecord(rawItem)) {
      return;
    }
    const id = asNonEmptyString(rawItem.id);
    if (!id) {
      return;
    }
    const basePath = `evidence[${index}]`;
    addEntity(collector, {
      id,
      entityType: 'evidence',
      plane: 'knowledge',
      pointerLabel: pointer.label,
      name: asNonEmptyString(rawItem.title) ?? id,
      location: { file, path: basePath },
      data: rawItem,
    });
    addRefArray(collector, id, rawItem.backs_claims, 'backs_claim', 'backs_claims', 'knowledge', pointer.label, file, `${basePath}.backs_claims`);
    addRefArray(collector, id, rawItem.supports_concepts, 'supports_concept', 'supports_concepts', 'knowledge', pointer.label, file, `${basePath}.supports_concepts`);
    addRefArray(collector, id, rawItem.used_in_scenes, 'used_in_scene', 'used_in_scenes', 'knowledge', pointer.label, file, `${basePath}.used_in_scenes`);
  });
}

/**
 * @param {any} collector
 * @param {any} pointer
 */
function extractAssets(collector, pointer) {
  if (!isRecord(pointer.content)) {
    return;
  }
  const file = pointer.location.file;
  asArray(pointer.content.assets).forEach((rawAsset, index) => {
    if (!isRecord(rawAsset)) {
      return;
    }
    const id = asNonEmptyString(rawAsset.id);
    if (!id) {
      return;
    }
    const basePath = `assets[${index}]`;
    addEntity(collector, {
      id,
      entityType: 'asset',
      plane: 'knowledge',
      pointerLabel: pointer.label,
      name: asNonEmptyString(rawAsset.title) ?? id,
      location: { file, path: basePath },
      data: rawAsset,
    });
    const illustrates = rawAsset.illustrates;
    if (isRecord(illustrates)) {
      addRefArray(collector, id, illustrates.concepts, 'illustrates_concept', 'concepts', 'knowledge', pointer.label, file, `${basePath}.illustrates.concepts`);
      addRefArray(collector, id, illustrates.claims, 'illustrates_claim', 'claims', 'knowledge', pointer.label, file, `${basePath}.illustrates.claims`);
    }
    const placement = rawAsset.suggested_placement;
    if (isRecord(placement)) {
      addRefArray(collector, id, placement.preferred_scene_ids, 'prefers_scene', 'preferred_scene_ids', 'knowledge', pointer.label, file, `${basePath}.suggested_placement.preferred_scene_ids`);
    }
    addRefArray(collector, id, rawAsset.used_in_scenes, 'used_in_scene', 'used_in_scenes', 'knowledge', pointer.label, file, `${basePath}.used_in_scenes`);
    addRefArray(collector, id, rawAsset.supports_goals, 'supports_goal', 'supports_goals', 'knowledge', pointer.label, file, `${basePath}.supports_goals`);

    // Picture subjects' model_ref points to another model, never a local narrative entity.
    const media = rawAsset.media;
    const shows = isRecord(media) ? media.shows : undefined;
    if (isRecord(shows)) {
      const defaultProject = asNonEmptyString(shows.project);
      asArray(shows.subjects).forEach((rawSubject, subjectIdx) => {
        if (!isRecord(rawSubject)) {
          return;
        }
        const modelRef = rawSubject.model_ref;
        if (!isRecord(modelRef)) {
          return;
        }
        collector.externalLinks.push({
          ownerId: id,
          ownerType: 'asset',
          field: 'media.shows.subjects.model_ref',
          plane: 'knowledge',
          pointerLabel: pointer.label,
          link: {
            ...(defaultProject !== undefined ? { project: defaultProject } : {}),
            ...modelRef,
          },
          location: { file, path: `${basePath}.media.shows.subjects[${subjectIdx}].model_ref` },
        });
      });
    }
  });
}

/**
 * @param {any} collector
 * @param {any} pointer
 */
function extractScenes(collector, pointer) {
  if (!isRecord(pointer.content)) {
    return;
  }
  const file = pointer.location.file;
  asArray(pointer.content.scenes).forEach((rawScene, index) => {
    if (!isRecord(rawScene)) {
      return;
    }
    const id = asNonEmptyString(rawScene.id);
    if (!id) {
      return;
    }
    const basePath = `scenes[${index}]`;
    addEntity(collector, {
      id,
      entityType: 'scene',
      plane: 'orchestration',
      pointerLabel: pointer.label,
      name: asNonEmptyString(rawScene.title) ?? id,
      location: { file, path: basePath },
      data: rawScene,
    });
    addRefArray(collector, id, rawScene.pays_off, 'pays_off', 'pays_off', 'orchestration', pointer.label, file, `${basePath}.pays_off`);
    addRefArray(collector, id, rawScene.supports_goals, 'supports_goal', 'supports_goals', 'orchestration', pointer.label, file, `${basePath}.supports_goals`);
    addRefArray(collector, id, rawScene.anticipated_questions, 'has_anticipated_question', 'anticipated_questions', 'orchestration', pointer.label, file, `${basePath}.anticipated_questions`);
    const sequence = rawScene.sequence;
    if (isRecord(sequence)) {
      addRef(collector, id, sequence.prev, 'follows_scene', 'sequence.prev', 'orchestration', pointer.label, file, `${basePath}.sequence.prev`);
      addRef(collector, id, sequence.next, 'precedes_scene', 'sequence.next', 'orchestration', pointer.label, file, `${basePath}.sequence.next`);
    }
    addRefObject(collector, id, rawScene.covers, COVERS_CATEGORY_RELATION, 'orchestration', pointer.label, file, `${basePath}.covers`);

    const slideHooks = rawScene.slide_hooks;
    if (isRecord(slideHooks)) {
      asArray(slideHooks.suggested_slides).forEach((rawSlide, slideIdx) => {
        if (!isRecord(rawSlide)) {
          return;
        }
        const slideId = asNonEmptyString(rawSlide.id);
        if (!slideId) {
          return;
        }
        const slidePath = `${basePath}.slide_hooks.suggested_slides[${slideIdx}]`;
        addEntity(collector, {
          id: slideId,
          entityType: 'suggested_slide',
          plane: 'orchestration',
          pointerLabel: pointer.label,
          name: asNonEmptyString(rawSlide.title) ?? slideId,
          parentId: id,
          location: { file, path: slidePath },
          data: rawSlide,
        });
        addRef(collector, id, slideId, 'has_suggested_slide', 'suggested_slides', 'orchestration', pointer.label, file, slidePath);
        addRefObject(collector, slideId, rawSlide.refs, REFS_CATEGORY_RELATION, 'orchestration', pointer.label, file, `${slidePath}.refs`);
      });
    }
  });

  if (Object.prototype.hasOwnProperty.call(pointer.content, 'graph')) {
    const graph = pointer.content.graph;
    if (isRecord(graph)) {
      addRef(
        collector,
        null,
        graph.entry,
        'graph_entry_scene',
        'graph.entry',
        'orchestration',
        pointer.label,
        file,
        'graph.entry',
      );
      asArray(graph.endings).forEach((rawEnding, index) => {
        if (!isRecord(rawEnding)) {
          return;
        }
        addRef(
          collector,
          null,
          rawEnding.scene_id,
          'graph_ending_scene',
          'graph.endings.scene_id',
          'orchestration',
          pointer.label,
          file,
          `graph.endings[${index}].scene_id`,
        );
      });
      asArray(graph.transitions).forEach((rawTr, index) => {
        if (!isRecord(rawTr)) {
          return;
        }
        const trId = asNonEmptyString(rawTr.id);
        const trPath = `graph.transitions[${index}]`;
        if (trId) {
          addEntity(collector, {
            id: trId,
            entityType: 'transition',
            plane: 'orchestration',
            pointerLabel: pointer.label,
            name: asNonEmptyString(rawTr.label) ?? trId,
            location: { file, path: trPath },
            data: rawTr,
          });
        }
        addRef(
          collector,
          trId ?? null,
          rawTr.from,
          'transitions_from_scene',
          'graph.transitions.from',
          'orchestration',
          pointer.label,
          file,
          `${trPath}.from`,
        );
        addRef(
          collector,
          trId ?? null,
          rawTr.to,
          'transitions_to_scene',
          'graph.transitions.to',
          'orchestration',
          pointer.label,
          file,
          `${trPath}.to`,
        );
      });
    }
  }
}

/**
 * @param {any} collector
 * @param {any} pointer
 */
function extractFilm(collector, pointer) {
  if (!isRecord(pointer.content)) {
    return;
  }
  const file = pointer.location.file;

  asArray(pointer.content.lines).forEach((rawLine, index) => {
    if (!isRecord(rawLine)) {
      return;
    }
    const id = asNonEmptyString(rawLine.id);
    if (!id) {
      return;
    }
    const basePath = `lines[${index}]`;
    addEntity(collector, {
      id,
      entityType: 'line',
      plane: 'orchestration',
      pointerLabel: pointer.label,
      name: id,
      location: { file, path: basePath },
      data: rawLine,
    });
    addRef(collector, id, rawLine.scene_ref, 'belongs_to_scene', 'scene_ref', 'orchestration', pointer.label, file, `${basePath}.scene_ref`);
  });

  asArray(pointer.content.on_screen_texts).forEach((rawText, index) => {
    if (!isRecord(rawText)) {
      return;
    }
    const id = asNonEmptyString(rawText.id);
    if (!id) {
      return;
    }
    const basePath = `on_screen_texts[${index}]`;
    const role = asNonEmptyString(rawText.role);
    addEntity(collector, {
      id,
      entityType: 'on_screen_text',
      plane: 'orchestration',
      pointerLabel: pointer.label,
      name: role ? `${id} (${role})` : id,
      location: { file, path: basePath },
      data: rawText,
    });
    addRef(collector, id, rawText.anchor_line_ref, 'anchored_to_line', 'anchor_line_ref', 'orchestration', pointer.label, file, `${basePath}.anchor_line_ref`);
  });

  asArray(pointer.content.shots).forEach((rawShot, index) => {
    if (!isRecord(rawShot)) {
      return;
    }
    const id = asNonEmptyString(rawShot.id);
    if (!id) {
      return;
    }
    const basePath = `shots[${index}]`;
    addEntity(collector, {
      id,
      entityType: 'shot',
      plane: 'orchestration',
      pointerLabel: pointer.label,
      name: asNonEmptyString(rawShot.title) ?? id,
      location: { file, path: basePath },
      data: rawShot,
    });
    addRef(collector, id, rawShot.scene_ref, 'belongs_to_scene', 'scene_ref', 'orchestration', pointer.label, file, `${basePath}.scene_ref`);
    const visual = rawShot.visual;
    if (isRecord(visual)) {
      addRef(collector, id, visual.asset_ref, 'shows_asset', 'visual.asset_ref', 'orchestration', pointer.label, file, `${basePath}.visual.asset_ref`);
      addRefArray(collector, id, visual.text_refs, 'shows_text', 'visual.text_refs', 'orchestration', pointer.label, file, `${basePath}.visual.text_refs`);
      const card = visual.card;
      if (isRecord(card)) {
        addRefArray(collector, id, card.text_refs, 'shows_text', 'visual.card.text_refs', 'orchestration', pointer.label, file, `${basePath}.visual.card.text_refs`);
      }
    }
    const spans = rawShot.spans;
    if (isRecord(spans)) {
      addRef(collector, id, spans.from_line_ref, 'spans_from_line', 'spans.from_line_ref', 'orchestration', pointer.label, file, `${basePath}.spans.from_line_ref`);
      addRef(collector, id, spans.to_line_ref, 'spans_to_line', 'spans.to_line_ref', 'orchestration', pointer.label, file, `${basePath}.spans.to_line_ref`);
    }
  });

  const audio = pointer.content.audio;
  if (isRecord(audio)) {
    asArray(audio.cues).forEach((rawCue, index) => {
      if (!isRecord(rawCue)) {
        return;
      }
      const id = asNonEmptyString(rawCue.id);
      if (!id) {
        return;
      }
      const basePath = `audio.cues[${index}]`;
      addEntity(collector, {
        id,
        entityType: 'audio_cue',
        plane: 'orchestration',
        pointerLabel: pointer.label,
        name: asNonEmptyString(rawCue.purpose) ?? id,
        location: { file, path: basePath },
        data: rawCue,
      });
      // library_ref, asset_ref, stem_ref target external audio library manifests, not narrative entities.
      addAudioAnchorRefs(collector, id, rawCue.anchor, 'orchestration', pointer.label, file, `${basePath}.anchor`);
      addRefArray(collector, id, rawCue.variant_refs, 'applies_to_variant', 'variant_refs', 'orchestration', pointer.label, file, `${basePath}.variant_refs`);
    });

    asArray(audio.silence_windows).forEach((rawWindow, index) => {
      if (!isRecord(rawWindow)) {
        return;
      }
      const id = asNonEmptyString(rawWindow.id);
      if (!id) {
        return;
      }
      const basePath = `audio.silence_windows[${index}]`;
      addEntity(collector, {
        id,
        entityType: 'silence_window',
        plane: 'orchestration',
        pointerLabel: pointer.label,
        name: id,
        location: { file, path: basePath },
        data: rawWindow,
      });
      addAudioAnchorRefs(collector, id, rawWindow.anchor, 'orchestration', pointer.label, file, `${basePath}.anchor`);
      addRefArray(collector, id, rawWindow.variant_refs, 'applies_to_variant', 'variant_refs', 'orchestration', pointer.label, file, `${basePath}.variant_refs`);
    });
  }
}

/**
 * @param {any} collector
 * @param {any} pointer
 */
function extractScript(collector, pointer) {
  if (!isRecord(pointer.content)) {
    return;
  }
  const file = pointer.location.file;
  const voice = pointer.content.voice;
  const language = isRecord(voice) ? asNonEmptyString(voice.language) : undefined;

  addRef(
    collector,
    null,
    pointer.content.narrative_id,
    'script_for_narrative',
    'narrative_id',
    'delivery',
    pointer.label,
    file,
    'narrative_id',
    language,
  );

  const script = pointer.content.script;
  if (!isRecord(script)) {
    return;
  }

  asArray(script.scenes).forEach((rawSceneEntry, index) => {
    if (!isRecord(rawSceneEntry)) {
      return;
    }
    const basePath = `script.scenes[${index}]`;
    const sceneId = asNonEmptyString(rawSceneEntry.scene_id) ?? null;

    if (sceneId) {
      addRef(
        collector,
        null,
        sceneId,
        'script_words_scene',
        'scene_id',
        'delivery',
        pointer.label,
        file,
        `${basePath}.scene_id`,
        language,
      );
    }

    asArray(rawSceneEntry.lines).forEach((rawLineEntry, lineIdx) => {
      if (!isRecord(rawLineEntry)) {
        return;
      }
      addRef(
        collector,
        sceneId,
        rawLineEntry.line_ref,
        'script_words_line',
        'line_ref',
        'delivery',
        pointer.label,
        file,
        `${basePath}.lines[${lineIdx}].line_ref`,
        language,
      );
    });

    const slidePlan = rawSceneEntry.slide_plan;
    if (isRecord(slidePlan)) {
      addRefArray(
        collector,
        sceneId,
        slidePlan.slide_ids,
        'script_maps_slide',
        'slide_ids',
        'delivery',
        pointer.label,
        file,
        `${basePath}.slide_plan.slide_ids`,
        language,
      );
    }

    addRefObject(
      collector,
      sceneId,
      rawSceneEntry.refs,
      SCRIPT_REFS_CATEGORY_RELATION,
      'delivery',
      pointer.label,
      file,
      `${basePath}.refs`,
      language,
    );

    asArray(rawSceneEntry.interactive).forEach((rawInteraction, intIdx) => {
      if (!isRecord(rawInteraction)) {
        return;
      }
      const intPath = `${basePath}.interactive[${intIdx}]`;
      const intId = asNonEmptyString(rawInteraction.id);
      if (intId) {
        addEntity(collector, {
          id: intId,
          entityType: 'interaction',
          plane: 'delivery',
          pointerLabel: pointer.label,
          name: asNonEmptyString(rawInteraction.prompt) ?? intId,
          ...(sceneId ? { parentId: sceneId } : {}),
          ...(language !== undefined ? { language } : {}),
          location: { file, path: intPath },
          data: rawInteraction,
        });
        if (sceneId) {
          addRef(collector, intId, sceneId, 'in_scene', 'scene_id', 'delivery', pointer.label, file, `${basePath}.scene_id`, language);
        }
      }
      const refOwner = intId ?? sceneId;
      addRefObject(collector, refOwner, rawInteraction.refs, REFS_CATEGORY_RELATION, 'delivery', pointer.label, file, `${intPath}.refs`, language);
    });
  });

  const appendix = script.appendix;
  if (isRecord(appendix)) {
    asArray(appendix.glossary).forEach((rawEntry, index) => {
      if (!isRecord(rawEntry)) {
        return;
      }
      addRef(
        collector,
        null,
        rawEntry.concept_id,
        'script_glosses_concept',
        'concept_id',
        'delivery',
        pointer.label,
        file,
        `script.appendix.glossary[${index}].concept_id`,
        language,
      );
    });

    asArray(appendix.callouts).forEach((rawCallout, index) => {
      if (!isRecord(rawCallout)) {
        return;
      }
      const id = asNonEmptyString(rawCallout.id);
      if (!id) {
        return;
      }
      const basePath = `script.appendix.callouts[${index}]`;
      addEntity(collector, {
        id,
        entityType: 'callout',
        plane: 'delivery',
        pointerLabel: pointer.label,
        name: asNonEmptyString(rawCallout.text) ?? id,
        ...(language !== undefined ? { language } : {}),
        location: { file, path: basePath },
        data: rawCallout,
      });
      addRefArray(collector, id, rawCallout.used_in_scenes, 'used_in_scene', 'used_in_scenes', 'delivery', pointer.label, file, `${basePath}.used_in_scenes`, language);
    });
  }

  asArray(script.on_screen).forEach((rawOnScreen, index) => {
    if (!isRecord(rawOnScreen)) {
      return;
    }
    addRef(
      collector,
      null,
      rawOnScreen.text_ref,
      'script_words_text',
      'text_ref',
      'delivery',
      pointer.label,
      file,
      `script.on_screen[${index}].text_ref`,
      language,
    );
  });
}

/**
 * @param {any} collector
 * @param {any} pointer
 */
function extractAuthoredSlides(collector, pointer) {
  if (!isRecord(pointer.content)) {
    return;
  }
  const file = pointer.location.file;
  asArray(pointer.content.slides).forEach((rawSlide, index) => {
    if (!isRecord(rawSlide)) {
      return;
    }
    const id = asNonEmptyString(rawSlide.id);
    if (!id) {
      return;
    }
    const basePath = `slides[${index}]`;
    addEntity(collector, {
      id,
      entityType: 'authored_slide',
      plane: 'delivery',
      pointerLabel: pointer.label,
      name: asNonEmptyString(rawSlide.title) ?? id,
      location: { file, path: basePath },
      data: rawSlide,
    });
    addRef(collector, id, rawSlide.scene_id, 'belongs_to_scene', 'scene_id', 'delivery', pointer.label, file, `${basePath}.scene_id`);
    addRefArray(collector, id, rawSlide.claim_refs, 'references_claim', 'claim_refs', 'delivery', pointer.label, file, `${basePath}.claim_refs`);
    addRefArray(collector, id, rawSlide.concept_refs, 'references_concept', 'concept_refs', 'delivery', pointer.label, file, `${basePath}.concept_refs`);
    addRefArray(collector, id, rawSlide.asset_refs, 'references_asset', 'asset_refs', 'delivery', pointer.label, file, `${basePath}.asset_refs`);
    addRefArray(collector, id, rawSlide.evidence_refs, 'references_evidence', 'evidence_refs', 'delivery', pointer.label, file, `${basePath}.evidence_refs`);
  });
}

/**
 * @param {any} collector
 * @param {any} pointer
 */
function extractVariants(collector, pointer) {
  if (!isRecord(pointer.content)) {
    return;
  }
  const file = pointer.location.file;
  asArray(pointer.content.variants).forEach((rawVariant, index) => {
    if (!isRecord(rawVariant)) {
      return;
    }
    const id = asNonEmptyString(rawVariant.id);
    if (!id) {
      return;
    }
    const basePath = `variants[${index}]`;
    addEntity(collector, {
      id,
      entityType: 'variant',
      plane: 'delivery',
      pointerLabel: pointer.label,
      name: asNonEmptyString(rawVariant.name) ?? id,
      location: { file, path: basePath },
      data: rawVariant,
    });
    const selection = rawVariant.scene_selection;
    if (isRecord(selection)) {
      addRefArray(collector, id, selection.scene_ids, 'selects_scene', 'scene_ids', 'delivery', pointer.label, file, `${basePath}.scene_selection.scene_ids`);
      asArray(selection.overrides).forEach((rawOverride, ovIdx) => {
        if (!isRecord(rawOverride)) {
          return;
        }
        addRef(
          collector,
          id,
          rawOverride.scene_ref,
          'overrides_scene',
          'scene_ref',
          'delivery',
          pointer.label,
          file,
          `${basePath}.scene_selection.overrides[${ovIdx}].scene_ref`,
        );
      });
    }
    asArray(rawVariant.asset_substitutions).forEach((rawSub, subIdx) => {
      if (!isRecord(rawSub)) {
        return;
      }
      addRef(
        collector,
        id,
        rawSub.replace_ref,
        'replaces_asset',
        'replace_ref',
        'delivery',
        pointer.label,
        file,
        `${basePath}.asset_substitutions[${subIdx}].replace_ref`,
      );
      addRef(
        collector,
        id,
        rawSub.with_ref,
        'substitutes_with_asset',
        'with_ref',
        'delivery',
        pointer.label,
        file,
        `${basePath}.asset_substitutions[${subIdx}].with_ref`,
      );
    });
  });
}

/**
 * @param {any} collector
 * @param {any} pointer
 */
function extractQa(collector, pointer) {
  if (!isRecord(pointer.content)) {
    return;
  }
  const file = pointer.location.file;
  asArray(pointer.content.qa).forEach((rawQa, index) => {
    if (!isRecord(rawQa)) {
      return;
    }
    const id = asNonEmptyString(rawQa.id);
    if (!id) {
      return;
    }
    const basePath = `qa[${index}]`;
    addEntity(collector, {
      id,
      entityType: 'question',
      plane: 'assurance',
      pointerLabel: pointer.label,
      name: asNonEmptyString(rawQa.question) ?? id,
      location: { file, path: basePath },
      data: rawQa,
    });
    addRefArray(collector, id, rawQa.relevant_scenes, 'relevant_to_scene', 'relevant_scenes', 'assurance', pointer.label, file, `${basePath}.relevant_scenes`);
    addRefArray(collector, id, rawQa.supports_goals, 'supports_goal', 'supports_goals', 'assurance', pointer.label, file, `${basePath}.supports_goals`);
    addRefObject(collector, id, rawQa.refs, REFS_CATEGORY_RELATION, 'assurance', pointer.label, file, `${basePath}.refs`);
  });
}

/**
 * @param {any} collector
 * @param {any} pointer
 */
function extractRehearsal(collector, pointer) {
  if (!isRecord(pointer.content)) {
    return;
  }
  const file = pointer.location.file;
  asArray(pointer.content.checks).forEach((rawCheck, index) => {
    if (!isRecord(rawCheck)) {
      return;
    }
    const id = asNonEmptyString(rawCheck.id);
    if (!id) {
      return;
    }
    const basePath = `checks[${index}]`;
    addEntity(collector, {
      id,
      entityType: 'rehearsal_check',
      plane: 'assurance',
      pointerLabel: pointer.label,
      name: asNonEmptyString(rawCheck.name) ?? id,
      location: { file, path: basePath },
      data: rawCheck,
    });
    const scope = rawCheck.scope;
    if (isRecord(scope)) {
      addRefArray(collector, id, scope.scene_ids, 'checks_scene', 'scope.scene_ids', 'assurance', pointer.label, file, `${basePath}.scope.scene_ids`);
      addRefArray(collector, id, scope.claim_ids, 'checks_claim', 'scope.claim_ids', 'assurance', pointer.label, file, `${basePath}.scope.claim_ids`);
    }
  });
}

/**
 * @param {any} collector
 * @param {any} pointer
 */
function extractViews(collector, pointer) {
  if (!isRecord(pointer.content)) {
    return;
  }
  const file = pointer.location.file;
  asArray(pointer.content.view_templates).forEach((rawView, index) => {
    if (!isRecord(rawView)) {
      return;
    }
    const id = asNonEmptyString(rawView.id);
    if (!id) {
      return;
    }
    const basePath = `view_templates[${index}]`;
    addEntity(collector, {
      id,
      entityType: 'view',
      plane: 'assurance',
      pointerLabel: pointer.label,
      name: asNonEmptyString(rawView.name) ?? id,
      location: { file, path: basePath },
      data: rawView,
    });
  });
}

/**
 * Extract every authored entity occurrence, local reference occurrence, duplicate definition,
 * and external model link from a loaded Narrative source.
 *
 * @param {any} source
 */
export function extractNarrativeOccurrences(source) {
  const collector = {
    entityOccurrences: /** @type {any[]} */ ([]),
    rawReferences: /** @type {any[]} */ ([]),
    externalLinks: /** @type {any[]} */ ([]),
  };

  if (typeof source.id === 'string' && source.id.length > 0) {
    addEntity(collector, {
      id: source.id,
      entityType: 'narrative',
      plane: 'root',
      pointerLabel: 'root',
      name: source.name ?? source.id,
      location: source.location,
      data: source.root,
    });
  }

  for (const pointer of source.pointers) {
    if (pointer.status !== 'loaded') {
      continue;
    }
    switch (pointer.role) {
      case 'intent':
        extractIntent(collector, pointer);
        break;
      case 'concepts':
        extractConcepts(collector, pointer);
        break;
      case 'claims':
        extractClaims(collector, pointer);
        break;
      case 'evidence':
        extractEvidence(collector, pointer);
        break;
      case 'assets':
        extractAssets(collector, pointer);
        break;
      case 'scenes':
        extractScenes(collector, pointer);
        break;
      case 'film':
        extractFilm(collector, pointer);
        break;
      case 'script':
      case 'scripts':
        extractScript(collector, pointer);
        break;
      case 'slides':
        extractAuthoredSlides(collector, pointer);
        break;
      case 'variants':
        extractVariants(collector, pointer);
        break;
      case 'qa':
        extractQa(collector, pointer);
        break;
      case 'rehearsal':
        extractRehearsal(collector, pointer);
        break;
      case 'views':
        extractViews(collector, pointer);
        break;
      default:
        break;
    }
  }

  /** @type {Map<string, any[]>} */
  const occurrencesById = new Map();
  for (const occurrence of collector.entityOccurrences) {
    const list = occurrencesById.get(occurrence.id);
    if (list) {
      list.push(occurrence);
    } else {
      occurrencesById.set(occurrence.id, [occurrence]);
    }
  }

  const duplicates = [...occurrencesById.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([id, occurrences]) => ({ id, occurrences }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const duplicateIds = new Set(duplicates.map((entry) => entry.id));

  const references = collector.rawReferences.map((raw) => {
    const matches = occurrencesById.get(raw.targetId);
    const ambiguous = duplicateIds.has(raw.targetId);
    const resolved = matches !== undefined && matches.length === 1;
    return {
      ...raw,
      resolved,
      ambiguous,
    };
  });

  const unresolvedReferences = references.filter((ref) => !ref.resolved && !ref.ambiguous);
  const ambiguousReferences = references.filter((ref) => ref.ambiguous);

  return {
    entityOccurrences: collector.entityOccurrences,
    duplicates,
    references,
    unresolvedReferences,
    ambiguousReferences,
    externalLinks: collector.externalLinks,
  };
}

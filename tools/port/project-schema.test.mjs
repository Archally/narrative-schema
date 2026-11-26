// @ts-check
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse } from 'yaml';
import { DEFAULT_STRIP_X_GDSM_KEYS, projectSchemaText } from './project-schema.mjs';

const SAMPLE_WITH_PRIVATE_GDSM = [
  '# Top comment stays intact',
  '$schema: "https://json-schema.org/draft/2020-12/schema"',
  '$id: "urn:narrative:example:1.0.0"',
  'title: "Example Schema"',
  'type: object',
  'additionalProperties: false',
  'properties:',
  '  id:',
  '    $ref: "urn:narrative:metamodel:1.0.0#/$defs/id_ref"',
  'required: [id]',
  '',
  'x-gdsm:',
  '  modeling_guidance:',
  '    - lesson: "Internal lesson with private evidence"',
  '      category: semantics',
  '  version: "1.5.0"',
  '  methodology: "GDSM v1.0"',
  '  suite_name: "narrative"',
  '  tasks:',
  '    - { id: T1, name: "Internal task" }',
  '  designed_for:',
  '    - { id: T1, name: "Internal task" }',
  '  competency_questions:',
  '    - { id: CQ-1, question: "Internal question?" }',
  '  non_goals:',
  '    - "Out of scope item"',
  '  fitness:',
  '    last_evaluated: "2026-10-14"',
  '    scores:',
  '      T1: { basis: judgment, CC: 90 }',
  '  status: review',
  '',
].join('\n');

test('strips private x-gdsm keys while keeping validation keywords, $id, $ref and consumer x-gdsm', () => {
  const projected = projectSchemaText(SAMPLE_WITH_PRIVATE_GDSM);
  assert.match(projected, /^# Top comment stays intact/m);
  const parsed = parse(projected);
  assert.equal(parsed.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(parsed.$id, 'urn:narrative:example:1.0.0');
  assert.deepEqual(parsed.required, ['id']);
  assert.equal(parsed.properties.id.$ref, 'urn:narrative:metamodel:1.0.0#/$defs/id_ref');
  assert.equal(parsed['x-gdsm'].version, '1.5.0');
  assert.equal(parsed['x-gdsm'].suite_name, 'narrative');
  assert.deepEqual(parsed['x-gdsm'].non_goals, ['Out of scope item']);
  assert.equal(parsed['x-gdsm'].status, 'review');
  for (const key of DEFAULT_STRIP_X_GDSM_KEYS) {
    assert.equal(Object.hasOwn(parsed['x-gdsm'], key), false, `must strip ${key}`);
  }
  assert.doesNotMatch(projected, /Internal lesson|Internal task|Internal question|last_evaluated/);
});

test('projection is idempotent and normalizes CRLF to LF', () => {
  const crlf = SAMPLE_WITH_PRIVATE_GDSM.replace(/\n/g, '\r\n');
  const first = projectSchemaText(crlf);
  const second = projectSchemaText(first);
  assert.equal(first.includes('\r'), false);
  assert.equal(second, first);
});

test('schemas without targeted x-gdsm keys pass through byte-for-byte unchanged', () => {
  const plain = [
    '# Plain schema',
    '$schema: "https://json-schema.org/draft/2020-12/schema"',
    '$id: "urn:narrative:claims:1.0.0"',
    'type: object',
    'properties:',
    '  claims: { type: array }',
    '',
  ].join('\n');
  assert.equal(projectSchemaText(plain), plain);
  assert.equal(projectSchemaText(plain.replace(/\n/g, '\r\n')), plain);
});

test('removes x-gdsm block completely when every key in it is stripped', () => {
  const onlyPrivate = [
    '$id: "urn:narrative:minimal:1.0.0"',
    'type: object',
    'x-gdsm:',
    '  fitness:',
    '    last_evaluated: "2026-10-14"',
    '',
  ].join('\n');
  const parsed = parse(projectSchemaText(onlyPrivate));
  assert.equal(Object.hasOwn(parsed, 'x-gdsm'), false);
  assert.equal(parsed.$id, 'urn:narrative:minimal:1.0.0');
});

test('throws on malformed YAML input', () => {
  assert.throws(() => projectSchemaText('title: [unterminated\n'), /Invalid YAML schema/);
});

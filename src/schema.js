// Scene validation against schema/scene.schema.json, which also gives
// editors completion and checking (yaml-language-server). This handles the
// part of JSON Schema that file uses: $ref, type, enum, const, properties,
// required, additionalProperties, propertyNames, items, minItems,
// minProperties, anyOf, pattern, minimum, maximum and exclusiveMinimum.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCENE_SCHEMA = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema', 'scene.schema.json'), 'utf8'));

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v);
const NAMES = { object: 'a mapping', array: 'a list', string: 'a string', number: 'a number', integer: 'a whole number', boolean: 'true or false', null: 'nothing' };
const fits = (v, type) => (type === 'integer' ? Number.isInteger(v) : type === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeOf(v) === type);
const show = (v) => (JSON.stringify(v) ?? String(v)).slice(0, 60);
const at = (where, key) => (where ? `${where}.${key}` : key);

// describe says in a few words what a schema accepts, for errors.
function describe(s, root) {
  s = resolve(s, root);
  if (s.anyOf) return s.anyOf.map((x) => describe(x, root)).join(' or ');
  if (s.enum) return `one of ${s.enum.map((x) => JSON.stringify(x)).join(', ')}`;
  if ('const' in s) return JSON.stringify(s.const);
  return [].concat(s.type ?? 'anything').map((t) => NAMES[t] ?? t).join(' or ');
}

function resolve(s, root) {
  while (s.$ref) s = s.$ref.replace(/^#\//, '').split('/').reduce((o, k) => o[k], root);
  return s;
}

// validate throws an Error naming the first place v doesn't fit schema,
// e.g. "steps[3].term.run: unknown setting "comand"".
export function validate(v, schema = SCENE_SCHEMA, root = schema, where = '') {
  const s = resolve(schema, root);
  const fail = (msg) => { throw new Error(`${where || 'scene'}: ${msg}`); };
  if (s.anyOf) {
    // Of the branches whose type fits, report the first one's complaint:
    // that's what was meant (a term.run mapping, not its string form).
    const typed = s.anyOf.filter((x) => { const r = resolve(x, root); return !r.type || [].concat(r.type).some((t) => fits(v, t)); });
    let first;
    for (const x of typed) {
      try {
        validate(v, x, root, where);
        return;
      } catch (err) {
        first ??= err;
      }
    }
    if (first) throw first;
    fail(`want ${describe(s, root)}, got ${show(v)}`);
  }
  if (s.type && ![].concat(s.type).some((t) => fits(v, t))) fail(`want ${describe(s, root)}, got ${show(v)}`);
  if (s.enum && !s.enum.includes(v)) fail(`want ${describe(s, root)}, got ${show(v)}`);
  if ('const' in s && v !== s.const) fail(`want ${JSON.stringify(s.const)}, got ${show(v)}`);
  if (typeof v === 'number') {
    if (s.minimum != null && v < s.minimum) fail(`want ${s.minimum} or more, got ${v}`);
    if (s.exclusiveMinimum != null && v <= s.exclusiveMinimum) fail(`want more than ${s.exclusiveMinimum}, got ${v}`);
    if (s.maximum != null && v > s.maximum) fail(`want ${s.maximum} or less, got ${v}`);
  }
  if (typeof v === 'string' && s.pattern && !new RegExp(s.pattern, 'u').test(v)) fail(`${show(v)} doesn't match ${s.pattern}`);
  if (Array.isArray(v)) {
    if (s.minItems != null && v.length < s.minItems) fail(`want at least ${s.minItems} item(s)`);
    if (s.items) v.forEach((x, i) => validate(x, s.items, root, `${where}[${i}]`));
  }
  if (typeOf(v) === 'object') {
    if (s.minProperties != null && Object.keys(v).length < s.minProperties) fail('is empty');
    for (const k of s.required ?? []) if (!(k in v)) fail(`needs "${k}"`);
    for (const [k, x] of Object.entries(v)) {
      if (s.propertyNames?.enum && !s.propertyNames.enum.includes(k)) fail(`unknown key "${k}"; want ${describe(s.propertyNames, root)}`);
      if (s.properties && k in s.properties) validate(x, s.properties[k], root, at(where, k));
      else if (s.additionalProperties === false) fail(`unknown setting "${k}"; known: ${Object.keys(s.properties ?? {}).join(', ')}`);
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') validate(x, s.additionalProperties, root, at(where, k));
    }
  }
}

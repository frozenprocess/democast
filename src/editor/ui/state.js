// The editor's shared state and DOM handles. The other modules import
// these rather than passing them around.

import { $ } from './util.js';

export const video = $('video');
export const tracks = $('tracks');
export const scroller = $('scroller');
export const SNAP_PX = 8;
// The server takes POSTs only as JSON (see refuse in server.js).
export const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const LANES = [
  { id: 'ruler', name: '', h: 26 },
  { id: 'edits', name: 'Edits', h: 58 },
  { id: 'captions', name: 'Captions', h: 40 },
  { id: 'steps', name: 'Steps', h: 48 },
  { id: 'narration', name: 'Narration', h: 64 },
];

// What is loaded (project, take, res) is any: the editor works on it only
// once load() has filled it in.
/**
 * @type {{ project: any, take: any, anchored: any, res: any, selected: number | null, pps: number,
 *   history: any[], future: any[], dirty: boolean, wave: Map<string, any> }}
 */
export const state = {
  project: null,
  take: null,
  anchored: null, // saved form, shared across takes
  res: null, // seconds, current take
  selected: null, // region id
  pps: 40, // pixels per second
  history: [],
  future: [],
  dirty: false,
  wave: new Map(), // take id -> { rate, peaks }
};
let nextId = 1;
export const newId = () => nextId++;
export const withIds = (res) => ({ ...res, regions: res.regions.map((r) => ({ ...r, id: r.id ?? newId() })) });
export const stripIds = (res) => ({ ...res, regions: res.regions.map(({ id, ...r }) => r) });

// x is a time in seconds as a pixel offset on the timeline; tAt is the reverse.
export function x(t) {
  return t * state.pps;
}

export function tAt(px) {
  return Math.min(state.take.duration, Math.max(0, px / state.pps));
}

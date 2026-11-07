// Redrawing the whole editor from the state.

import {
  segments, outputDuration,
} from '../edits.js';
import { $ } from './util.js';
import { state, stripIds } from './state.js';
import { renderTimeline } from './timeline.js';
import { renderAudio, renderInspector, renderWarnings } from './inspector.js';
import { updatePlayhead } from './playback.js';

export function render() {
  if (!state.take) return;
  renderTimeline();
  renderInspector();
  renderWarnings();
  renderButtons();
  renderAudio();
  const segs = segments(state.take, stripIds(state.res));
  $('outInfo').textContent = `output ${outputDuration(segs).toFixed(1)}s of ${state.take.duration.toFixed(1)}s`;
  updatePlayhead();
}

export function renderButtons() {
  $('undo').disabled = !state.history.length;
  $('redo').disabled = !state.future.length;
  $('save').disabled = !state.dirty;
  $('save').textContent = state.dirty ? 'Save •' : 'Save';
}

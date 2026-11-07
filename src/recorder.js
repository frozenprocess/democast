// Recorder: captures a page with Chrome's screencast and writes a
// near-lossless intermediate video.
//
// Chrome's screencast delivers frames at the page's CSS size unless the
// browser runs with a real device scale factor (see launch in browser.js),
// so 4K needs --force-device-scale-factor, not just an emulated one. This
// drives the DevTools protocol directly rather than using Puppeteer's
// page.screencast, to control timing: time zero is the first frame, and
// the last frame is held until stop, since Chrome only sends frames when
// the page changes.

import { startFfmpeg } from './ffmpeg.js';

// x264 quality (lower is better) of the live recording: near-lossless, as
// it is encoded again for the final video.
const LIVE_CRF = 8;

// openEncoder starts an ffmpeg that turns JPEG frames written to its
// stdin, fps per second, into a near-lossless video file. done resolves
// once ffmpeg has finished, after stdin is closed.
export function openEncoder({ file, fps, width, height }) {
  const { proc, done } = startFfmpeg([
    '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
    // Frames should already be width x height; scale/pad guards against an
    // odd-sized frame (e.g. mid-resize) breaking the encode.
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:0:0,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', String(LIVE_CRF), '-r', String(fps),
    file,
  ], { label: 'recording ffmpeg', stdin: 'pipe' });
  done.catch(() => {});
  return { proc, stdin: proc.stdin, done };
}

// startRecording begins capturing page into file at fps frames per second.
// It resolves once the first frame has arrived; the returned t0 (ms, on the
// Date.now() clock) is the moment that is time zero in the video.
export async function startRecording(page, { file, fps, width, height }) {
  const session = await page.createCDPSession();
  const { proc: ffmpeg, done: ffmpegDone } = openEncoder({ file, fps, width, height });

  // Frames arrive only when the page changes. Each frame is written once
  // the next one arrives, repeated to fill the time it was on screen, on a
  // constant-fps grid anchored at the first frame.
  /** @type {number | null} */
  let start = null; // first frame's timestamp, seconds
  let prev = null; // { buf, ts }
  let written = 0; // frames written so far
  let stopped = false; // set once stop or abort begins; later frames are dropped
  let firstFrame;
  const gotFirst = new Promise((r) => { firstFrame = r; });
  const writeUntil = (ts) => {
    const target = Math.round((ts - /** @type {number} */ (start)) * fps);
    for (; written < target; written++) ffmpeg.stdin.write(prev.buf);
  };

  // The frame timestamps are seconds on the wall clock; the offset maps
  // them onto Date.now() for t0, in case the clocks differ.
  let clockOffset = 0;
  session.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    // Chrome can still deliver a queued frame after stopScreencast, once
    // ffmpeg's input is closed; writing it would crash the run.
    if (stopped) return;
    session.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    const ts = metadata.timestamp ?? Date.now() / 1000;
    if (start === null) {
      start = ts;
      clockOffset = Date.now() - ts * 1000;
      firstFrame();
    } else if (prev) {
      writeUntil(ts);
    }
    prev = { buf: Buffer.from(data, 'base64'), ts };
  });

  await session.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1 });
  // Nudge a repaint, in case the page is static and Chrome has nothing new
  // to send.
  await page.evaluate(() => {
    document.body.style.outline = '0 solid transparent';
    requestAnimationFrame(() => { document.body.style.outline = ''; });
  });
  await Promise.race([
    gotFirst,
    new Promise((_, reject) => setTimeout(() => reject(new Error('no screencast frames from Chrome after 10s')), 10000)),
  ]);

  return {
    t0: /** @type {number} */ (/** @type {unknown} */ (start)) * 1000 + clockOffset,
    // stop holds the last frame until now, finishes the file, and returns
    // the video's duration in seconds.
    async stop() {
      // Let the frame for the last change arrive; Chrome sends frames a
      // little after the page paints.
      await new Promise((r) => setTimeout(r, 300));
      await session.send('Page.stopScreencast').catch(() => {});
      stopped = true;
      const end = (Date.now() - clockOffset) / 1000;
      if (prev) writeUntil(Math.max(end, prev.ts));
      ffmpeg.stdin.end();
      await ffmpegDone;
      await session.detach().catch(() => {});
      return written / fps;
    },
    // abort stops without caring about the output.
    abort() {
      stopped = true;
      session.send('Page.stopScreencast').catch(() => {});
      ffmpeg.stdin.destroy();
      ffmpeg.kill('SIGKILL');
    },
  };
}

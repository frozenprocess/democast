// The help text of `democast --help`.

import { FORMATS } from '../formats.js';
import { ENGINES } from '../tts.js';
import { defaultJobs } from '../sources.js';

export const usage = () => `usage:
  democast [record] [flags] <scene.yaml>   record takes and render them
  democast render [flags] <scene.yaml>     re-render recorded takes with the current edits
  democast edit [flags] <scene.yaml>       open the timeline editor in a browser
  democast check [flags] <scene.yaml>      check a scene without running it: settings,
                                           variables, files, profile and layouts
  democast login [flags] <scene.yaml>      sign in to the scene's site in a Chrome window,
                                           saving the session for recordings
  democast [record] [flags] <remix.yaml>   a scene with "remix: true" cuts clips from
                                           takes already recorded (their .log/) into a
                                           new video, in any format; nothing is recorded
  democast sources [flags] <take.log|dir>...
                                           render each window alone from kept replay
                                           logs (--sources-later); a dir means every
                                           *.log in it. Skips sources already up to date

Flags:
  -f, --format LIST   comma-separated formats to render: ${Object.keys(FORMATS).join(', ')}
                      (default: the scene's "formats", else 16x9)
  -o, --out DIR       output directory (default: ./out)
  -r, --retries N     re-record a failed take up to N times (default: 0)
      --voice ENGINE[:VOICE]
                      override the scene's narration voice, e.g. kokoro:am_michael
                      or vibevoice:Emma (engines: ${ENGINES.join(', ')})
      --no-voice      skip narration (say steps do nothing), for quick takes
      --voice-only    synthesize the narration and print the clip files; don't record
      --chrome PATH   Chrome/Chromium binary (default: $CHROME_PATH or autodetect)
  -s, --scale N       resolution multiplier: 2 gives 4K (3840x2160 for 16x9) (default: 1)
      --4k            same as --scale 2
      --fps N         frame rate (default: the scene's fps, else 30)
      --smooth        record live, then render the video frame by frame: every
                      frame at the full frame rate at any scale, however slow the machine
                      (live capture drops frames at 4K); rendering takes a few
                      minutes per minute of video
      --sources       also render each window on its own, full frame, in sync
                      with the take, for the edit (like OBS Source Record):
                      <name>-<format>-browser.mp4 (the page, no window frame,
                      with the pointer), -terminal.mp4, -terminal2.mp4, and each
                      terminal as a page of text and CSS that reflows to any
                      width and plays in sync (-terminal.html). Implies
                      --smooth; keeps the replay log in <name>-<format>.log/.
                      The sources render a few at a time (see --jobs)
      --sources-later keep the replay log (and capture the site sharp enough for
                      sources) but don't render sources; run "democast sources"
                      afterwards, e.g. once a whole pass is recorded
  -j, --jobs N        sources: how many to render at once (default: ${defaultJobs()})
      --force         sources: render again even if up to date
      --guides        shade the areas platform UI covers (9x16), to check a layout;
                      writes <name>-<format>-guides.mp4
      --headed        show the browser window while recording (for debugging)
      --no-redact     record without the scene's redact and blur: real emails,
                      names, IPs and keys show (for takes you won't publish)
  -q, --quiet         don't print each step
      --port N        edit: port for the editor (default: 7717)
      --open          edit: open the editor in the default browser
      --profile NAME  login: the saved browser profile to use (default: the
                      scene's browser.profile, else the scene's name)
  -h, --help          show this help

Edits made in the editor are saved next to the scene (<scene>.edits.yaml)
and applied by every record and render.
`;

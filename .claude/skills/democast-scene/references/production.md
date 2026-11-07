# Production workflows

Use the checkout's [reference.md](../../../../docs/reference.md) for detailed behavior,
[schema](../../../../schema/scene.schema.json) for scene arguments, and
`democast --help` for the current CLI. This reference explains which path
to choose and what must be kept to use it again.

## Commands and options

| Task | Command |
| --- | --- |
| Run a live scene, or build a remix | `democast [record] [flags] scene.yaml` |
| Validate settings, references, files and layouts | `democast check [flags] scene.yaml` |
| Save a signed-in browser profile | `democast login [flags] scene.yaml` |
| Edit existing takes | `democast edit [flags] scene.yaml` |
| Apply edits to existing takes | `democast render [flags] scene.yaml` |
| Export windows from kept logs | `democast sources [flags] take.log/ [other.log/ ...]` or `democast sources out/` |

Options are command-specific even though the parser accepts them globally.
In particular, `render` uses the recorded take's resolution, frame rate and
narration; recording flags do not recapture or resynthesize those inputs.

| Options | Use |
| --- | --- |
| `-f`, `--format LIST` | Comma-separated `16x9,1x1,4x5,9x16`; selects recording formats or filters takes for check/render. The editor lists all takes for the scene. |
| `-o`, `--out DIR` | Output/take directory, default `out`, relative to the invocation directory. For `sources`, pass log directories as positional arguments. |
| `-r`, `--retries N` | Retry failed recordings/remix builds, default 0. Live retries repeat side effects; resolve failed cleanup first. |
| `-s`, `--scale N`; `--4k` | Recording/remix output density; default 1, greater than 0 and at most 4. `--4k` selects 2. |
| `--fps N` | Recording/remix frame rate, integer 1–120; overrides scene `fps`, otherwise 30. |
| `--smooth` | Live capture followed by frame-by-frame stage rendering. |
| `--sources`; `--sources-later` | Keep replay logs and capture sharp source frames; export now or later. Both imply smooth recording. |
| `-j`, `--jobs N` | Source-export concurrency, positive integer; default roughly a quarter of CPU cores, capped at 4. |
| `--force` | `sources`: regenerate exports even when considered current. |
| `--voice ENGINE[:VOICE]` | Override recording/remix narration; engines: `kokoro`, `vibevoice`, `command`. |
| `--no-voice`; `--voice-only` | Skip narration for a quick take, or synthesize and list clips without recording. |
| `--chrome PATH` | Browser executable for workflows that launch Chrome; also configurable through `CHROME_PATH`. |
| `--headed` | Show recording browsers for debugging; smooth mode's live stage is reduced and does not show the mirrored site. |
| `--guides` | Shade covered areas for a 9x16 framing check; writes a separate guides take. |
| `--no-redact` | Live recording: disable scene redaction and blur, including on-demand blur. Raw data also enters retained logs/HTML; this does not remove blur already captured in a take. |
| `-q`, `--quiet` | Suppress per-step recording logs. |
| `--port N`; `--open` | Editor port (default 7717) and opening its page in the default browser. |
| `--profile NAME` | Login profile override; use the same name in `browser.profile` when recording. |
| `-h`, `--help` | Show commands and flags. |

Run `make help` in the checkout for wrappers and cleanup targets. Local
recording needs Node 20+, Chrome/Chromium/Edge and ffmpeg; audio inspection
uses ffprobe. Python narration engines need uv. Linux and macOS are
supported; Windows process handling is not.

## Capture quality and retained sources

Use ordinary recording for quick feedback. Choose `--smooth` when pointer,
typing or scrolling motion stutters, especially at high resolution. It
replays the stage at the target frame rate after live execution; missing
live website frames are not reconstructed. Expect additional render time.

For editing or remixing from the same live run:

```bash
democast --sources-later -f 16x9 -o out scene.yaml
democast sources out/ -j 2
```

`--sources` exports immediately instead. Exports include `-browser.mp4`,
`-terminal.mp4`, `-terminal2.mp4` for present windows, and terminal HTML
with selectable text, seek/play/pause controls and playback speed. HTML
supports `#t=12.5`, `?autoplay`, the `democastTerminal` API and `--dc-*` CSS
variables; see reference.md "Terminals as HTML" for embedding and styling.

Sources use the unedited take clock: edits to the composite do not trim
these files. Keep `<base>.log/` (including `log.json` and its JPEGs) for
future source exports or remixes. `--smooth` alone does not retain that log.
Logs can be large; use the reference.md's storage guidance before long captures.
Source rendering does not rerun browser actions or terminal commands.

## Editing and re-rendering

```bash
democast edit -o out --open scene.yaml
democast render -o out -f 16x9 scene.yaml
```

The editor offers trim handles, cut regions, speed factors
`1.5, 2, 3, 4, 8`, text overlays at top/center/bottom, and voice/music gains.
Use edit preview and heed warnings about cutting narration or changing its
speed. Timeline snapping, undo/redo and keyboard shortcuts are documented
in the editor and reference.md "Timeline editor".

Edits live in `<scene>.edits.yaml` beside the scene and are applied on both
recording and re-rendering. Anchors use step indices and offsets, not stable
IDs. Inserting, deleting or reordering steps can misplace edits. Staleness
checks compare action names and counts, so changed arguments or swaps of
same-kind steps can escape detection. Recheck edits after scene changes.

`render` applies edits to existing raw captures. To change captured actions,
layout, resolution, or narration text/voice, produce a new take (a live
recording or a rebuilt remix). It cannot update those from scene changes
alone. Gain and music changes can be applied during re-rendering.

Keep `<base>.raw.mkv`, `<base>.take.json` and `<base>.narration/` together.
The take owns copies of its voice clips and can survive clearing the TTS
cache or moving that bundle. The scene's music and other assets still need
their referenced paths. Replay logs are a separate artifact from raw takes.
Do not run `make clean-takes` while those takes/logs are still needed.

## Remix existing activity

Read reference.md "Remix: new videos from recorded takes" before constructing a
remix. It requires logs kept with `--sources` or `--sources-later`; an MP4
alone is insufficient even when the reference ends in `.mp4`.

```yaml
name: short-demo
remix: true
formats: [9x16]
takes:
  demo: ../out/demo-16x9
steps:
  - caption: The result
  - clip: { take: demo, window: browser, from: 1, to: 5, zoom: { x: 0.2, y: 0.1, w: 0.5 } }
  - clip: { take: demo, window: term, from: 5, to: 9, speed: 1.5 }
```

`takes` maps aliases to log directories or take bases, relative to the scene.
`clip.take` can also be a path. Select `window: browser`, `term` or `term2`;
`from` and `to` are seconds on the source clock, with `0 <= from < to`.
`speed` is a positive playback multiplier. Browser `zoom` uses normalized
`x`, `y` and width `w`; height follows the target panel. `pan: false`
disables interpolation into this clip's box, `pointer: false` hides the pointer,
and terminal `title` overrides its window title.

Remixes allow only `clip`, `card`, `hideCard`, `caption`, `say`, `wait` and
`cursor.hide`. They need at least one clip and cannot have `site`, `setup`
or `teardown`. They reuse captured browser pixels and rebuild terminal text;
cropping does not rerun a website at a different responsive viewport.

Run `democast check remix.yaml`, then `democast remix.yaml`. The result
supports the same edits, contact sheets and narration subtitles as live
takes. No login or live-state reset is needed. Review source redaction:
adding rules to a remix cannot sanitize pixels already captured.

## Narration, music and subtitles

`say: text` waits for the line; `{text, wait: false}` lets subsequent actions
run during speech. Lines are queued so voices do not overlap. Per-line
`say.voice` overrides synthesis settings. Text must be nonempty and cannot
contain `{{variables}}`, including environment references, because it is
synthesized before execution.

- Common `voice` settings: `engine`, `voice`, `pronounce`, `volume`.
  Pronunciation substitutions affect speech, not subtitle spelling.
- `kokoro`: CPU engine; `speed`, `lang`, `model` (`fp32` or `int8`).
- `vibevoice`: heavier engine; `device`, `dtype`, `cfg`, `steps`.
- `command`: configure `voice.command`; the program reads text on stdin
  and writes a WAV at `{out}`. This placeholder uses single braces.

See reference.md "Narration" for voices, engine requirements and defaults.
Audition with `democast --voice-only scene.yaml` or override with
`--voice kokoro:af_heart`. Engine switching preserves pronunciation and
volume but drops settings specific to the previous engine.

`music: track.mp3` or `music: {file: track.mp3, volume: 0.5}` adds looped,
faded music ducked under narration. Paths are relative to the scene.
The output mix is normalized; edit-file audio gains multiply scene gains.
Narrated renders write `.srt` files; these are separate subtitles, not
automatically burned into video. Inspect actual playback for voice timing,
pronunciation and levels. TTS cache files are under `out/.cache/tts`.

# democast reference

Details beyond the [README](../README.md) quick start. Worked scenes: [examples.md](../examples.md).

## Output and requirements

Each render writes `out/<scene>-<format>.mp4` and `out/<scene>-<format>-sheet.png`,
plus `out/<scene>-<format>.srt` subtitles if the scene has narration.
The PNG is a contact sheet of 12 frames, so you can check a take without
watching it. If a step fails, democast saves a screenshot of that moment as
`out/<scene>-<format>-error.png` and exits non-zero.

To run it as `democast` from anywhere, run `npm link` in this folder
(and `npm unlink -g democast` to undo it).

Requirements: Linux or macOS, Node 20+, ffmpeg, and Chrome, Chromium or
Edge (autodetected, or `--chrome PATH` / `$CHROME_PATH`). Install an emoji font (e.g.
`fonts-noto-color-emoji`) if your scenes use emoji.

Or with make, which wraps every command and flag (`make help` lists them):

```
make check                                   # are node, ffmpeg, Chrome, uv installed?
make check-scene                             # is the scene ready to record? (no Chrome)
make login                                   # sign in to the scene's site, saving the session
make record FORMAT=9x16,4x5 VOICE=vibevoice:Emma RETRIES=2
make 9x16                                    # one format; also 16x9, 4x5, 1x1
make 4k | make guides | make silent          # 4K, safe-zone check, no narration
make kokoro VOICE=af_heart                   # audition narration without recording
make edit OPEN=1 | make render | make clean
```

Each flag has a variable (`SCENE`, `FORMAT`, `OUT`, `RETRIES`, `VOICE`,
`SCALE`, `CHROME`, `PORT`, and `NO_VOICE`, `GUIDES`, `HEADED`, `QUIET`,
`OPEN` set to 1), and `EXTRA` passes anything else through.

Recording also keeps each take: `<scene>-<format>.raw.mkv`, a
near-lossless capture, and `<scene>-<format>.take.json`, with when each step
ran and where the narration falls, and `<scene>-<format>.narration/`, the
take's narration clips. That's what lets the editor and
`democast render` apply edits without recording again. A take is about
10 MB a minute at 1080p.

## Flags

| Flag | |
|---|---|
| `-f, --format LIST` | comma-separated formats (see below). Default: the scene's `formats`, else `16x9` |
| `-s, --scale N`, `--4k` | resolution multiplier; `--4k` is `--scale 2` (3840×2160 for 16x9). Output is named `<scene>-<format>@2x.mp4` |
| `--fps N` | frame rate, 1 to 120 (default: the scene's `fps`, else 30). 60 makes scrolling and the pointer smoother, for more CPU and a somewhat larger take |
| `--smooth` | record live, render the video afterwards frame by frame: the full frame rate at any scale (see Formats) |
| `--guides` | shade the areas TikTok/Reels/Shorts UI covers, to check a 9x16 layout. Output is named `…-guides.mp4` |
| `-o, --out DIR` | output directory (default `./out`) |
| `-r, --retries N` | re-record a failed take up to N times, for flaky networks |
| `--chrome PATH` | browser binary |
| `--headed` | show the browser while recording, for debugging |
| `--voice ENGINE[:VOICE]` | override the narration voice, e.g. `kokoro:af_heart`, `vibevoice:Emma` |
| `--no-voice` | skip narration, for quick silent takes |
| `--voice-only` | synthesize the narration, print the clip files and durations, and stop |
| `-q, --quiet` | don't print each step |

## Timeline editor

`democast edit scene.yaml` starts a local editor (localhost only; `--open`
opens it, `--port` changes the port) for trimming and tightening recorded
takes:

- **Preview:** the take plays with its narration. With "Preview edits"
  on, playback skips cuts, plays speed-ups fast and shows text overlays,
  so it looks like the render.
- **Timeline lanes:** the steps, colored by kind (browser, terminal,
  stage, narration), the captions, and the narration lines over their
  waveform, so it's easy to see what's happening when.
- **Edits:** drag on the Edits lane to add a region, then pick its type
  in the side panel:
  - **cut** removes a part;
  - **speed** plays a part 1.5–8× faster, for example a slow network wait;
  - **text** overlays a one-line caption at the top, center or bottom,
    inside the format's safe area.
- **Trim:** drag the orange handles, or press I and O at the playhead.
- **Editing regions:** drag a region to move it, or its edges to resize.
  Edges snap to step boundaries, narration and the playhead; hold Alt to
  stop snapping.
- **Audio:** voice and music volume.
- **Warnings:** a cut or trim that splits a narration line, and a
  speed-up over narration, which would speed up the voice too.
- **Undo and redo**, and keyboard shortcuts for most actions. The side
  panel lists them.
- **Render** renders the format being edited and opens the result.
  **Render all** renders every recorded take.

Edits are saved next to the scene as `<scene>.edits.yaml`, so commit
them along with it. Times in it are anchored to steps, as "this many
seconds into step N", not to absolute times. That way one set of edits
applies to every format, and still applies after re-recording, even
though each take's timing is a little different. Recording applies the
edits automatically, and `democast render` re-applies them to existing
takes in seconds.

If you add or remove steps in the scene, step numbers shift and
existing edits can land on the wrong steps. The editor flags takes
recorded before such a change; re-record them, then check the edits.

## Sites behind a login

The site runs in its own Chrome window, as an ordinary top-level page whose
frames are painted into the stage. To the site it's normal browsing:
cookies are first-party, sign-in redirects across domains work, and pages
that refuse to be framed show normally.

To record a site you have to sign in to, save a signed-in browser profile
once:

```
democast login scene.yaml      # or: make login SCENE=scene.yaml
```

This opens a plain Chrome window, with no automation attached, so Google,
Microsoft, GitHub, Apple, Meta and passkey sign-ins work the way they do
in everyday browsing. Sign in, then close the window. The profile is saved
in `~/.config/democast/profiles/<name>`, and the scene uses it with:

```yaml
site: https://login.tailscale.com/admin
browser:
  profile: tailscale-demo     # or "true" to use the scene's name
  loginUrl: https://login.tailscale.com/login   # where "democast login" opens (default: site);
                                                # a list opens a tab for each
```

Each take starts from a fresh copy of the profile, so every take begins
in the same signed-in state, and recording never changes the saved
profile. `democast login` turns on Chrome's "continue where you left off"
for the profile, because many sites sign in with session cookies, which
Chrome otherwise discards when the window closes. When the session
expires, recording fails at the first step that needs it. Run `democast
login` again.

Google is the exception. It rotates its session cookies as they're used,
and a take that starts from a copy throws the new ones away; after a few
takes the saved profile is on cookies Google has retired, and Google signs
it out. It also refuses to sign in again inside a recording ("This browser
or app may not be secure"). For a scene that uses a Google session, run on
the saved profile itself, so it stays current:

```yaml
browser:
  profile: some-demo
  saveSession: true   # use the saved profile, not a copy; one take at a time
```

Every scene that shares the profile needs it, or one copy-based take can
sign the profile out again.

Other ways in:

```yaml
browser:
  auth: { username: demo, password: "{{env.DEMO_PASSWORD}}" }   # HTTP basic auth
  headers: { Authorization: "Bearer {{env.DEMO_TOKEN}}" }       # sent with every request
setup:                        # steps run before recording; not in the video
  - browser.open: https://example.com/login
  - browser.fill: { selector: "#email", text: "{{env.DEMO_EMAIL}}" }
  - browser.fill: { selector: "#password", text: "{{env.DEMO_PASSWORD}}" }
  - browser.click: "button[type=submit]"
  - browser.waitFor: { text: "Dashboard" }
```

A scripted `setup` login suits plain email-and-password forms. It won't
get past 2FA, captchas or single sign-on; use `democast login` for those.

**Privacy.** A signed-in session shows real names, emails, device names
and IP addresses. Use a demo account where you can, and redact or blur the
rest.

`redact` hides text wherever it appears, without knowing the page's
structure:

```yaml
redact:
  - email                     # presets: email, tailnet, tailscale-ip, tailscale-ipv6, keys
  - tailnet
  - { text: "{{env.DEMO_NAME}}", with: You }               # a literal string
  - { regex: '\bn[A-Za-z0-9]+CNTRL\b', with: nXXXXCNTRL }  # a pattern
```

In the terminal and the URL bar, matches are replaced with `with` (each
preset has a stand-in, such as `you@example.com`; without one, the match
is blocked out). In the site, matches are blurred from the first paint
and as the page changes, including an AI's answer streaming in a few
characters at a time. The blur uses the CSS Custom Highlight API, which
leaves the page's DOM alone, so it works in React apps and code editors.
It's text-based: it can't see text in images or in form fields.

To blur whole elements by selector:

```yaml
browser:
  blur: [".user-email", "[data-testid=avatar]"]   # hidden from the first paint of every page
steps:
  - browser.blur: ".billing"                      # blur on demand ...
  - browser.unblur:                               # ... and undo
```

Treat a saved profile like a password. Anyone with the directory has your
signed-in sessions. It's kept outside the project and the output
directory, readable only by you. Don't copy it into a repo.

## Formats

| Format | Size | For |
|---|---|---|
| `16x9` | 1920×1080 | LinkedIn, YouTube, X. Browser and terminal side by side |
| `1x1` | 1080×1080 | square posts in feeds |
| `4x5` | 1080×1350 | portrait posts in feeds: the largest a video gets in the Instagram, LinkedIn and Facebook feeds |
| `9x16` | 1080×1920 | TikTok, Instagram Reels, YouTube Shorts |

**9x16** is built around what those apps draw over a video. The username
and caption cover the bottom, the like and comment buttons cover the right
edge, and there's a header at the top. Across the three apps the clear
area is about 288 px from the top, 672 px from the bottom, 120 px from the
left and 192 px from the right, with the button column 300 px wide from
y = 840 down. The layout keeps captions, cards and panels inside that
area, and the terminal keeps its text clear of the buttons.

That leaves too little room for the browser and the terminal together at
a size readable on a phone. So 9x16 shows one panel at a time, large, and
switches with a short slide to whichever panel each step uses. A scene can
turn that off with `autoFocus: false` and switch by hand with `focus:`
steps, or use `layout: both` to stack the two panels instead.

Render with `--guides` to see the covered areas shaded in red, and check
that nothing important sits under them.

**4K**: `--scale 2` renders at twice the pixel density, not by
upscaling. Both the stage and the site's browser run at device pixel
ratio 2, so text and the site are sharp at 3840×2160 (or 2160×3840 for
9x16). It works for any format. Takes are about 1.5× slower to encode,
and the files are larger.

**Smooth takes**: a take is normally captured live, and Chrome only
delivers as many frames as the machine can draw. At 4K, or on a slow
machine, that can be far fewer than 30 a second, and cursor moves,
typing and scrolling stutter (the file still has every frame; they repeat).
With `--smooth`, the run is live as usual (the site, the commands, the
timing), but democast logs everything it does to the stage and keeps
every frame the site produces. Afterwards it replays the log into a
fresh stage whose clock is paused, moving the clock forward one frame
at a time and capturing each frame, so every frame is there however long
it takes to draw. Measured at 4K on a 12-thread laptop: typing went from
about 15 to 30 frames a second, scrolling a site from about 13 to 30.

What still depends on the machine is how often the site itself is
captured during the run; captured on its own, without the stage, that's
about 30 a second at 4K. Rendering takes about two to three times the
take's length, after the run; the commands and the site are done by then.

## Scene file

```yaml
name: tailground                 # output file prefix (default: the file name)
site: https://example.com/    # loaded into the browser panel at the start
siteLabel: example.com        # what the fake URL bar shows (default: site)
autoFocus: true               # 9x16: switch to the panel each step uses
layout: focus                 # 9x16: "focus" (one panel at a time) or "both" (stacked);
                              # "max": a one-panel scene fills the frame (no room for captions)
formats: [16x9, 9x16]
fps: 30                       # frame rate (default 30)
timeout: 60000                # default per-step timeout, ms
env: { FOO: bar }             # extra environment for terminal commands;
                              # values can use {{env.NAME}}
browser:
  scale: 1.2                  # zoom of the site; or per format: { 16x9: 1.2, 1x1: 1.0 }
terminal:
  title: "~ — bash"
  fontSize: 21                # or per format
  cps: 28                     # typing speed, characters per second
theme:                        # override any stage CSS color
  bg: "#0e1116"
  accent: "#7ee787"
voice:                        # narration for say steps; see Narration below
  engine: kokoro
  voice: am_michael
music: { file: music.mp3, volume: 0.5 }   # optional; looped, faded, ducked under narration
steps:
  - ...
```

`democast check scene.yaml` goes further without running anything: it
reports `{{env.NAME}}` variables that aren't set, `{{var}}`s used before a
step captures them, missing card images and music, a missing browser
profile, and layouts a format can't do, then summarizes the panels,
formats and narration.

democast checks a scene against
[schema/scene.schema.json](../schema/scene.schema.json) before running it:
a misspelled setting or action argument stops it with the place to fix
(`steps[4].term.run: unknown setting "comand"`). Editors with YAML
language support (VS Code's YAML extension, for one) complete and check
scene files as you type with this first line, the path relative to the
scene:

```yaml
# yaml-language-server: $schema=../democast/schema/scene.schema.json
```

`setup:` and `teardown:` are lists of steps that aren't in the video.
Setup runs before recording starts (signing in with a form, getting the
site into a starting state). Teardown runs after each take, including
one that failed, so a scene that creates something (a key, a machine, a
share) can delete it before the next format or retry; a teardown step
that fails is reported as a warning, and the rest still run.

A scene shows the browser panel if it has a `site` or any `browser.*`
step, and the terminal panel if it has any `term.*` step. With only one,
that panel gets the whole stage.

Relative paths (card images, music, the commands' working directory) are
relative to the scene file.

### Steps

Each step is a one-key mapping. Any step can also have `timeout: <ms>`,
beside the action or inside its mapping (`term.run: { cmd: ..., timeout: 5000 }`).
Strings can use `{{var}}` for captured values and `{{env.NAME}}` for
environment variables.

**Stage**

| Step | |
|---|---|
| `card: {image, title, sub, link, pills: [...], footer}` | full-screen title card. A card as the first step is shown before recording begins |
| `hideCard: {minShown: 3000}` | fade the card out, once it has been up at least `minShown` ms |
| `caption: "text"` or `{text, sub}` | caption above the panels; `""` clears it |
| `wait: 1500` | pause, ms |
| `cursor.hide:` | fade out the mouse pointer |
| `focus: browser` / `focus: term` | in 9x16, show that panel; elsewhere does nothing |
| `view: browser` / `view: term` / `view: both` | side-by-side layouts (16x9, 1x1, 4x5): show one panel alone, in the same rectangle a browser-only or terminal-only scene gets (the site re-lays itself out for the new width), while the other fades out; or both again. As the first step, the video opens on that view. Not with `pane: 2` |
| `say: "text"` or `{text, wait, voice}` | speak a line of narration; see below |

**Browser**

| Step | |
|---|---|
| `browser.open: url` or `{url, label}` | load a page |
| `browser.waitFor: "js expr"` / `{selector}` / `{text}` | wait for a JS condition, a visible element, or text on the page. `reload: N` reloads a page that isn't ready within `each` ms (default 30000), up to N times, for apps that sometimes load broken |
| `browser.click: selector` | move the pointer there and click it with the mouse; scrolls into view first |
| `browser.type: {selector, text, cps, clear, seed}` | click a field and type into it, key by key; `clear: true` replaces what's there. Without `selector`, types where the focus is. `\n` presses Enter. The pauses between keys vary; `seed: <number>` makes them the same on every take |
| `browser.fill: {selector, text}` | click a field and replace its contents at once, like a paste |
| `browser.press: key` or `{key, times}` | press a key or a combination: `Enter`, `Tab`, `Control+a` |
| `browser.waitQuiet: ms` or `{ms, selector}` | wait until the page's text has stopped changing for `ms` (default 2500), e.g. an AI's answer has finished |
| `browser.highlight: text` or `{text, selector}` | mark a passage like a highlighter pen and scroll to it, searching within `selector` if given; quotes and spacing needn't match exactly |
| `browser.unhighlight:` | remove the mark |
| `browser.scrollTo: selector` | smooth-scroll an element to the upper part of the view |
| `browser.capture: {var, selector}` / `{var, js}` | wait for a non-empty value and save it in `var`; optional `regex` keeps group 1 |
| `browser.eval: "js"` | run JavaScript in the page |
| `browser.blur: selector` / `browser.unblur:` | blur elements on the current page, and undo it |
| `browser.popup: selector` or `{click, url, trigger, unless}` | click `click` in a window the site opened, such as an OAuth sign-in, off camera: popups aren't in the video. `url` limits it to windows whose address contains it. `trigger` is a selector (or a list, for several dialogs in a row) on the site that opens the popup; it's clicked, and clicked again every few seconds while no popup appears. `unless` is a selector that, showing in any popup, means the step isn't needed (already signed in) |
| `browser.showPopup: url` | put a popup window in the browser panel, so the steps after it are filmed and act on it; `url` picks the popup whose address contains it (default: the newest). The panel goes back to the site when the popup closes, or at `browser.showMain:` |

Typing uses real key events, so it works in chat boxes and rich editors
as well as plain inputs.

Selectors are CSS, plus Puppeteer's extensions, which help on apps whose
markup you don't control: `::-p-text(Settings)` matches an element by its
text, `::-p-aria(Send)` by its accessible name, and `::-p-xpath(...)` by
XPath.

**Terminal**

| Step | |
|---|---|
| `term.run: "cmd"` | type the command, run it with `sh -c`, show its output, wait for it to exit |
| `term.run: {...}` | options below |
| `term.wait: id` | wait for a background command to exit |
| `term.waitFor: {id, regex, var}` | wait for a background command to print a match for `regex` from now on; `var` saves it (group 1 if any) |
| `term.kill: id` | stop a background command |
| `term.type: text` | type text at the prompt without running anything |
| `term.print: text` or `{text, style}` | print text; `style` is `out`, `err` or `prompt` |
| `term.clear:` | clear the terminal |

**Two terminals.** Any `term.*` step can take `pane: 2` to run in a second
terminal pane, for example a server's logs on the left and a client on the
right. The scene then shows two terminals instead of a browser, side by
side when the panel area is wider than tall and stacked otherwise. Title
the second one with `terminal2: { title: "client — bash" }`; it uses the
same font and typing speed as `terminal`.

```yaml
terminal:  { title: "server" }
terminal2: { title: "client" }
steps:
  - term.run: { cmd: docker logs -f app, background: true, id: logs }
  - term.run: { pane: 2, cmd: curl -sS https://app/ }
  - term.waitFor: { id: logs, regex: "GET /" }
```

`term.run` options:

| Option | |
|---|---|
| `cmd` | the command actually run: a string for `sh -c`, or an argv list |
| `show` | what is typed on screen (default: `cmd`); `false` to type nothing. `{{var}}` parts are pasted instantly instead of typed |
| `stdin` | text written to the command's stdin |
| `print` | which output to show: `both` (default), `stdout`, `stderr`, `none` |
| `capture: {var, regex, from}` | save the first match (group 1 if any) of `regex` in the output (`from: stdout` or `stderr`; default either) |
| `background: true` | don't wait for exit. If `capture` is set, wait for the capture instead |
| `id` | name for `term.wait` / `term.kill` |
| `env` | extra environment |
| `pane` | `2` runs it in the second terminal pane (see Two terminals) |
| `allowFail: true` | don't fail the scene on a non-zero exit |

Background commands still running at the end are killed.

## Sources: each window alone, for the edit

`--sources` (implies `--smooth`) also renders every window of the take on its
own, full frame, frame for frame in sync with the take, like OBS's Source
Record plugin:

| File | What |
|---|---|
| `<name>-<format>-browser.mp4` | the site's page, no window frame, fitted to the frame, with the pointer (mapped from the stage) |
| `<name>-<format>-terminal.mp4` | the terminal, no window frame, its font scaled up as much as the window grows |
| `<name>-<format>-terminal2.mp4` | the second pane, in scenes with `pane: 2` |
| `<name>-<format>-terminal.html`, `-terminal2.html` | each terminal as text and CSS instead of pixels (below) |
| `<name>-<format>.log/` | the replay log (site frames and stage calls, `log.json`), kept so the take can be rendered again. It holds every frame the site sent: a page that changes all the time fills about 200 MB a minute, one that mostly sits still far less. `make clean-takes` removes logs with the takes |

Smooth mode replays a log of the live run, so the sources are extra renders
of the same log: nothing is recorded twice. The site is captured at as many
device pixels as the frame is wide, so the page stays sharp on its own. Each
source is about one render's work; they run a few at a time (`-j N`,
default: a quarter of the cores, at most 4). Edits (trims) apply to the
take, not to the sources.

To keep a run of takes short (say, a pass that changes a live system and
should put it back quickly), record with `--sources-later`: it keeps the
log and the sharp site capture but renders no sources. Render them
afterwards, all at once:

```
democast sources out/                 # every <take>.log/ in out/ whose sources are missing or older
democast sources out/a-16x9.log -j 6  # one take, six at a time
democast sources --force out/         # render again
```

### Terminals as HTML

Each terminal is also written as one self-contained page, rebuilt from the
log's terminal calls (no Chrome, a fraction of a second). It's text, so it
can be copied, and it reflows: the window fills the page up to the format's
one-window width (16x9: 1400px, even for a take that split the screen into
panes), with the take's font; wider than the take's window the lines get
longer, narrower the font shrinks (to 11px) and lines wrap, rather than the
picture scaling down. It plays on
the take's clock, character for character with `-terminal.mp4` (the
typing's seeded rhythm is replayed too), and shows the final screen until
played.

- Controls: play/pause, a scrubber, speed (1×, 2×, ½×). `#t=12.5` opens at
  12.5 s; `?autoplay` plays on load.
- From script: `democastTerminal.seek(s)`, `.play()`, `.pause()`, `.duration`.
- Style: the `--dc-*` CSS variables at the top (colors, `--dc-max-w`,
  `--dc-font`, `--dc-height`); the window (`.dc-term`) and its CSS work in
  another page.

The page holds everything the terminal printed, the same as the video: with
`--no-redact`, keys and addresses are in the text.

## Remix: new videos from recorded takes

A scene with `remix: true` records nothing: it cuts clips, time ranges of
one window of a kept take (`--sources` or `--sources-later` keep
`<take>.log/`), between the usual cards, captions and narration, in any
format. A 16x9 pass becomes a 9x16 short without touching the system it
recorded:

```yaml
remix: true
formats: [9x16]
voice: { engine: kokoro, voice: am_michael }
takes:                      # short names for takes (paths from the scene's folder)
  edit: ../out/05-edit-16x9@2x
steps:
  - card: { title: You got the invite. }
  - hideCard: { minShown: 3000 }
  - caption: { text: "Their side names one tag" }
  - say: { text: "The other tailnet lists the one tag you may refer to.", wait: false }
  - clip: { take: edit, window: browser, from: 1.5, to: 9.5, zoom: { x: 0.25, y: 0.24, w: 0.42 } }
  - clip: { take: edit, window: term, from: 19.4, to: 30, speed: 1.5 }
```

| `clip` setting | |
|---|---|
| `take` | a name from `takes`, or a path: `<take>.log/`, its base name or its MP4 |
| `window` | `browser` (default), `term` or `term2` |
| `from`, `to` | seconds into the take |
| `speed` | play faster (2) or slower (0.5) |
| `zoom` | browser: the box of the page to show, `x`, `y` (its top left) and `w` (its width), as fractions of the page; its height follows from the window's shape. Consecutive boxes pan and zoom between them. Default: the whole width, from the top |
| `pan` | `false`: change to this clip's zoom box at once instead of panning (e.g. where the page itself jumped) |
| `pointer` | `false` hides the take's pointer |
| `title` | terminal: the window's title (default: the take's) |

Console clips are the take's own frames, cropped; capture is sharp enough to
zoom to about half the width at 1080 wide (more with `-s 2`). Terminal clips
are laid out again from the log's text in the new window, starting with the
screen as it was at `from`. The other steps are `card`, `hideCard`,
`caption`, `say`, `wait` and `cursor.hide`. A remix renders like a smooth
take (a minute or two for a minute), with narration, subtitles, contact
sheet and edits; `democast render` re-renders it with new edits.

## Narration

`say` steps add a voice-over. All lines are synthesized before recording
starts, so the runner knows each clip's length:

```yaml
- say: "Open the page and create a listener."               # waits until the line ends
- say: { text: "Then send to it from a terminal.", wait: false }  # keeps going while it plays
- say: { text: "Bonjour !", voice: { voice: ff_siwis, lang: fr-fr } }  # per-line voice override
```

With `wait: false`, the next steps run while the line plays, so speech can
run over clicks and typing. A line never starts before the previous one
has finished, so lines don't overlap even if the actions are faster than
the speech. Lines can't use `{{variables}}`, since they are synthesized
before anything runs.

Clips are cached in `out/.cache/tts`, keyed by text and voice settings,
so re-recording a take doesn't re-synthesize anything. Each take keeps
copies of its own clips, so clearing the cache (`make clean-tts`) doesn't
stop it from rendering. Narration is
placed at the moments its steps ran. Music is ducked under it, and the
mix is normalized to -16 LUFS. Each render also writes an `.srt` file with
the narration, for platforms that take uploaded captions.

The `kokoro` and `vibevoice` engines are Python scripts in `tts/` that run
with [uv](https://docs.astral.sh/uv/). On first use, uv installs their
dependencies into a cached environment, and the script downloads the model.

| `voice:` setting | |
|---|---|
| `engine` | `kokoro` (default), `vibevoice` or `command` |
| `voice` | voice name for the engine |
| `pronounce` | respellings used only for speech, e.g. `{ tailground: Tail ground }`. Subtitles keep the original |
| `volume` | narration gain (default 1) |

**kokoro**: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) on ONNX
Runtime. CPU-only, no PyTorch, about 330 MB of model files, and much faster
than real time. Settings:
- `voice`: e.g. `af_heart`, `af_bella`, `am_michael`, `am_adam`, `bf_emma`, `bm_george`. An unknown name lists them all.
- `speed`: default 1.0.
- `lang`: `en-us`, `en-gb`, `fr-fr`, `ja`, `cmn` and others.
- `model`: `fp32` (default) or `int8`, which is a 90 MB download with slightly lower quality.

**vibevoice**: Microsoft's
[VibeVoice-Realtime-0.5B](https://github.com/microsoft/VibeVoice/blob/main/docs/vibevoice-realtime-0.5b.md).
It sounds more natural and expressive, but it is heavier: PyTorch plus
about 2 GB of model, and a GPU is recommended. Settings:
- `voice`: a preset, such as `Carter`, `Davis`, `Emma`, `Frank`, `Grace`, `Mike` or `Samuel`, or a non-English preset like `de-Spk1_woman`.
- `device`: `cuda` or `cpu`.
- `dtype`: on GPUs, `bfloat16` where supported, else `float16`, which fits a 4 GB card; `float32` on CPU.
- `cfg`: guidance scale, default 1.5.
- `steps`: diffusion steps, default 5.

Microsoft releases VibeVoice for research and development, and asks that
AI-generated speech be disclosed when shared. A line like "Narration is
AI-generated" in the post covers it.

**command**: any program that reads the text on stdin and writes a WAV to
`{out}`, for example [Piper](https://github.com/OHF-Voice/piper1-gpl):

```yaml
voice: { engine: command, command: "piper -m en_US-lessac-medium.onnx -f {out}" }
```

## Examples

[examples.md](../examples.md) shows every way to use democast, with a scene and
a screenshot for most. The scenes are in [docs/scenes/](scenes/) and
run against a local demo site (`make docs-site`); `make doc-images` redoes
the screenshots.

## Running in CI

To keep a video in step with a UI, re-record it on release. Because every
step waits for real conditions, a recording run is also an end-to-end smoke
test:

```yaml
# .github/workflows/demo-video.yml
on: { release: { types: [published] }, workflow_dispatch: {} }
jobs:
  video:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: astral-sh/setup-uv@v6   # for narration
      - run: sudo apt-get update && sudo apt-get install -y ffmpeg fonts-noto-color-emoji
      - run: npm ci && node src/cli.js -r 2 examples/tailground.yaml
        env: { CHROME_PATH: /usr/bin/google-chrome }
      - uses: actions/upload-artifact@v4
        with: { name: demo-video, path: out/ }
```

## Limits

- Timing follows real time, so network delays show up in the video. Steps
  wait on conditions rather than fixed delays, so a slow take is still
  correct, just longer.
- CSS selectors break when the site's markup changes. Stable hooks such as
  `data-demo="..."` attributes on the elements a scene uses help.
- With `--smooth`, the live stage isn't drawn at full resolution and
  doesn't show the site, so `--headed` shows little; the error screenshot
  is of the site instead.
- Windows isn't supported: commands run with `sh -c`, and stopping them
  relies on Unix process groups.
- Two terminal panes at most (`pane: 2`), and a scene with two can't also
  show the browser. Background commands share a pane with foreground ones.

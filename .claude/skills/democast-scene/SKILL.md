---
name: democast-scene
description: Create, debug, record, edit or remix democast demo videos from YAML scenes and saved takes. Use for web app and CLI demos, shot or reshoot scenes, narration, source exports, and troubleshooting democast output.
---

# Working with democast scenes and takes

A live scene is a YAML script that drives headless Chrome and real terminal
commands, then records MP4s. It must run unattended from a known state.
A remix scene instead reuses recorded activity, without touching the live
system. Choose the workflow before executing commands.

Resolve this skill's real filesystem location first (follow symlinks); the
checkout is three directories above its folder. Use that checkout's
[reference](../../../docs/reference.md), [scene schema](../../../schema/scene.schema.json)
and `node <checkout>/src/cli.js --help` as the current references. Read the
reference's "Steps" section before using unfamiliar actions. If documentation
and schema disagree, verify with `democast check` and the implementation.
Run `democast` if linked to this checkout, otherwise use the CLI path above.

## Choose the workflow

- **New or changed live activity:** use the recording loop below.
- **Trim, speed up, overlay text or adjust audio on an existing take:** use
  `democast edit` and `democast render`; no live execution is needed.
- **New story, format or narration using captured activity:** create a
  `remix: true` scene referencing kept replay logs.
- **Individual browser/terminal videos or playable terminal HTML:** record
  with `--sources` or `--sources-later`, then use `democast sources`.
- **Audition narration:** use `--voice-only` before recording.

For these production workflows and CLI options, read
[production.md](references/production.md). It covers quality, sources,
remixing, edits, audio and artifacts; consult only the relevant sections.
For CI recording, read the reference's "Running in CI" section and supply the
same dependencies, credentials and reset state as a local run.

## Recording loop

Validate with `check` first, then run and inspect a take when execution is
within the user's scope and dependencies are available. Report exactly what
was verified; if only authoring was requested or execution is blocked, hand
over the scene with the unverified parts identified. For live recording:

1. **Know what the viewer should see, and the state it starts from.**
   One line: "the key is created in the console, then used from a
   terminal; the node appears on Machines". Also: what must be signed in,
   what must exist, what the scene creates, and how that's undone. If the
   project has a `PLAYBOOK.md` or a reshoot reference with a shot table,
   follow it; it decides naming, stages and the harness.
2. **Look at the real page before writing selectors.** Don't guess
   markup. democast prints every captured value, so a throwaway scene
   lists a page's controls (add the real scene's `browser:` settings for
   a signed-in site, and the steps that get to the page):
   ```yaml
   site: https://app.example.com/settings
   steps:
     - browser.capture:
         var: controls
         js: "[...document.querySelectorAll('a,button,[role=button],input,select,textarea,[role=tab],[role=menuitem]')].map((e) => `${e.tagName.toLowerCase()} \"${(e.innerText || e.getAttribute('aria-label') || e.placeholder || '').trim().slice(0, 60)}\"`).join('\\n') || 'none'"
   ```
   Run it with `--no-voice -f 16x9` and pick selectors from what it
   prints (`controls = a "Learn more"` ...). Its contact sheet shows the
   page too. Redaction applies to what's printed.
3. **Draft the scene** (skeleton below).
4. **`democast check scene.yaml`.** It needs no Chrome. It catches
   misspelled settings, unset `{{env.X}}`, `{{var}}`s used before a step
   captures them, missing files, a missing profile and impossible
   layouts. Fix everything it reports.
5. **A quick take:** `democast --no-voice -f 16x9 -o out scene.yaml`
   (`make silent SCENE=... FORMAT=16x9` in the democast checkout).
6. **Look at the result.** Read `out/<name>-16x9-sheet.png` (12 frames of
   the take) as an image. On failure, read the error and
   `out/<name>-16x9-error.png`, the moment it failed. Check pacing (is the
   payoff on screen long enough to read?) and framing. The sheet samples
   only 12 frames; inspect playback around sensitive data and transitions
   to assess redaction. Do not treat a clean sheet as proof for every frame.
7. Fix and repeat from 4. For a reusable scene, run it again from the
   documented start state when repeat execution is authorized and cleanup
   succeeded. If cleanup fails or the state is uncertain, resolve that
   before retrying. Then record the requested formats with narration.

`--headed` shows the browser while it runs, for debugging by eye.
`-r 2` retries a failed take, for flaky networks; don't use it to hide a
scene that fails half the time.

## Skeleton

```yaml
# yaml-language-server: $schema=<path to democast>/schema/scene.schema.json
# What the viewer sees, in one line.
# Needs: <signed-in profile, things that must exist, scenes that run first>.
# Changes: <what it creates>; teardown/zz-*.yaml puts it back.
site: https://app.example.com/dashboard
siteLabel: app.example.com          # what the URL bar shows
browser:
  profile: example-demo             # signed in once with: democast login scene.yaml
formats: [16x9]
redact: [email, keys]               # presets: email, tailnet, tailscale-ip, tailscale-ipv6, keys
terminal: { title: "~/project — bash", fontSize: 21, cps: 55 }
setup:                              # off camera, before recording
  - browser.waitFor: { text: Dashboard, reload: 3 }
steps:                              # on camera
  - view: browser
  - browser.click: "::-p-text(New key)"
  - browser.waitFor: { selector: "[role=dialog]" }
  - wait: 800
  - browser.capture: { var: key, selector: "[role=dialog] code" }
  - view: both
  - term.run:
      show: export API_KEY={{key}}          # what the viewer reads
      cmd: printf '%s' "$KEY" > ../state/api.key
      env: { KEY: "{{key}}" }
  - term.run: ./bin/client list
  - browser.highlight: my-client            # the payoff
  - wait: 3000                              # let it sit
teardown:                           # after every take, even a failed one
  - term.run: { cmd: ./bin/cleanup, show: false, allowFail: true }
```

The scene's top comment is part of the scene: say what it shows, what it
needs and what it changes, and comment any step whose reason isn't
obvious ("some's chat box crashes if its side panel is closed").

## Waiting: conditions, not time

- Every step that depends on the page changing waits for it:
  `browser.waitFor` (`{selector}`, `{text}`, or a JS expression),
  `browser.capture` (waits for a non-empty value), `term.waitFor` (a regex
  in a background command's output). A slow take is then longer, not
  broken.
- `wait: ms` is only for the viewer: time to see what happened. Typical:
  500-800 after a click, 800-1200 after a dialog opens, 2000-3000 holding
  a payoff (a highlighted row, a denied request) before the scene ends.
- **Flaky apps:** wait for "healthy for N seconds", not "loaded once",
  and reload a bounded number of times:
  ```yaml
  - browser.waitFor:
      js: "(() => { const ok = !document.body.innerText.includes('Something went wrong') && !!document.querySelector('textarea'); if (!ok) { window.__okSince = 0; return false; } window.__okSince ||= Date.now(); return Date.now() - window.__okSince > 4000; })()"
      reload: 5
  ```
- **Eventually consistent pages** (a new node showing up on a list):
  `browser.waitFor: { text: hello-share, reload: 5, each: 6000 }`.
- **AI answers streaming in:** `browser.waitQuiet: 2500`.
- Slow steps get their own `timeout` (ms), on the step or inside its
  mapping. The default is 60000 (the scene's `timeout`). Don't set a
  timeout shorter than the default without a reason.

## Selectors

Prefer, in order:

1. Text the viewer sees: `"::-p-text(Generate auth key)"`, scoped when
   it's ambiguous: `"[role=dialog] button::-p-text(Continue)"`,
   `"[role=option]::-p-text(All - Read & Write)"`.
2. Accessible names and roles: `"::-p-aria(Send)"`,
   `"button[aria-label=Settings]"`, `"[role=menuitem]::-p-text(Remove)"`.
3. Stable attributes: ids, `data-testid`, `placeholder`
   (`"input[placeholder='Add tags']"`).
4. XPath (`"::-p-xpath(...)"`) when the relation matters:
   - **The newest match**, so a stale dialog left by a failed take isn't
     the one clicked: `"::-p-xpath((//button[normalize-space(.)='Disconnect'])[last()])"`.
   - **A checkbox by its label:** `"::-p-xpath(//label[normalize-space(.)='Reusable']/ancestor::*[.//input[@type='checkbox']][1]//input[@type='checkbox'])"`.
   - **A row's menu:** `"::-p-xpath(//tr[.//a[normalize-space(.)='hello-share']]//button[@aria-haspopup='menu'])"`.

Avoid generated class names (`.css-1x2y3z`) and positional CSS paths.

Comboboxes: click the combobox, `browser.waitFor: { selector: "[role=option]" }`,
then click the option. Code editors (CodeMirror, Monaco): place the cursor
with `browser.eval`, then `browser.type` without a selector, and check the
result by reading the editor's value back in a `browser.waitFor`.

## Additional actions and configuration

Read the reference's action tables and schema for argument forms and defaults:

- Navigation and input: `browser.open` (optional URL-bar label),
  `browser.click`, `browser.fill`, `browser.type` (`clear`, `cps`, `seed`),
  and `browser.press` (key combinations and `times`).
- Framing: `browser.scrollTo`, `browser.highlight` (text, scope and color),
  `browser.unhighlight`, `cursor.hide`, `browser.blur`, `browser.unblur`.
  Highlight scopes and blur selectors use DOM CSS selectors; do not assume
  every action supports Puppeteer's extended selector syntax.
- Terminal presentation: `term.type` types without execution, `term.print`
  writes output with a `style`, and `term.clear` clears a pane.
- Browser configuration: `browser.loginUrl` accepts one URL or a list;
  `browser.auth` supplies HTTP basic auth and `browser.headers` adds request
  headers. Source credentials from `{{env.NAME}}`. Use a string profile
  name; the current schema does not accept `browser.profile: true`.
- Scene configuration: `name` controls the output prefix, `env` augments
  terminal environments, and `fps` sets the default capture/render rate.
  `noBlur` is an internal setting used by `--no-redact`; it is not a
  substitute for clearing all redaction rules.

## Values between the browser and the terminal

- Capture with `browser.capture` (`{var, selector}` or `{var, js}`,
  `regex` keeps group 1) or `term.run`'s `capture: {var, regex}`; use as
  `{{var}}` in later steps.
- A value shown in a dialog may be in an input's `value`, not its text;
  read both:
  `js: "(() => { const d = document.querySelector('[role=dialog]'); if (!d) return null; const all = d.innerText + ' ' + [...d.querySelectorAll('input,textarea')].map((i) => i.value).join(' '); return (all.match(/tskey-auth-[\\w-]+/) || [])[0] || null; })()"`
- **Pass captured values to commands through `env`, not by pasting them
  into `cmd`:** `cmd: printf '%s' "$KEY" | ./save`, `env: { KEY: "{{key}}" }`.
  Pasting a value into a shell command breaks on quotes and spaces.
- `show` is what the viewer reads; `cmd` is what runs. Show the clean
  form (`tscurl https://hello-tsnet.$TAILNET/`), run the real one (full
  paths, `-dir` flags, `2>/dev/null`).
- `say` lines can't use `{{variables}}` (they're synthesized before the
  run).

## Terminal

- A string `term.run.cmd` runs in a new `sh -c`; an argv list such as
  `cmd: [node, script.js]` executes directly without shell expansion.
  Shell variables and `cd` don't carry over between commands. Keep state in files (a `state/` directory, `umask 077`,
  git-ignored), behind a small helper script (`./guide.sh save app.key`).
- Commands run in the scene's directory. Use relative paths, not
  `/home/...`.
- Long-running things (servers, watchers, `tail -f`):
  `term.run: { cmd: ..., background: true, id: watch }`, then
  `term.waitFor: { id: watch, regex: 'devices:' }`, and `term.kill: watch`
  if it should stop on camera. Background commands still running at the
  end are killed.
- democast expands `{{name}}` and dotted names, and fails on unknown
  names matching that syntax, so
  `docker --format '{{.Size}}'` or Go templates need another form
  (`--format json | jq`).
- Quote YAML values containing `: ` (`Authorization: Bearer ...`), or use
  `>-` for long commands. Otherwise the scene fails to load.
- `allowFail: true` for commands whose failure is the point (a denied
  request) or doesn't matter (cleanup).
- Interactive programs (vim, REPLs, prompts, ssh sessions) can't be
  driven; give answers on `stdin`, or use a non-interactive form.
- Two terminals: `pane: 2` on `term.run`, `term.type`, `term.print` or
  `term.clear` (then no browser panel); `terminal2.title` names the second
  pane. `term.wait`, `term.waitFor` and `term.kill` select a process by ID.
- `term.waitFor` matches new output from that step onward. To capture
  startup output reliably, use `term.run.capture`; with `background: true`,
  the run waits for that capture before continuing. `capture.from` chooses
  stdout or stderr; `print` chooses `both`, `stdout`, `stderr` or `none`.

## Signing in, popups and secrets

- Sites behind a login: `browser.profile` plus a one-time
  `democast login scene.yaml` by hand. Plain email-and-password forms can
  sign in in `setup` with `browser.fill` and `{{env.PASSWORD}}`. Never put
  a password or token in the scene file.
- Google sessions: `browser.saveSession: true` on every scene that shares
  the profile, or Google signs the profile out after a few takes. Google
  refuses to sign in inside a recording at all.
- OAuth and other popups: `browser.popup: { url, click, trigger, unless }`
  clicks through a popup off camera. `browser.showPopup: url` films it
  instead, until it closes or `browser.showMain:`.
- `redact:` hides matching text on screen (terminal, URL bar, page), as
  it streams in too: presets plus `{ text: "{{env.DEMO_EMAIL}}", with: you@example.com }`
  and `{ regex: ..., with: ... }`. It can't see text in images or form
  fields; blur those with `browser.blur: selector` or `browser: { blur: [...] }`.
  Inspect the contact sheet and playback around sensitive steps. Existing
  recorded pixels cannot be re-redacted by changing the scene settings;
  record again with the required redaction.
- Keys made on camera are real: revoke them in `teardown` or a cleanup
  scene.

## State and side effects

- A scene that creates something (a key, a node, a share, a policy edit)
  must leave the system so the next take starts the same way: delete it
  in `teardown` (runs after every take, including failed ones; a failing
  teardown step is only a warning), or in a separate cleanup scene the
  harness runs.
- Save "before" state first (capture the policy, write it to `state/`),
  so cleanup can put it back.
- Name things so a leftover doesn't rename the next take's on screen
  (`probe` becoming `probe-1`): delete leftovers before recording.
- In a multi-shot project, off-camera work (connecting, resetting,
  applying a policy) goes in `setup:` or its own off-camera scene
  (`setup/*.yaml`, `zz-*.yaml` are possible conventions). Follow an existing
  project harness if present; check its starting-state and cleanup behavior.

## Layout and story

- `view: browser` / `view: term` / `view: both` (16x9, 1x1, 4x5) shows
  one panel large while the other isn't needed. `layout: max` gives a
  one-panel scene the whole frame.
- 9x16 defaults to one panel at a time. Set `autoFocus: false` and use
  `focus: browser` / `focus: term` for manual switching. The schema accepts
  `layout: both`, but the current 9x16 format has no stacked layout: run
  `check -f 9x16` before promising that combination. Check framing with
  `--guides`; platform overlays can change.
- `browser.scale` and `terminal.fontSize` accept per-format maps. These
  change content size; CLI `--scale` changes output pixel density.
  `theme` overrides stage CSS colors; read the reference before styling.
- For a standalone video: a `card` first, `hideCard: { minShown: 3000 }`
  after the page is ready, `caption` per beat, `say` lines with
  `wait: false` so narration runs over the actions. `voice.pronounce`
  fixes how names are spoken. In a project where narration and titles
  are added in the edit, leave them out.
- Keep a scene to one beat of the story. Several short scenes are easier
  to retake than one long one.

## Before calling it done

- [ ] `democast check` reports no problems
- [ ] Live runs and repeatability were checked as appropriate; any unrun
      checks are disclosed
- [ ] The requested formats show a readable payoff; playback and audio
      were checked as appropriate, beyond the sampled contact sheet
- [ ] What it creates is cleaned up, and keys made on camera are revoked
- [ ] The top comment says what it shows, needs and changes

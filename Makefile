# democast Makefile. Run "make" or "make help" for the list of targets and
# variables. Every democast flag has a variable, so any target can be tuned
# on the command line, e.g.:
#
#   make record FORMAT=9x16,4x5 VOICE=vibevoice:Emma RETRIES=2
#   make edit SCENE=demos/mytool.yaml OPEN=1

NODE    ?= node
NPM     ?= npm
CLI     := $(NODE) src/cli.js

# --- Variables (one per democast flag) --------------------------------------

SCENE   ?= examples/tailground.yaml## scene file to record, render or edit
FORMAT  ?=## formats, comma-separated: 16x9, 9x16, 4x5, 1x1 (default: the scene's)
OUT     ?= out## output directory
RETRIES ?=## re-record a failed take up to N times
VOICE   ?=## narration voice override, ENGINE[:VOICE], e.g. kokoro:af_heart, vibevoice:Carter
SCALE   ?=## resolution multiplier; 2 is 4K
CHROME  ?=## Chrome/Chromium binary (default: $CHROME_PATH or autodetect)
PORT    ?=## editor port (default: 7717)
PROFILE ?=## login: browser profile name (default: the scene's browser.profile, else its name)
NO_VOICE ?=## 1: skip narration
GUIDES  ?=## 1: shade the areas TikTok/Reels/Shorts UI covers
HEADED  ?=## 1: show the browser while recording
QUIET   ?=## 1: don't print each step
OPEN    ?=## 1: open the editor in the default browser

# FLAGS turns the variables above into democast flags; EXTRA passes anything
# else through verbatim. BASE_FLAGS leaves out the voice, for targets that
# pick the engine themselves.
BASE_FLAGS = $(if $(FORMAT),-f $(FORMAT)) \
        $(if $(OUT),-o $(OUT)) \
        $(if $(RETRIES),-r $(RETRIES)) \
        $(if $(SCALE),-s $(SCALE)) \
        $(if $(CHROME),--chrome "$(CHROME)") \
        $(if $(filter 1,$(NO_VOICE)),--no-voice) \
        $(if $(filter 1,$(GUIDES)),--guides) \
        $(if $(filter 1,$(HEADED)),--headed) \
        $(if $(filter 1,$(QUIET)),-q) \
        $(EXTRA)
FLAGS = $(BASE_FLAGS) $(if $(VOICE),--voice $(VOICE))
# VOICE_NAME is VOICE without an engine prefix: "vibevoice:Emma" -> "Emma".
VOICE_NAME = $(lastword $(subst :, ,$(VOICE)))
EDIT_FLAGS = $(if $(OUT),-o $(OUT)) $(if $(PORT),--port $(PORT)) $(if $(filter 1,$(OPEN)),--open) $(EXTRA)

.DEFAULT_GOAL := help
.PHONY: help install check test lint typecheck \
        docs-site doc-images demo-video site record render edit login check-scene 16x9 9x16 4x5 1x1 4k guides silent voice-only kokoro vibevoice \
        clean clean-videos clean-takes clean-tts distclean

# --- Help ---------------------------------------------------------------------

help: ## show this help
	@echo "usage: make <target> [VARIABLE=value ...]"
	@echo
	@echo "Targets:"
	@grep -hE '^[a-zA-Z0-9_ -]+:.*## ' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*## "} {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "Variables:"
	@grep -hE '^[A-Z_]+ +\?=.*## ' $(MAKEFILE_LIST) | \
		sed -E 's/^([A-Z_]+) +\?= *([^#]*)## (.*)/\1\t\2\t\3/' | \
		awk -F'\t' '{d = ($$2 == "") ? "" : " [" $$2 "]"; printf "  \033[36m%-20s\033[0m %s%s\n", $$1, $$3, d}'
	@echo "  EXTRA                any other democast flags, passed through verbatim"
	@echo
	@echo "Examples:"
	@echo "  make record FORMAT=9x16,4x5 VOICE=vibevoice:Emma RETRIES=2"
	@echo "  make 4k FORMAT=16x9"
	@echo "  make edit OPEN=1"

# --- Setup --------------------------------------------------------------------

node_modules: package.json package-lock.json
	$(NPM) ci
	@touch $@

install: node_modules ## install dependencies

check: ## check that the tools democast needs are installed
	@ok=1; \
	printf '%-10s' node:;   $(NODE) --version 2>/dev/null || { echo 'missing (need Node 20+)'; ok=0; }; \
	printf '%-10s' ffmpeg:; if command -v ffmpeg >/dev/null; then ffmpeg -version | head -1 | cut -d' ' -f3; else echo missing; ok=0; fi; \
	printf '%-10s' chrome:; \
	c="$(CHROME)"; [ -n "$$c" ] || c="$$CHROME_PATH"; \
	if [ -n "$$c" ]; then \
		if [ -x "$$c" ]; then echo "$$c"; else echo "$$c: not found or not executable"; ok=0; fi; \
	else \
		for p in /usr/bin/google-chrome /usr/bin/google-chrome-stable /usr/bin/chromium /usr/bin/chromium-browser \
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do \
			[ -x "$$p" ] && { echo "$$p"; c="$$p"; break; }; done; \
		[ -n "$$c" ] || { echo 'missing (set CHROME or CHROME_PATH)'; ok=0; }; \
	fi; \
	printf '%-10s' uv:;     uv --version 2>/dev/null || echo 'missing (only needed for kokoro/vibevoice narration)'; \
	printf '%-10s' fonts:;  fc-match -f '%{file}\n' 'sans-serif:bold' 2>/dev/null || echo 'fc-match missing (needed for text overlays)'; \
	printf '%-10s' gpu:;    nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || echo 'none found (vibevoice will run on CPU)'; \
	[ $$ok = 1 ]

test: node_modules ## run the unit tests
	$(NPM) test

lint: node_modules ## check the code with ESLint
	$(NPM) run lint

typecheck: node_modules ## check the code's types with tsc
	$(NPM) run typecheck

# --- Recording ------------------------------------------------------------------

record: node_modules ## record takes of SCENE and render them (FORMAT, VOICE, SCALE, ...)
	$(CLI) record $(strip $(FLAGS)) $(SCENE)

16x9 9x16 4x5 1x1: node_modules ## record just that format, e.g. "make 9x16"
	$(CLI) record $(strip $(FLAGS) -f $@) $(SCENE)

4k: node_modules ## record at 4K (3840x2160 for 16x9)
	$(CLI) record $(strip $(FLAGS) --4k) $(SCENE)

guides: node_modules ## record 9x16 with the platform UI areas shaded, to check a layout
	$(CLI) record $(strip $(FLAGS) $(if $(FORMAT),,-f 9x16) --guides) $(SCENE)

silent: node_modules ## record without narration, for quick takes
	$(CLI) record $(strip $(FLAGS) --no-voice) $(SCENE)

# --- Narration ------------------------------------------------------------------

voice-only: node_modules ## synthesize the narration and list the clips; don't record
	$(CLI) record $(strip $(FLAGS) --voice-only) $(SCENE)

kokoro: node_modules ## audition the narration with Kokoro (light, CPU); VOICE=af_heart etc.
	$(CLI) record $(strip $(BASE_FLAGS) --voice kokoro$(if $(VOICE),:$(VOICE_NAME)) --voice-only) $(SCENE)

vibevoice: node_modules ## audition the narration with VibeVoice (GPU); VOICE=Emma etc.
	$(CLI) record $(strip $(BASE_FLAGS) --voice vibevoice:$(or $(VOICE_NAME),Carter) --voice-only) $(SCENE)

# --- Editing --------------------------------------------------------------------

edit: node_modules ## open the timeline editor for SCENE (PORT, OPEN=1)
	$(CLI) edit $(strip $(EDIT_FLAGS)) $(SCENE)

login: node_modules ## sign in to the scene's site in a Chrome window and save the session (PROFILE)
	$(CLI) login $(strip $(if $(PROFILE),--profile $(PROFILE)) $(if $(CHROME),--chrome "$(CHROME)") $(EXTRA)) $(SCENE)

check-scene: node_modules ## check SCENE without running it: settings, variables, files, layouts
	$(CLI) check $(strip $(if $(FORMAT),-f $(FORMAT)) $(if $(OUT),-o $(OUT)) $(EXTRA)) $(SCENE)

render: node_modules ## re-render recorded takes with the current edits; no re-recording
	$(CLI) render $(strip $(if $(FORMAT),-f $(FORMAT)) $(if $(OUT),-o $(OUT)) $(EXTRA)) $(SCENE)

# --- Documentation images -----------------------------------------------------

docs-site: ## serve the demo site the examples in examples.md run against (http://127.0.0.1:7799/)
	$(NODE) scripts/docs-site.mjs

# SCENES limits it to some scenes: make doc-images SCENES="forms popup"
SCENES ?=## doc-images: scene names in docs/scenes/ to redo (default: all)
doc-images: ## record docs/scenes/*.yaml against the demo site and save screenshots to docs/img/
	$(NODE) scripts/doc-images.mjs $(SCENES)

demo-video: ## record docs/demo/demo.yaml against the demo site, saving docs/demo/demo.mp4 for the web page
	$(NODE) scripts/demo-video.mjs

# REPO is the repository's URL: links in the page to files in it point there.
REPO ?=## site: the repository's URL, for links to its files (default: they are plain text)
site: ## build the project's web page into _site/ (open _site/index.html)
	$(NODE) scripts/build-site.mjs $(if $(REPO),--repo $(REPO))

# --- Cleaning -------------------------------------------------------------------

clean: clean-videos ## remove rendered videos (keeps takes, so "make render" still works)

clean-videos: ## remove rendered MP4s, contact sheets, subtitles and error screenshots
	rm -f $(OUT)/*.mp4 $(OUT)/*-sheet.png $(OUT)/*.srt $(OUT)/*-error.png

clean-takes: ## remove recorded takes (raw captures, timings, narration, replay logs); needs a re-record
	rm -f $(OUT)/*.raw.mkv $(OUT)/*.raw.new.mkv $(OUT)/*.take.json $(OUT)/*.take.mp4
	rm -rf $(OUT)/*.narration $(OUT)/*.log

clean-tts: ## remove cached narration clips (takes keep their own copies)
	rm -rf $(OUT)/.cache/tts

distclean: ## remove the whole output directory and node_modules
	rm -rf $(OUT) node_modules

// Types shared across the project, as JSDoc typedefs for `tsc` (npm run
// typecheck). This file has no code: other files refer to its types with
// import('./types.js').Name.

/** A function that reports progress, one line at a time. */
/** @typedef {(message: string) => void} Logger */

/**
 * A rectangle on the stage, in stage pixels.
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 */

/**
 * One step of a scene: an action (its key) and the action's argument,
 * plus an optional timeout.
 * @typedef {{ timeout?: number, [action: string]: any }} Step
 */

/**
 * A setting that is one value or one per format, e.g. scale: 1.1 or
 * scale: { 16x9: 1.2, 1x1: 0.9 }.
 * @template T
 * @typedef {T | Record<string, T>} PerFormat
 */

/**
 * The scene's browser panel settings.
 * @typedef {object} BrowserSettings
 * @property {PerFormat<number>} [scale]
 * @property {string} [profile] a profile saved with `democast login`
 * @property {string | string[]} [loginUrl]
 * @property {{ username: string | number, password: string | number }} [auth]
 * @property {Record<string, string | number>} [headers]
 * @property {string | string[]} [blur] selectors to blur from the first paint
 * @property {boolean} [saveSession]
 */

/**
 * The scene's terminal settings.
 * @typedef {object} TerminalSettings
 * @property {string} [title]
 * @property {PerFormat<number>} [fontSize]
 * @property {number} [cps] characters typed per second
 */

/**
 * The scene's narration voice (and a say step's overrides of it).
 * @typedef {object} VoiceSettings
 * @property {'kokoro' | 'vibevoice' | 'command'} [engine]
 * @property {string} [voice]
 * @property {string} [command]
 * @property {Record<string, string>} [pronounce]
 * @property {number} [volume]
 * @property {number} [speed]
 * @property {string} [lang]
 * @property {'fp32' | 'int8'} [model]
 * @property {string} [device]
 * @property {string} [dtype]
 * @property {number} [cfg]
 * @property {number} [steps]
 */

/**
 * A redact entry: a preset name, or text or a regex with what replaces it.
 * @typedef {string | { text?: string | number, regex?: string, with?: string | number, ignoreCase?: boolean }} RedactEntry
 */

/**
 * A scene, as loaded from YAML (schema/scene.schema.json). `name` is set
 * from the file name when the scene has none.
 * @typedef {object} Scene
 * @property {string} name
 * @property {Step[]} steps
 * @property {Step[]} [setup]
 * @property {Step[]} [teardown]
 * @property {string | string[]} [formats]
 * @property {string} [site]
 * @property {string} [siteLabel]
 * @property {boolean} [remix]
 * @property {number} [fps]
 * @property {number} [timeout] default per-step timeout, ms
 * @property {'focus' | 'both' | 'max'} [layout]
 * @property {boolean} [autoFocus]
 * @property {boolean} [noBlur] set by --no-redact
 * @property {Record<string, string | number>} [env]
 * @property {Record<string, string>} [takes]
 * @property {BrowserSettings} [browser]
 * @property {TerminalSettings} [terminal]
 * @property {{ title?: string }} [terminal2]
 * @property {Record<string, string>} [theme] stage CSS colors
 * @property {VoiceSettings} [voice]
 * @property {string | { file: string, volume?: number }} [music]
 * @property {RedactEntry[]} [redact]
 */

/**
 * The stage's configuration for one format and scene (formats.js
 * stageConfig): sent to the stage page as stage.init's argument.
 * @typedef {object} StageConfig
 * @property {number} w
 * @property {number} h
 * @property {number} bar
 * @property {(Rect & { scale: number }) | null} browser
 * @property {Rect | null} term
 * @property {Rect | null} term2
 * @property {Record<string, Record<string, Rect>> | null} views
 * @property {{ top: number, right: number, bottom: number, left: number, rail?: { y: number, w: number } } | null} safe
 * @property {boolean} focus
 * @property {boolean} guides
 * @property {string} termTitle
 * @property {string} term2Title
 * @property {number} termFont
 * @property {number} termPadRight
 * @property {any} caption
 * @property {any} card
 * @property {number} cardScale
 * @property {any} theme
 */

/**
 * A step as the take recorded it, for the timeline.
 * @typedef {{ i: number, action: string, label: string, start: number, end?: number }} TakeStep
 */

/**
 * A narration clip placed on a take's timeline (seconds).
 * @typedef {{ file: string, text: string, start: number, duration: number }} NarrationClip
 */

/**
 * A take: one recording of one format (<base>.take.json), read by readTake.
 * @typedef {object} Take
 * @property {string} base
 * @property {string} scene
 * @property {string} format
 * @property {number} scale
 * @property {number} width
 * @property {number} height
 * @property {{ top: number, right: number, bottom: number, left: number } | null} [safe]
 * @property {number} fps
 * @property {number} duration
 * @property {string} [recorded] ISO time the take was recorded
 * @property {boolean} [remix]
 * @property {TakeStep[]} steps
 * @property {NarrationClip[]} [narration]
 */

/**
 * A call logged for the replay: a stage function and its arguments, at t
 * (ms on the Date.now() clock).
 * @typedef {{ t: number, fn: string, args: any[] }} LogEvent
 */

/**
 * A site frame kept for the replay: a JPEG file, at t.
 * @typedef {{ t: number, file: string }} LogFrame
 */

/**
 * What renderStage replays: calls and frames (see replay.js).
 * @typedef {{ events: LogEvent[], frames: LogFrame[] }} ReplayLog
 */

/**
 * Edits in resolved form: seconds in one take (see edits.js).
 * @typedef {{ audio: { voice?: number, music?: number }, trim: { start?: any, end?: any }, regions: any[] }} Edits
 */

export {};

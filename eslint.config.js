import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'out/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  // Pages and code that runs inside them.
  {
    files: ['src/editor/app.js', 'src/editor/ui/*.js', 'src/redact.js', 'src/replay.js', 'src/runner.js', 'src/context.js', 'src/site.js', 'src/actions/browser.js', 'src/browser.js', 'src/recorder.js', 'scripts/crash-probe.mjs', 'test/redact-page.test.js', 'test/editor-ui.test.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];

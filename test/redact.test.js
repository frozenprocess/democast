import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactRules, redactText, redactStageArgs, lineBuffer, checkRedact } from '../src/redact.js';

test('presets and literal text', () => {
  const rules = redactRules(['email', 'tailnet', 'tailscale-ip', { text: '{{env.ME}}', with: 'me' }], (s) => s.replace('{{env.ME}}', 'User'));
  assert.equal(
    redactText(rules, 'someone@example.com on some-probe.tail1a2b3c.ts.net at 100.101.7.9, by User'),
    'you@example.com on some-probe.tailXXXX.ts.net at 100.x.y.z, by me',
  );
  // 100.x outside the CGNAT range is left alone.
  assert.equal(redactText(rules, '100.200.1.1'), '100.200.1.1');
});

test('no "with" blocks out the match', () => {
  assert.equal(redactText(redactRules([{ regex: 'nodekey:[0-9a-f]+' }]), 'k=nodekey:abc'), 'k=███████████');
});

test('empty literal is dropped', () => {
  assert.equal(redactRules([{ text: '' }]).length, 0);
});

test('a match split across chunks is caught', async () => {
  const out = [];
  const b = lineBuffer(redactRules(['email']), (s) => out.push(s), 20);
  b.write('{"login":"User.so');
  b.write('ft@gmail.com"}\npartial');
  assert.deepEqual(out, ['{"login":"you@example.com"}\n']);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(out, ['{"login":"you@example.com"}\n', 'partial']);
});

test('bad entries are rejected', () => {
  assert.throws(() => checkRedact(['emails']), /unknown preset "emails"/);
  assert.throws(() => checkRedact([{ with: 'x' }]), /want a preset name/);
  assert.throws(() => checkRedact([{ regex: '(' }]), /Invalid regular expression/);
});

test('tailnet: fun names too, not the host in front', () => {
  const rules = redactRules(['tailnet'], (s) => s);
  assert.equal(redactText(rules, 'some-probe.tail735850.ts.net. up'), 'some-probe.tailXXXX.ts.net. up');
  assert.equal(redactText(rules, 'hello-share.tail735850.ts.net'), 'hello-share.tailXXXX.ts.net');
  assert.equal(redactText(rules, 'some-probe up'), 'some-probe up');
});

test('stage text: captions and cards are redacted, other calls left alone', () => {
  const rules = redactRules(['email'], (s) => s);
  const email = 'jane.doe@corp.example';
  assert.deepEqual(redactStageArgs(rules, 'caption', [`Signed in as ${email}`, `as ${email}`]),
    ['Signed in as you@example.com', 'as you@example.com']);
  const card = { image: 'data:image/png;base64,QUJD', title: email, sub: 'hi', pills: ['a', email], footer: 3 };
  assert.deepEqual(redactStageArgs(rules, 'card', [card]),
    [{ image: card.image, title: 'you@example.com', sub: 'hi', pills: ['a', 'you@example.com'], footer: 3 }]);
  assert.equal(card.title, email, 'the scene\'s own object is not changed');
  assert.deepEqual(redactStageArgs(rules, 'print', [email, 'out', 'term']), ['you@example.com', 'out', 'term']);
  assert.deepEqual(redactStageArgs(rules, 'moveTo', [email]), [email]);
  assert.deepEqual(redactStageArgs([], 'caption', [email]), [email]);
});

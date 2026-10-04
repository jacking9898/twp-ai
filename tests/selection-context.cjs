// SPDX-License-Identifier: MPL-2.0
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('src/contentScript/translateSelected.js', 'utf8').split('function getTabHostName()')[0];

function setup(runtime) {
  const world = vm.createContext({ chrome: { runtime } });
  vm.runInContext(source, world);
  const context = vm.runInContext('selectedTextContext', world);
  let cleanups = 0;
  context.onInvalidated(() => cleanups++);
  return { context, cleanups: () => cleanups };
}

test('focus send tolerates invalidation after the runtime availability check', () => {
  const { context, cleanups } = setup({ id: 'extension', sendMessage() { throw Error('Extension context invalidated.'); } });
  let fallbacks = 0;
  context.send({ action: 'thisFrameIsInFocus' }, () => assert.fail('stale callback'), () => fallbacks++);
  assert.equal(fallbacks, 1);
  assert.equal(context.available(), false);
  assert.equal(cleanups(), 1);
});

test('delayed callbacks cannot touch invalidated APIs or recreate selection UI', () => {
  let reply;
  const runtime = { id: 'extension', sendMessage(_message, callback) { reply = callback; } };
  const { context, cleanups } = setup(runtime);
  let fallbacks = 0;
  context.send({}, () => assert.fail('stale callback'), () => fallbacks++);
  delete runtime.id;
  Object.defineProperty(runtime, 'lastError', { get() { assert.fail('stale API access'); } });
  reply('late result');
  assert.equal(fallbacks, 1);
  assert.equal(cleanups(), 1);
});

test('callback error and callback API races retire the context exactly once', () => {
  for (const getter of [() => ({ message: 'Extension context invalidated.' }), () => { throw Error('Extension context invalidated.'); }]) {
    const runtime = { id: 'extension', sendMessage(_message, callback) { callback(); } };
    Object.defineProperty(runtime, 'lastError', { get: getter });
    const { context, cleanups } = setup(runtime);
    context.send({}, () => assert.fail('stale callback'));
    context.send({});
    assert.equal(cleanups(), 1);
  }
});

test('normal messages work and unrelated errors remain visible', () => {
  const { context, cleanups } = setup({ id: 'extension', sendMessage(_message, callback) { callback('result'); } });
  let result;
  context.send({}, value => { result = value; });
  assert.equal(result, 'result');
  assert.throws(() => context.run(() => { throw Error('Unexpected programming error'); }), /Unexpected programming error/);
  assert.equal(cleanups(), 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input.js';

// Input only touches window, document and its canvas when it is constructed, so stubs are enough to run it headless.
globalThis.window = { addEventListener() {} };
globalThis.document = { addEventListener() {} };
const canvas = { addEventListener() {}, requestPointerLock() {} };

test('buffered presses keep their window: attacks and spells a little longer than the default', () => {
  const input = new Input(canvas);
  input._press('KeyJ'); // attack
  input.update(0.25);
  assert.equal(input.peek('attack'), true, 'an attack stays buffered past 0.25 s');
  input.update(0.1);
  assert.equal(input.peek('attack'), false, 'and expires after its 0.3 s window');
  input._press('KeyQ'); // arcana
  input.update(0.25);
  assert.equal(input.peek('magic'), true, 'a spell press stays buffered past 0.25 s');
  input._press('KeyE'); // interact keeps the default window
  input.update(0.25);
  assert.equal(input.peek('interact'), false, 'other actions keep the default 0.22 s window');
});

test('hold() sets the remaining window of a buffered press, so it lasts as long as a cooldown', () => {
  const input = new Input(canvas);
  input.hold('dodge', 0.8); // nothing is buffered, so there is nothing to hold
  assert.equal(input.peek('dodge'), false);
  input._press('Space'); // 0.45 s dodge window
  input.hold('dodge', 0.8); // a dodge still on cooldown keeps its press for the rest of the cooldown
  input.update(0.6);
  assert.equal(input.peek('dodge'), true, 'still buffered while the cooldown runs');
  input.hold('dodge', 0.4); // re-holding each frame tracks the cooldown as it shrinks
  input.update(0.35);
  assert.equal(input.peek('dodge'), true, 'the hold can be refreshed as the cooldown shrinks');
  input.update(0.1);
  assert.equal(input.peek('dodge'), false, 'expires once the hold runs out');
});

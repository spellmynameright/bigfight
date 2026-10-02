import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InputState } from '../contracts';
import { encodeInput, INPUT_BYTES, NetIntentSource } from './inputCodec';

function input(overrides: Partial<InputState>): InputState {
  return {
    moveX: 0,
    moveY: 0,
    jumpPressed: false,
    jumpHeld: false,
    attackPressed: false,
    attackHeld: false,
    weaponPressed: false,
    weaponHeld: false,
    aimX: 0,
    pausePressed: false,
    anyPressed: false,
    ...overrides,
  };
}

function roundTrip(state: InputState): InputState {
  const bytes = new Uint8Array(INPUT_BYTES);
  encodeInput(state, bytes, 0);
  const source = new NetIntentSource();
  source.applyFrame(bytes, 0);
  return source.state;
}

test('mouse aim survives the wire in every direction', () => {
  for (const aimX of [-1, 0, 1]) {
    for (const attackHeld of [false, true]) {
      for (const weaponHeld of [false, true]) {
        const decoded = roundTrip(input({ aimX, attackHeld, weaponHeld, jumpHeld: true, moveX: -1, moveY: 1 }));
        assert.equal(decoded.aimX, aimX, `aimX ${aimX} attack ${attackHeld} weapon ${weaponHeld}`);
        assert.equal(decoded.attackHeld, attackHeld);
        assert.equal(decoded.weaponHeld, weaponHeld);
        assert.equal(decoded.jumpHeld, true);
        assert.equal(decoded.moveX, -1);
        assert.equal(decoded.moveY, 1);
      }
    }
  }
});

test('aim bits never read as button presses', () => {
  const decoded = roundTrip(input({ aimX: 1 }));
  assert.equal(decoded.jumpPressed, false);
  assert.equal(decoded.attackPressed, false);
  assert.equal(decoded.weaponPressed, false);
  const left = roundTrip(input({ aimX: -1 }));
  assert.equal(left.attackPressed || left.weaponPressed || left.jumpPressed, false);
});

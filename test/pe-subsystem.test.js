import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchSubsystemToGui } from '../scripts/pe-subsystem.mjs';

// 최소 가짜 PE: e_lfanew(0x3C) → "PE\0\0" → optional header(+24) → Subsystem(+68)
function fakePe(subsystem) {
  const buf = Buffer.alloc(512);
  const peOff = 128;
  buf.writeUInt32LE(peOff, 0x3c);
  buf.write('PE\0\0', peOff, 'latin1');
  const subOff = peOff + 24 + 68;
  buf.writeUInt16LE(subsystem, subOff);
  buf.writeUInt16LE(0xabcd, subOff - 2); // 이웃 바이트 sentinel
  buf.writeUInt16LE(0x1234, subOff + 2);
  return { buf, subOff };
}

test('CUI(3) → GUI(2) 로 패치하고 이웃 바이트는 보존', () => {
  const { buf, subOff } = fakePe(3);
  const r = patchSubsystemToGui(buf);
  assert.equal(buf.readUInt16LE(subOff), 2);
  assert.equal(r.previous, 3);
  assert.equal(r.offset, subOff);
  assert.equal(buf.readUInt16LE(subOff - 2), 0xabcd);
  assert.equal(buf.readUInt16LE(subOff + 2), 0x1234);
});

test('PE 시그니처가 없으면 throw', () => {
  const buf = Buffer.alloc(256);
  buf.writeUInt32LE(64, 0x3c); // 0으로 채워진 곳을 가리킴
  assert.throws(() => patchSubsystemToGui(buf), /PE 시그니처/);
});

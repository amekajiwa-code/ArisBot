import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resampleLinear, toDiscordPcm, DISCORD_SAMPLE_RATE } from '../src/pcm.js';
import { pcmOf } from './wav-fixture.js';

/** s16le 바이트열 → 샘플 배열 */
const samplesOf = (buf) => Array.from({ length: buf.length / 2 }, (_, i) => buf.readInt16LE(i * 2));

test('resampleLinear: 표본율이 같으면 그대로 돌려준다', () => {
  const input = Int16Array.from([1, 2, 3]);
  assert.equal(resampleLinear(input, 48000, 48000), input);
});

test('resampleLinear: 32k→48k는 1.5배로 늘어난다', () => {
  const out = resampleLinear(new Int16Array(200), 32000, 48000);
  assert.equal(out.length, 300);
});

test('resampleLinear: 양 끝 샘플은 보존된다', () => {
  const out = resampleLinear(Int16Array.from([0, 1000, 2000, 3000]), 32000, 48000);
  assert.equal(out[0], 0);
  assert.equal(out[out.length - 1], 3000);
});

test('resampleLinear: 선형 구간은 선형으로 남는다', () => {
  // 0,1000,2000,3000 을 1.5배로 늘리면 등간격 램프가 유지돼야 한다.
  const out = Array.from(resampleLinear(Int16Array.from([0, 1000, 2000, 3000]), 32000, 48000));
  const steps = out.slice(1).map((v, i) => v - out[i]);
  for (const s of steps) assert.ok(Math.abs(s - steps[0]) <= 1, `계단이 고르지 않다: ${steps}`);
});

test('resampleLinear: 빈 입력은 그대로', () => {
  assert.equal(resampleLinear(new Int16Array(0), 32000, 48000).length, 0);
});

test('toDiscordPcm: 이미 48k 스테레오면 손대지 않는다', () => {
  const pcm = pcmOf([1, 2, 3, 4]);
  const out = toDiscordPcm({ pcm, sampleRate: DISCORD_SAMPLE_RATE, channels: 2 });
  assert.equal(out, pcm); // 복사조차 하지 않는다
});

test('toDiscordPcm: 48k 모노는 양쪽 귀에 복제된다', () => {
  const out = toDiscordPcm({ pcm: pcmOf([10, 20, 30]), sampleRate: DISCORD_SAMPLE_RATE, channels: 1 });
  assert.deepEqual(samplesOf(out), [10, 10, 20, 20, 30, 30]);
});

test('toDiscordPcm: GPT-SoVITS의 32k 모노가 48k 스테레오가 된다', () => {
  const frames = 200;
  const out = toDiscordPcm({ pcm: pcmOf(new Array(frames).fill(0)), sampleRate: 32000, channels: 1 });
  // 200프레임 → 300프레임, 스테레오 16bit라 프레임당 4바이트
  assert.equal(out.length, 300 * 4);
});

test('toDiscordPcm: 32k 스테레오는 채널을 섞지 않고 각각 리샘플한다', () => {
  // 왼쪽은 0, 오른쪽은 1000으로 채워 두면 섞였는지 바로 드러난다.
  const interleaved = [];
  for (let i = 0; i < 100; i += 1) interleaved.push(0, 1000);
  const out = samplesOf(toDiscordPcm({ pcm: pcmOf(interleaved), sampleRate: 32000, channels: 2 }));

  const left = out.filter((_, i) => i % 2 === 0);
  const right = out.filter((_, i) => i % 2 === 1);
  assert.ok(left.every((v) => v === 0), '왼쪽 채널이 오염됐다');
  assert.ok(right.every((v) => v === 1000), '오른쪽 채널이 오염됐다');
});

test('toDiscordPcm: 홀수 byteOffset 버퍼에서도 안전하다', () => {
  // Buffer.subarray는 정렬을 보장하지 않는다 — Int16Array로 바로 감싸면 터지는 자리다.
  const padded = Buffer.concat([Buffer.from([0]), pcmOf([10, 20, 30])]);
  const misaligned = padded.subarray(1);
  assert.equal(misaligned.byteOffset % 2, 1);
  const out = toDiscordPcm({ pcm: misaligned, sampleRate: DISCORD_SAMPLE_RATE, channels: 1 });
  assert.deepEqual(samplesOf(out), [10, 10, 20, 20, 30, 30]);
});

test('toDiscordPcm: 채널 수가 이상하면 실패한다', () => {
  assert.throws(() => toDiscordPcm({ pcm: Buffer.alloc(4), sampleRate: 48000, channels: 0 }), /채널 수/);
});

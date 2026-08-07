import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWav } from '../src/wav.js';
import { makeWav } from './wav-fixture.js';

const PCM = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

test('parseWav: data 청크 본문과 포맷을 돌려준다', () => {
  const r = parseWav(makeWav(PCM, { sampleRate: 32000, channels: 1 }));
  assert.deepEqual(r.pcm, PCM);
  assert.equal(r.sampleRate, 32000);
  assert.equal(r.channels, 1);
  assert.equal(r.bitsPerSample, 16);
});

test('parseWav: fmt와 data 사이에 다른 청크가 끼어도 찾아낸다', () => {
  const list = Buffer.alloc(8 + 10);
  list.write('LIST', 0, 'ascii');
  list.writeUInt32LE(10, 4);
  assert.deepEqual(parseWav(makeWav(PCM, { extraChunk: list })).pcm, PCM);
});

test('parseWav: 홀수 크기 청크의 패딩 바이트를 건너뛴다', () => {
  const odd = Buffer.alloc(8 + 3 + 1);
  odd.write('junk', 0, 'ascii');
  odd.writeUInt32LE(3, 4);
  assert.deepEqual(parseWav(makeWav(PCM, { extraChunk: odd })).pcm, PCM);
});

test('parseWav: 선언된 크기가 버퍼를 넘어가면 있는 데까지만 돌려준다', () => {
  const wav = makeWav(PCM);
  wav.writeUInt32LE(9999, wav.length - PCM.length - 4); // data 청크 크기를 부풀린다
  assert.deepEqual(parseWav(wav).pcm, PCM);
});

test('parseWav: 16bit가 아니면 거절한다', () => {
  assert.throws(() => parseWav(makeWav(PCM, { bits: 24 })), /16bit PCM만/);
});

test('parseWav: WAV가 아니거나 청크가 없으면 실패한다', () => {
  assert.throws(() => parseWav(Buffer.from('not a wav at all')), /WAV 형식이 아닙니다/);
  assert.throws(() => parseWav(Buffer.alloc(4)), /WAV 형식이 아닙니다/);

  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.write('WAVE', 8, 'ascii');
  assert.throws(() => parseWav(header), /data 청크가 없습니다/);
});

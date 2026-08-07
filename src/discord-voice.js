// @discordjs/voice 어댑터. voice.js가 쓰는 { play, destroy } 한 쌍으로 감싼다.
//
// VOICEVOX가 이미 48kHz 스테레오 s16le PCM으로 구워 주므로 StreamType.Raw로 그대로
// 밀어 넣는다. ffmpeg이나 prism-media의 트랜스코딩 단계가 없다.

import { Readable } from 'node:stream';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  NoSubscriberBehavior,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
} from '@discordjs/voice';

/**
 * 음성 채널에 접속한다.
 * @param {import('discord.js').VoiceBasedChannel} channel
 * @param {{readyTimeoutMs?: number, maxPlayMs?: number}} [opts]
 * @returns {Promise<{play: (pcm: Buffer) => Promise<void>, destroy: () => void}>}
 */
export async function connectToChannel(channel, { readyTimeoutMs = 15000, maxPlayMs = 120000 } = {}) {
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: true,   // 듣지 않는다 — 받는 오디오를 처리할 일이 없다
    selfMute: false,
  });

  // 아무도 안 듣고 있으면 재생을 멈춰 뒀다가 사람이 들어오면 이어서 튼다.
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
  connection.subscribe(player);

  // 디스코드가 음성 서버를 옮기면 Disconnected를 거쳐 스스로 복귀한다. 복귀 기미가
  // 없으면 연결을 접어야 좀비 세션이 남지 않는다.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch {
      connection.destroy();
    }
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, readyTimeoutMs);
  } catch (e) {
    connection.destroy();
    throw new Error(`음성 채널 접속에 실패했습니다: ${e?.message ?? e}`);
  }

  return {
    play(pcm) {
      const resource = createAudioResource(Readable.from(pcm), { inputType: StreamType.Raw });

      // 리스너를 play() 전에 걸어 둔다. 짧은 음성은 play()가 반환하기도 전에
      // 재생이 끝나 버려서, 나중에 거는 방식이면 Idle 전이를 놓친다.
      const finished = new Promise((resolve, reject) => {
        const done = (fn, arg) => { cleanup(); fn(arg); };
        const onState = (_prev, next) => { if (next.status === AudioPlayerStatus.Idle) done(resolve); };
        const onError = (err) => done(reject, err);
        const timer = setTimeout(() => {
          player.stop(true);
          done(reject, new Error('재생 시간이 너무 깁니다'));
        }, maxPlayMs);
        function cleanup() {
          clearTimeout(timer);
          player.off('stateChange', onState);
          player.off('error', onError);
        }
        player.on('stateChange', onState);
        player.once('error', onError);
      });

      player.play(resource);
      return finished;
    },

    destroy() {
      player.stop(true);
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    },
  };
}

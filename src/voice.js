// 음성 재생 큐와 길드별 세션 수명 관리.
//
// 디스코드 API를 직접 건드리지 않는다 — 실제 접속은 connect()로 주입받고, 이 파일은
// "한 번에 하나씩 순서대로 말하고, 조용해지면 알아서 나간다"는 규칙만 책임진다.
// (실제 어댑터는 discord-voice.js)

/**
 * 합성과 재생을 한 줄로 세운다. 여러 명이 동시에 /say를 쳐도 목소리가 겹치지 않는다.
 *
 * @param {(text: string) => Promise<Buffer>} opts.synthesize
 * @param {(pcm: Buffer) => Promise<void>} opts.play
 * @param {() => void} [opts.onDrain]  큐가 비는 순간 호출 (유휴 타이머를 걸 자리)
 */
export function createSpeechQueue({ synthesize, play, onDrain }) {
  const pending = [];
  let draining = false;

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      while (pending.length) {
        const job = pending.shift();
        // 한 건이 실패해도 큐 전체를 세우지 않는다 — 그 요청자에게만 알린다.
        try {
          await play(await synthesize(job.text));
          job.resolve();
        } catch (e) {
          job.reject(e);
        }
      }
    } finally {
      draining = false;
      onDrain?.();
    }
  }

  return {
    get size() { return pending.length; },
    get busy() { return draining; },

    /** @returns {Promise<void>} 이 텍스트의 재생이 끝나면 resolve */
    push(text) {
      return new Promise((resolve, reject) => {
        pending.push({ text, resolve, reject });
        drain();
      });
    },

    /** 대기 중인 요청을 모두 취소한다. 재생 중인 건은 건드리지 않는다. */
    clear(reason = '재생이 취소됐습니다') {
      while (pending.length) pending.shift().reject(new Error(reason));
    },
  };
}

/**
 * 길드마다 음성 세션 하나를 들고 있는다.
 *
 * @param {(text: string) => Promise<Buffer>} opts.synthesize
 * @param {(channel: object) => Promise<{play: Function, destroy: Function}>} opts.connect
 * @param {number} [opts.idleTimeoutMs]  이만큼 조용하면 스스로 나간다 (0 = 안 나감)
 * @param {(err: Error, ctx: object) => void} [opts.onError]
 */
export function createVoiceSessions({
  synthesize,
  connect,
  idleTimeoutMs = 5 * 60 * 1000,
  onError,
  timers = { setTimeout, clearTimeout },
}) {
  const sessions = new Map();   // guildId → session
  const connecting = new Map(); // guildId → Promise<session> (동시 요청이 두 번 접속하는 걸 막는다)

  function armIdle(guildId) {
    const session = sessions.get(guildId);
    if (!session || idleTimeoutMs <= 0) return;
    timers.clearTimeout(session.idleTimer);
    session.idleTimer = timers.setTimeout(() => { leave(guildId); }, idleTimeoutMs);
  }

  function leave(guildId, reason) {
    const session = sessions.get(guildId);
    if (!session) return false;
    sessions.delete(guildId);
    timers.clearTimeout(session.idleTimer);
    session.queue.clear(reason ?? '봇이 음성 채널에서 나갔습니다');
    try {
      session.destroy();
    } catch (e) {
      onError?.(e, { guildId, at: 'destroy' });
    }
    return true;
  }

  async function open(channel) {
    const guildId = channel.guild.id;
    const conn = await connect(channel);
    const session = {
      channelId: channel.id,
      destroy: conn.destroy,
      idleTimer: null,
      queue: createSpeechQueue({
        synthesize,
        play: conn.play,
        onDrain: () => armIdle(guildId),
      }),
    };
    sessions.set(guildId, session);
    return session;
  }

  async function sessionFor(channel) {
    const guildId = channel.guild.id;

    const existing = sessions.get(guildId);
    if (existing && existing.channelId === channel.id) return existing;
    // 다른 채널에서 부르면 그쪽으로 옮겨 간다.
    if (existing) leave(guildId, '다른 음성 채널로 이동했습니다');

    // 접속하는 사이에 들어온 요청은 같은 접속을 기다리게 한다.
    const inFlight = connecting.get(guildId);
    if (inFlight) {
      const session = await inFlight;
      if (session.channelId === channel.id) return session;
      return sessionFor(channel);
    }

    const promise = open(channel).finally(() => connecting.delete(guildId));
    connecting.set(guildId, promise);
    return promise;
  }

  return {
    /**
     * 음성 채널에 (필요하면 접속한 뒤) 한 마디 말한다.
     * @returns {Promise<void>} 재생이 끝나면 resolve, 합성·재생 실패 시 reject
     */
    async speak(channel, text) {
      const session = await sessionFor(channel);
      timers.clearTimeout(session.idleTimer); // 말하는 동안엔 유휴 타이머를 멈춘다
      return session.queue.push(text);
    },

    /** 음성 채널에서 나간다. @returns {boolean} 원래 들어가 있었는지 */
    leave(guildId) { return leave(guildId); },

    /** 지금 들어가 있는 음성 채널 id (없으면 null) */
    channelOf(guildId) { return sessions.get(guildId)?.channelId ?? null; },

    /** 종료 시 정리용. */
    destroyAll() { for (const guildId of [...sessions.keys()]) leave(guildId, '봇을 종료합니다'); },
  };
}

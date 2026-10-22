import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Player } from './player.ts';
import type { AudioTaskQueue } from './types.ts';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const abortError = () => new DOMException('cancelled', 'AbortError');

class FakeSource extends EventTarget {
  buffer: unknown = null;
  connectedTo: unknown = null;
  started = 0;
  stopped = 0;
  disconnected = 0;
  endedListeners = 0;
  connect(node: unknown) {
    this.connectedTo = node;
  }
  start() {
    this.started++;
  }
  stop() {
    this.stopped++;
  }
  disconnect() {
    this.disconnected++;
  }
  override addEventListener(
    type: string,
    cb: EventListenerOrEventListenerObject | null,
    opts?: boolean | AddEventListenerOptions,
  ) {
    if (type === 'ended') this.endedListeners++;
    super.addEventListener(type, cb, opts);
  }
  override removeEventListener(
    type: string,
    cb: EventListenerOrEventListenerObject | null,
    opts?: boolean | EventListenerOptions,
  ) {
    if (type === 'ended') this.endedListeners--;
    super.removeEventListener(type, cb, opts);
  }
  fireEnded() {
    this.dispatchEvent(new Event('ended'));
  }
}

interface FakeTask {
  id: string;
  resolve: (b: unknown) => void;
  reject: (e: unknown) => void;
}

class FakeAnalyser {
  fftSize = 2048;
  frequencyBinCount = 1024;
  connectedTo: unknown = null;
  disconnected = 0;
  filled: unknown[] = [];
  connect(node: unknown) {
    this.connectedTo = node;
    this.frequencyBinCount = this.fftSize / 2;
  }
  disconnect() {
    this.disconnected++;
  }
  getByteFrequencyData(array: Uint8Array) {
    this.filled.push(array);
    array.fill(7);
  }
}

function setup(contextState = 'running', slowResume = false) {
  let releaseResume!: () => void;
  const gate = slowResume
    ? new Promise<void>((r) => {
        releaseResume = r;
      })
    : Promise.resolve();
  const destination = { name: 'destination' };
  const sources: FakeSource[] = [];
  const tasks: FakeTask[] = [];
  const log = { contexts: 0, resumed: 0, closed: 0, cancelled: [] as string[] };
  const analysers: FakeAnalyser[] = [];
  const context = {
    state: contextState,
    destination,
    createAnalyser: () => {
      const a = new FakeAnalyser();
      analysers.push(a);
      return a;
    },
    createBufferSource: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    resume: async () => {
      log.resumed++;
      await gate;
    },
    close: async () => {
      log.closed++;
    },
  };
  const queue = {
    enqueueTask: () => {
      const id = `t${tasks.length}`;
      let resolve!: (b: unknown) => void;
      let reject!: (e: unknown) => void;
      const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      tasks.push({ id, resolve, reject });
      return { id, promise };
    },
    cancel: (id: string) => {
      log.cancelled.push(id);
      tasks.find((t) => t.id === id)?.reject(abortError());
      return true;
    },
    clear: () => {},
  };
  const player = new Player(
    (() => {
      log.contexts++;
      return context;
    }) as unknown as () => AudioContext,
    (() => queue) as unknown as () => AudioTaskQueue,
  );
  const states: string[] = [];
  player.subscribe((s) => states.push(s));
  return {
    player,
    sources,
    tasks,
    log,
    states,
    destination,
    analysers,
    releaseResume,
  };
}

describe('Player', () => {
  it('creates no AudioContext until play() is called', () => {
    const { log } = setup();
    assert.equal(log.contexts, 0);
  });

  it('creates one context, resumes it if suspended, and plays', async () => {
    const { player, sources, tasks, log, states, destination, analysers } =
      setup('suspended');
    const p = player.play('/a.wav');
    assert.equal(log.contexts, 1);
    await tick();
    tasks[0]!.resolve({ tag: 'A' });
    await p;
    assert.deepEqual(states, ['LOADING', 'PLAYING']);
    assert.equal(log.resumed, 1);
    assert.equal(analysers.length, 1);
    assert.equal(sources[0]!.connectedTo, analysers[0]);
    assert.equal(analysers[0]!.connectedTo, destination);
    assert.equal(sources[0]!.started, 1);
    void player.play('/b.wav');
    assert.equal(log.contexts, 1);
  });

  it('stops, disconnects and unlistens a source when it ends', async () => {
    const { player, sources, tasks, states } = setup();
    const p = player.play('/a.wav');
    await tick();
    tasks[0]!.resolve({});
    await p;
    assert.equal(sources[0]!.endedListeners, 1);
    sources[0]!.fireEnded();
    assert.equal(player.state, 'IDLE');
    assert.equal(sources[0]!.stopped, 1);
    assert.equal(sources[0]!.disconnected, 1);
    assert.equal(sources[0]!.endedListeners, 0);
    assert.deepEqual(states, ['LOADING', 'PLAYING', 'IDLE']);
  });

  it('skipping releases the old source before the next one', async () => {
    const { player, sources, tasks } = setup();
    const a = player.play('/a.wav');
    await tick();
    tasks[0]!.resolve({});
    await a;
    const b = player.play('/b.wav');
    assert.equal(sources[0]!.stopped, 1);
    assert.equal(sources[0]!.disconnected, 1);
    assert.equal(sources[0]!.endedListeners, 0);
    await tick();
    tasks[1]!.resolve({});
    await b;
    assert.equal(sources.length, 2);
    assert.equal(sources[1]!.started, 1);
  });

  it('never starts a superseded load that resolved during resume', async () => {
    const { player, sources, tasks } = setup('suspended');
    const a = player.play('/a.wav');
    tasks[0]!.resolve({});
    const b = player.play('/b.wav');
    await a;
    assert.equal(sources.length, 0);
    await tick();
    tasks[1]!.resolve({});
    await b;
    assert.equal(sources.length, 1);
  });

  it('stop() releases the source and cancels a pending load', async () => {
    const { player, sources, tasks, log, states } = setup();
    const p = player.play('/a.wav');
    await tick();
    player.stop();
    await p;
    assert.deepEqual(log.cancelled, ['t0']);
    assert.equal(sources.length, 0);
    assert.deepEqual(states, ['LOADING', 'IDLE']);
    const q = player.play('/b.wav');
    await tick();
    tasks[1]!.resolve({});
    await q;
    player.stop();
    assert.equal(sources[0]!.stopped, 1);
    assert.equal(sources[0]!.disconnected, 1);
    assert.equal(player.state, 'IDLE');
  });

  it('goes to ERROR on a load failure but ignores AbortError', async () => {
    const { player, tasks, states } = setup();
    const p = player.play('/a.wav');
    await tick();
    tasks[0]!.reject(new Error('HTTP 404'));
    await p;
    assert.equal(player.state, 'ERROR');
    const q = player.play('/b.wav');
    await tick();
    tasks[1]!.reject(abortError());
    await q;
    assert.deepEqual(states, ['LOADING', 'ERROR', 'LOADING']);
  });

  it('A fails during resume, B supersedes, B plays', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    const { player, sources, tasks, states, releaseResume } = setup(
      'suspended',
      true,
    );
    const a = player.play('/404.wav');
    tasks[0]!.reject(new Error('HTTP 404'));
    const b = player.play('/b.wav');
    tasks[1]!.resolve({});
    releaseResume();
    await Promise.all([a, b]);
    await tick();
    process.off('unhandledRejection', onUnhandled);
    assert.equal(player.state, 'PLAYING');
    assert.equal(sources.length, 1);
    assert.deepEqual(states, ['LOADING', 'LOADING', 'PLAYING']);
    assert.equal(unhandled.length, 0);
  });

  it('play() after dispose() rejects', async () => {
    const { player } = setup();
    player.dispose();
    await assert.rejects(player.play('/a.wav'), /disposed/);
  });

  it('analyser: fftSize 512 and one reused array', async () => {
    const { player, tasks, analysers } = setup();
    assert.equal(player.readFrequencyData(), null);
    assert.equal(player.frequencyBinCount, 256);
    const p = player.play('/a.wav');
    await tick();
    tasks[0]!.resolve({});
    await p;
    assert.equal(analysers[0]!.fftSize, 512);
    assert.equal(player.frequencyBinCount, 256);
    const first = player.readFrequencyData()!;
    assert.equal(first.length, 256);
    assert.equal(first[0], 7);
    for (let i = 0; i < 5; i++) {
      assert.equal(player.readFrequencyData(), first);
    }
    assert.equal(new Set(analysers[0]!.filled).size, 1);
    const q = player.play('/b.wav');
    await tick();
    tasks[1]!.resolve({});
    await q;
    assert.equal(analysers.length, 1);
    assert.equal(player.readFrequencyData(), first);
  });

  it('dispose() disconnects the analyser', async () => {
    const { player, analysers } = setup();
    void player.play('/a.wav');
    player.dispose();
    assert.equal(analysers[0]!.disconnected, 1);
    assert.equal(player.readFrequencyData(), null);
  });

  it('dispose() releases the source and closes the context', async () => {
    const { player, sources, tasks, log } = setup();
    const p = player.play('/a.wav');
    await tick();
    tasks[0]!.resolve({});
    await p;
    player.dispose();
    assert.equal(sources[0]!.disconnected, 1);
    assert.equal(log.closed, 1);
  });
});

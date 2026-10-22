import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AudioTaskQueue } from './audio-task-queue.ts';

interface Pending {
  url: string;
  signal: AbortSignal;
  resolve: (b: AudioBuffer) => void;
  reject: (e: unknown) => void;
}

const fakeBuffer = (tag: string) => ({ tag }) as unknown as AudioBuffer;
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// Loader whose calls stay pending until the test settles them by hand.
function manualLoader() {
  const started: Pending[] = [];
  let active = 0;
  let maxActive = 0;
  const load = (url: string, signal: AbortSignal) =>
    new Promise<AudioBuffer>((resolve, reject) => {
      active++;
      maxActive = Math.max(maxActive, active);
      started.push({
        url,
        signal,
        resolve: (b) => { active--; resolve(b); },
        reject: (e) => { active--; reject(e); },
      });
    });
  return { load, started, maxActive: () => maxActive };
}

describe('AudioTaskQueue', () => {
  it('starts loads strictly in enqueue order, one at a time', async () => {
    const l = manualLoader();
    const q = new AudioTaskQueue(l.load);
    const p = ['a', 'b', 'c'].map((u) => q.enqueue(u));
    await tick();
    assert.deepEqual(l.started.map((s) => s.url), ['a']);
    l.started[0]!.resolve(fakeBuffer('a'));
    await tick();
    assert.deepEqual(l.started.map((s) => s.url), ['a', 'b']);
    l.started[1]!.resolve(fakeBuffer('b'));
    await tick();
    l.started[2]!.resolve(fakeBuffer('c'));
    await Promise.all(p);
    assert.deepEqual(l.started.map((s) => s.url), ['a', 'b', 'c']);
    assert.equal(l.maxActive(), 1);
  });

  it('settles each task promise with its own result', async () => {
    const l = manualLoader();
    const q = new AudioTaskQueue(l.load);
    const [pa, pb] = [q.enqueue('a'), q.enqueue('b')];
    await tick();
    l.started[0]!.resolve(fakeBuffer('A'));
    await tick();
    l.started[1]!.resolve(fakeBuffer('B'));
    assert.deepEqual(await pa, { tag: 'A' });
    assert.deepEqual(await pb, { tag: 'B' });
  });

  it('rejects only the failed task and keeps draining', async () => {
    const l = manualLoader();
    const q = new AudioTaskQueue(l.load);
    const pa = q.enqueue('a');
    const pb = q.enqueue('b');
    const failed = assert.rejects(pa, /boom/);
    await tick();
    l.started[0]!.reject(new Error('boom'));
    await failed;
    await tick();
    l.started[1]!.resolve(fakeBuffer('B'));
    assert.deepEqual(await pb, { tag: 'B' });
  });

  it('passes a distinct, unaborted signal per task', async () => {
    const l = manualLoader();
    const q = new AudioTaskQueue(l.load);
    void q.enqueue('a');
    void q.enqueue('b');
    await tick();
    l.started[0]!.resolve(fakeBuffer('a'));
    await tick();
    assert.notEqual(l.started[0]!.signal, l.started[1]!.signal);
    assert.equal(l.started[1]!.signal.aborted, false);
  });
});

// Loader that honours the signal like the real fetch-based one does.
function abortableLoader() {
  const started: string[] = [];
  const load = (url: string, signal: AbortSignal) =>
    new Promise<AudioBuffer>((_, reject) => {
      started.push(url);
      signal.addEventListener('abort', () => reject(signal.reason));
    });
  return { load, started };
}

describe('AudioTaskQueue cancellation', () => {
  it('removes a queued task and rejects it with AbortError', async () => {
    const l = abortableLoader();
    const q = new AudioTaskQueue(l.load);
    void q.enqueueTask('a').promise.catch(() => {});
    const b = q.enqueueTask('b');
    const c = q.enqueueTask('c');
    const rejected = assert.rejects(b.promise, { name: 'AbortError' });
    assert.equal(q.cancel(b.id), true);
    await rejected;
    assert.equal(q.cancel(b.id), false);
    q.cancel(c.id);
    await assert.rejects(c.promise, { name: 'AbortError' });
    await tick();
    assert.deepEqual(l.started, ['a']);
  });

  it('aborts the active task and moves on to the next', async () => {
    const m = manualLoader();
    const q = new AudioTaskQueue((url, signal) => {
      const p = m.load(url, signal);
      signal.addEventListener('abort', () =>
        m.started.find((s) => s.url === url)?.reject(signal.reason));
      return p;
    });
    const a = q.enqueueTask('a');
    const b = q.enqueue('b');
    await tick();
    const signalA = m.started[0]!.signal;
    assert.equal(q.cancel(a.id), true);
    assert.equal(signalA.aborted, true);
    assert.equal(q.cancel(a.id), false);
    await assert.rejects(a.promise, { name: 'AbortError' });
    await tick();
    assert.deepEqual(m.started.map((s) => s.url), ['a', 'b']);
    m.started[1]!.resolve(fakeBuffer('B'));
    assert.deepEqual(await b, { tag: 'B' });
  });

  it('rejects a cancelled task if the loader ignores abort', async () => {
    const m = manualLoader();
    const q = new AudioTaskQueue(m.load);
    const a = q.enqueueTask('a');
    await tick();
    q.cancel(a.id);
    m.started[0]!.resolve(fakeBuffer('late'));
    await assert.rejects(a.promise, { name: 'AbortError' });
  });

  it('clear() cancels queued and active, then reusable', async () => {
    const l = abortableLoader();
    const q = new AudioTaskQueue(l.load);
    const all = ['a', 'b', 'c'].map((u) => q.enqueueTask(u).promise);
    await tick();
    const rejected = all.map((p) => assert.rejects(p, { name: 'AbortError' }));
    q.clear();
    await Promise.all(rejected);
    await tick();
    assert.deepEqual(l.started, ['a']);
    void q.enqueueTask('d').promise.catch(() => {});
    await tick();
    assert.deepEqual(l.started, ['a', 'd']);
  });

  it('cancel() returns false for unknown ids', () => {
    const q = new AudioTaskQueue(abortableLoader().load);
    assert.equal(q.cancel('nope'), false);
  });
});

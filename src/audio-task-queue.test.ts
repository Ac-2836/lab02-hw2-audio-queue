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

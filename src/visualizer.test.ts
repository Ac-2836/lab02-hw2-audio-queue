import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import {
  barCount,
  barHeight,
  barWidth,
  binStart,
  groupLevel,
  Visualizer,
} from './visualizer.ts';

describe('bar geometry', () => {
  it('fits as many minimum-width bars as the width allows', () => {
    assert.equal(barCount(100, 4, 2, 256), 17);
    assert.equal(barCount(1000, 4, 2, 64), 64);
    assert.equal(barCount(0, 4, 2, 64), 1);
  });

  it('bars and gaps exactly fill the width', () => {
    const count = 10;
    const w = barWidth(count, 200, 2);
    assert.equal(w * count + 2 * (count - 1), 200);
  });

  it('bin groups are contiguous, non-empty and cover every bin', () => {
    const usable = 128;
    for (const count of [1, 7, 64, 128]) {
      assert.equal(binStart(0, count, usable), 0);
      assert.equal(binStart(count, count, usable), usable);
      for (let i = 0; i < count; i++) {
        assert.ok(binStart(i + 1, count, usable) > binStart(i, count, usable));
      }
    }
  });

  it('groupLevel is the max of the group; barHeight scales 0..255', () => {
    const data = Uint8Array.from([1, 9, 3, 200, 4]);
    assert.equal(groupLevel(data, 0, 3), 9);
    assert.equal(groupLevel(data, 3, 5), 200);
    assert.equal(barHeight(255, 80), 80);
    assert.equal(barHeight(0, 80), 0);
  });
});

// Minimal browser fakes to check the loop lifecycle without a DOM.
const g = globalThis as unknown as Record<string, unknown>;
const saved = { ...g };

function setupDom(reduced = false, initialState = 'IDLE') {
  let nextId = 1;
  const rafs = new Map<number, (t: number) => void>();
  const log = {
    cancelled: 0,
    gradients: 0,
    cleared: 0,
    drawn: 0,
    observed: 0,
    disconnected: 0,
    motionRemoved: 0,
    unsubscribed: 0,
  };
  g.requestAnimationFrame = (cb: (t: number) => void) => {
    rafs.set(nextId, cb);
    return nextId++;
  };
  g.cancelAnimationFrame = (id: number) => {
    log.cancelled++;
    rafs.delete(id);
  };
  g.devicePixelRatio = 2;
  g.matchMedia = () => ({
    matches: reduced,
    addEventListener: () => {},
    removeEventListener: () => {
      log.motionRemoved++;
    },
  });
  g.ResizeObserver = class {
    observe() {
      log.observed++;
    }
    disconnect() {
      log.disconnected++;
    }
  };
  const ctx = {
    fillStyle: null as unknown,
    setTransform: () => {},
    clearRect: () => {
      log.cleared++;
    },
    fillRect: () => {
      log.drawn++;
    },
    createLinearGradient: () => {
      log.gradients++;
      return { addColorStop: () => {} };
    },
  };
  const attrs: Record<string, string> = {};
  const canvas = {
    clientWidth: 100,
    clientHeight: 50,
    width: 0,
    height: 0,
    getContext: () => ctx,
    setAttribute: (k: string, v: string) => {
      attrs[k] = v;
    },
    hasAttribute: (k: string) => k in attrs,
  };
  let listener: (s: string) => void = () => {};
  const data = new Uint8Array(256).fill(128);
  const source = {
    state: initialState,
    readFrequencyData: () => data,
    subscribe: (l: (s: string) => void) => {
      listener = l;
      return () => {
        log.unsubscribed++;
      };
    },
  };
  const run = (time: number) => {
    const [id, cb] = [...rafs][0]!;
    rafs.delete(id);
    cb(time);
  };
  return {
    canvas,
    source,
    attrs,
    log,
    rafs,
    run,
    emit: (s: string) => listener(s),
  };
}

describe('Visualizer', () => {
  afterEach(() => {
    for (const k of Object.keys(g)) if (!(k in saved)) delete g[k];
  });

  const make = (dom: ReturnType<typeof setupDom>) =>
    new Visualizer(dom.canvas as never, dom.source as never);

  it('labels the canvas and sizes the backing store by dpr', () => {
    const dom = setupDom();
    make(dom);
    assert.equal(dom.attrs['role'], 'img');
    assert.equal(dom.attrs['aria-label'], 'Audio frequency visualizer');
    assert.equal(dom.canvas.width, 200);
    assert.equal(dom.canvas.height, 100);
    assert.equal(dom.log.observed, 1);
  });

  it('runs one rAF loop while PLAYING and cancels it otherwise', () => {
    const dom = setupDom();
    make(dom);
    dom.emit('PLAYING');
    dom.emit('PLAYING');
    assert.equal(dom.rafs.size, 1);
    dom.run(16);
    dom.run(32);
    assert.equal(dom.rafs.size, 1);
    assert.ok(dom.log.drawn > 0);
    dom.emit('IDLE');
    assert.equal(dom.rafs.size, 0);
    assert.equal(dom.log.cancelled, 1);
    dom.emit('PLAYING');
    dom.emit('ERROR');
    assert.equal(dom.rafs.size, 0);
  });

  it('starts at once when constructed while already PLAYING', () => {
    const dom = setupDom(false, 'PLAYING');
    make(dom);
    assert.equal(dom.rafs.size, 1);
  });

  it('creates the gradient once, not per frame', () => {
    const dom = setupDom();
    make(dom);
    dom.emit('PLAYING');
    for (let t = 16; t <= 160; t += 16) dom.run(t);
    assert.equal(dom.log.gradients, 1);
  });

  it('refreshes slowly under prefers-reduced-motion', () => {
    const dom = setupDom(true);
    make(dom);
    dom.emit('PLAYING');
    dom.run(300);
    const first = dom.log.cleared;
    dom.run(316);
    dom.run(332);
    assert.equal(dom.log.cleared, first);
    dom.run(600);
    assert.equal(dom.log.cleared, first + 1);
  });

  it('dispose() cancels the loop and releases every subscription', () => {
    const dom = setupDom();
    const viz = make(dom);
    dom.emit('PLAYING');
    viz.dispose();
    assert.equal(dom.rafs.size, 0);
    assert.equal(dom.log.disconnected, 1);
    assert.equal(dom.log.unsubscribed, 1);
    assert.equal(dom.log.motionRemoved, 1);
    viz.start();
    assert.equal(dom.rafs.size, 0);
  });
});

import type { PlayerState } from './types';

/** What the visualizer needs from the player (Player satisfies it). */
export interface FrequencySource {
  readonly state: PlayerState;
  readFrequencyData(): Uint8Array<ArrayBuffer> | null;
  subscribe(listener: (state: PlayerState) => void): () => void;
}

const MIN_BAR_WIDTH = 4;
const BAR_GAP = 2;
// Demo tracks hold little energy above ~2.5 kHz, the lowest quarter of bins.
const BIN_FRACTION = 0.25;
// With prefers-reduced-motion the bars refresh slowly instead of at 60fps.
const REDUCED_MOTION_INTERVAL_MS = 250;
const ARIA_LABEL = 'Audio frequency visualizer';

// Pure geometry helpers. They return numbers only, so the per-frame draw
// loop allocates nothing.
export function barCount(
  width: number,
  minBarWidth: number,
  gap: number,
  maxBars: number,
): number {
  const fit = Math.floor((width + gap) / (minBarWidth + gap));
  return Math.max(1, Math.min(fit, maxBars));
}

export function barWidth(count: number, width: number, gap: number): number {
  return (width - gap * (count - 1)) / count;
}

/** First bin of bar `index`; the bar's end is `binStart(index + 1, ...)`. */
export function binStart(
  index: number,
  count: number,
  binCount: number,
): number {
  return Math.floor((index * binCount) / count);
}

export function groupLevel(
  data: Uint8Array,
  start: number,
  end: number,
): number {
  let max = 0;
  for (let i = start; i < end; i++) max = Math.max(max, data[i] ?? 0);
  return max;
}

export function barHeight(level: number, height: number): number {
  return (level / 255) * height;
}

export class Visualizer {
  private readonly canvas: HTMLCanvasElement;
  private readonly source: FrequencySource;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly resizeObserver: ResizeObserver;
  private readonly motionQuery: MediaQueryList;
  private readonly unsubscribe: () => void;
  private gradient: CanvasGradient | null = null;
  private rafId: number | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private bars = 1;
  private lastDraw = 0;
  private reducedMotion: boolean;
  private disposed = false;

  // Explicit fields: parameter properties are not erasable TS syntax.
  constructor(canvas: HTMLCanvasElement, source: FrequencySource) {
    this.canvas = canvas;
    this.source = source;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
    // Not focusable and no handlers: it only mirrors what is playing.
    canvas.setAttribute('role', 'img');
    if (!canvas.hasAttribute('aria-label')) {
      canvas.setAttribute('aria-label', ARIA_LABEL);
    }
    this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionQuery.matches;
    this.motionQuery.addEventListener('change', this.onMotionChange);
    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(canvas);
    this.resize();
    this.unsubscribe = source.subscribe((state) => {
      if (state === 'PLAYING') this.start();
      else this.stop();
    });
    if (source.state === 'PLAYING') this.start();
  }

  start(): void {
    if (this.disposed || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastDraw = 0;
    this.ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.unsubscribe();
    this.resizeObserver.disconnect();
    this.motionQuery.removeEventListener('change', this.onMotionChange);
  }

  private readonly onMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
  };

  private readonly onResize = (): void => {
    this.resize();
  };

  // Runs on resize only, never inside the frame loop (no read/write mixing).
  private resize(): void {
    const dpr = devicePixelRatio || 1;
    this.cssWidth = this.canvas.clientWidth;
    this.cssHeight = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.cssWidth * dpr);
    this.canvas.height = Math.round(this.cssHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.gradient = this.ctx.createLinearGradient(0, this.cssHeight, 0, 0);
    this.gradient.addColorStop(0, '#2dd4bf');
    this.gradient.addColorStop(1, '#f472b6');
    this.bars = barCount(this.cssWidth, MIN_BAR_WIDTH, BAR_GAP, 256);
  }

  private readonly frame = (time: number): void => {
    this.rafId = requestAnimationFrame(this.frame);
    const slow = this.reducedMotion;
    if (slow && time - this.lastDraw < REDUCED_MOTION_INTERVAL_MS) return;
    this.lastDraw = time;
    const data = this.source.readFrequencyData();
    if (data) this.draw(data);
  };

  private draw(data: Uint8Array): void {
    const { ctx, cssWidth, cssHeight } = this;
    const usable = Math.floor(data.length * BIN_FRACTION);
    const count = Math.min(this.bars, usable);
    const width = barWidth(count, cssWidth, BAR_GAP);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = this.gradient!;
    for (let i = 0; i < count; i++) {
      const level = groupLevel(
        data,
        binStart(i, count, usable),
        binStart(i + 1, count, usable),
      );
      const height = barHeight(level, cssHeight);
      ctx.fillRect(i * (width + BAR_GAP), cssHeight - height, width, height);
    }
  }
}

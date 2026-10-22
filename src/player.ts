import { createTrackLoader } from './audio-loader.ts';
import { AudioTaskQueue } from './audio-task-queue.ts';
import type {
  AudioTaskQueue as AudioTaskQueueContract,
  PlayerState,
} from './types';

export type PlayerListener = (state: PlayerState, error?: unknown) => void;

// Spec allows 256 or 512; 512 gives 256 bins.
const FFT_SIZE = 512;

const defaultCreateContext = (): AudioContext => new AudioContext();
const defaultCreateQueue = (context: AudioContext) =>
  new AudioTaskQueue(createTrackLoader(context));

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

/**
 * Plays one track at a time. The AudioContext is created only inside
 * play(), which must be called from a user-gesture handler.
 */
export class Player {
  private context: AudioContext | null = null;
  private queue: AudioTaskQueueContract | null = null;
  private analyser: AnalyserNode | null = null;
  // One array for the player's lifetime: no per-frame allocation.
  private frequencyData: Uint8Array<ArrayBuffer> | null = null;
  private source: AudioBufferSourceNode | null = null;
  private pendingId: string | null = null;
  private currentState: PlayerState = 'IDLE';
  private disposed = false;
  private readonly listeners = new Set<PlayerListener>();
  private readonly createContext: () => AudioContext;
  private readonly createQueue: (c: AudioContext) => AudioTaskQueueContract;

  constructor(
    createContext: () => AudioContext = defaultCreateContext,
    createQueue: (c: AudioContext) => AudioTaskQueueContract =
      defaultCreateQueue,
  ) {
    this.createContext = createContext;
    this.createQueue = createQueue;
  }

  get state(): PlayerState {
    return this.currentState;
  }

  get frequencyBinCount(): number {
    return this.analyser?.frequencyBinCount ?? FFT_SIZE / 2;
  }

  /**
   * Fills and returns the shared frequency array (null before the first
   * play()). The same array is returned every call; do not keep copies.
   */
  readFrequencyData(): Uint8Array<ArrayBuffer> | null {
    if (!this.analyser || !this.frequencyData) return null;
    this.analyser.getByteFrequencyData(this.frequencyData);
    return this.frequencyData;
  }

  subscribe(listener: PlayerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Skips whatever is playing or loading and plays `trackUrl` instead. */
  async play(trackUrl: string): Promise<void> {
    // Create the context synchronously so it stays inside the user gesture.
    const context = this.ensureContext();
    this.cancelPending();
    this.releaseSource();
    this.setState('LOADING');
    const task = this.queue!.enqueueTask(trackUrl);
    this.pendingId = task.id;
    // Mark handled now: an early rejection must not go unhandled while
    // resume() is awaited. The try block below still sees the rejection.
    task.promise.catch(() => {});
    try {
      if (context.state === 'suspended') await context.resume();
      const buffer = await task.promise;
      // Superseded while awaiting (the task may already have resolved).
      if (this.pendingId !== task.id) return;
      this.pendingId = null;
      this.startSource(context, buffer);
    } catch (error) {
      // A replaced or stopped call no longer owns the state.
      if (this.pendingId !== task.id || isAbortError(error)) return;
      this.cancelPending();
      this.releaseSource();
      this.setState('ERROR', error);
    }
  }

  stop(): void {
    this.cancelPending();
    this.releaseSource();
    this.setState('IDLE');
  }

  /** Releases everything; play() throws afterwards. */
  dispose(): void {
    this.stop();
    this.disposed = true;
    this.queue?.clear();
    this.listeners.clear();
    void this.context?.close();
    this.context = null;
    this.queue = null;
    this.analyser?.disconnect();
    this.analyser = null;
    this.frequencyData = null;
  }

  private ensureContext(): AudioContext {
    if (this.disposed) throw new Error('Player is disposed');
    if (!this.context) {
      this.context = this.createContext();
      this.queue = this.createQueue(this.context);
      // Lives as long as the context; sources connect to it, it to output.
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = FFT_SIZE;
      this.analyser.connect(this.context.destination);
      this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    }
    return this.context;
  }

  private startSource(context: AudioContext, buffer: AudioBuffer): void {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser!);
    source.addEventListener('ended', this.onEnded, { once: true });
    source.start();
    this.source = source;
    this.setState('PLAYING');
  }

  private readonly onEnded = (): void => {
    this.releaseSource();
    this.setState('IDLE');
  };

  // Single exit for every source: ended, skipped, stopped or failed.
  private releaseSource(): void {
    const source = this.source;
    if (!source) return;
    this.source = null;
    source.removeEventListener('ended', this.onEnded);
    try {
      source.stop();
    } catch {
      // stop() throws InvalidStateError if the node never started.
    }
    source.disconnect();
  }

  private cancelPending(): void {
    if (this.pendingId) this.queue?.cancel(this.pendingId);
    this.pendingId = null;
  }

  private setState(state: PlayerState, error?: unknown): void {
    this.currentState = state;
    this.listeners.forEach((listener) => listener(state, error));
  }
}

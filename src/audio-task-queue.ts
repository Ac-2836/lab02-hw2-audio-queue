import type {
  AudioTask,
  AudioTaskQueue as AudioTaskQueueContract,
} from './types';

/** Downloads and decodes one track; supplied by audio-loader.ts (task 1.3). */
export type TrackLoader = (
  trackUrl: string,
  signal: AbortSignal,
) => Promise<AudioBuffer>;

export class AudioTaskQueue implements AudioTaskQueueContract {
  private queue: AudioTask[] = [];
  private isProcessing = false;
  private readonly load: TrackLoader;

  // Explicit field: parameter properties are not erasable TS syntax.
  constructor(load: TrackLoader) {
    this.load = load;
  }

  async enqueue(trackUrl: string): Promise<AudioBuffer> {
    const controller = new AbortController();
    return new Promise<AudioBuffer>((resolve, reject) => {
      this.queue.push({
        id: crypto.randomUUID(),
        trackUrl,
        controller,
        resolve,
        reject,
      });
      void this.processNext();
    });
  }

  // Drains the queue one task at a time; isProcessing is the only gate.
  private async processNext(): Promise<void> {
    if (this.isProcessing) return;
    const task = this.queue.shift();
    if (!task) return;
    this.isProcessing = true;
    try {
      task.resolve(await this.load(task.trackUrl, task.controller.signal));
    } catch (error) {
      task.reject(error);
    } finally {
      this.isProcessing = false;
      void this.processNext();
    }
  }
}

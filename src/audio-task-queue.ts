import type {
  AudioTask,
  AudioTaskQueue as AudioTaskQueueContract,
  EnqueuedTask,
} from './types';

/** Downloads and decodes one track; supplied by audio-loader.ts (task 1.3). */
export type TrackLoader = (
  trackUrl: string,
  signal: AbortSignal,
) => Promise<AudioBuffer>;

export class AudioTaskQueue implements AudioTaskQueueContract {
  private queue: AudioTask[] = [];
  private isProcessing = false;
  private activeController: AbortController | null = null;
  private activeTaskId: string | null = null;
  private readonly load: TrackLoader;

  // Explicit field: parameter properties are not erasable TS syntax.
  constructor(load: TrackLoader) {
    this.load = load;
  }

  async enqueue(trackUrl: string): Promise<AudioBuffer> {
    return this.enqueueTask(trackUrl).promise;
  }

  enqueueTask(trackUrl: string): EnqueuedTask {
    const controller = new AbortController();
    const id = crypto.randomUUID();
    const promise = new Promise<AudioBuffer>((resolve, reject) => {
      this.queue.push({ id, trackUrl, controller, resolve, reject });
    });
    void this.processNext();
    return { id, promise };
  }

  cancel(id: string): boolean {
    if (id === this.activeTaskId && this.activeController) {
      // The loader rejects on abort; processNext then rejects the task.
      if (this.activeController.signal.aborted) return false;
      this.activeController.abort();
      return true;
    }
    const index = this.queue.findIndex((task) => task.id === id);
    if (index === -1) return false;
    const [task] = this.queue.splice(index, 1);
    this.abortQueued(task!);
    return true;
  }

  clear(): void {
    // Empty the queue first so aborting the active task cannot start another.
    const pending = this.queue.splice(0);
    pending.forEach((task) => this.abortQueued(task));
    this.activeController?.abort();
  }

  private abortQueued(task: AudioTask): void {
    task.controller.abort();
    task.reject(task.controller.signal.reason);
  }

  // Drains the queue one task at a time; isProcessing is the only gate.
  private async processNext(): Promise<void> {
    if (this.isProcessing) return;
    const task = this.queue.shift();
    if (!task) return;
    this.isProcessing = true;
    this.activeController = task.controller;
    this.activeTaskId = task.id;
    const { signal } = task.controller;
    try {
      const buffer = await this.load(task.trackUrl, signal);
      // A loader that ignores the signal must not resolve a cancelled task.
      signal.throwIfAborted();
      task.resolve(buffer);
    } catch (error) {
      task.reject(error);
    } finally {
      this.isProcessing = false;
      this.activeController = null;
      this.activeTaskId = null;
      void this.processNext();
    }
  }
}

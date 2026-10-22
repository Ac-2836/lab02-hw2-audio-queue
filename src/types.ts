/** One queued download-and-decode job (HW 2 slide contract). */
export interface AudioTask {
  readonly id: string;
  readonly trackUrl: string;
  readonly controller: AbortController;
  readonly resolve: (buffer: AudioBuffer) => void;
  readonly reject: (reason: unknown) => void;
}

/**
 * Public surface of the FIFO queue. The class in audio-task-queue.ts
 * implements it and owns the slide's private state: `queue: AudioTask[]`,
 * `isProcessing: boolean`, `activeController: AbortController | null`.
 */
export interface AudioTaskQueue {
  enqueue(trackUrl: string): Promise<AudioBuffer>;
  /** Like enqueue, but also exposes the task id so it can be cancelled. */
  enqueueTask(trackUrl: string): EnqueuedTask;
  /** Cancels a queued or active task; false if the id is unknown or done. */
  cancel(id: string): boolean;
  /** Cancels every queued task and the active one. */
  clear(): void;
}

export interface EnqueuedTask {
  readonly id: string;
  readonly promise: Promise<AudioBuffer>;
}

export type PlayerState = 'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR';

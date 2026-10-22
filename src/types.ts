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
}

export type PlayerState = 'IDLE' | 'LOADING' | 'PLAYING' | 'ERROR';

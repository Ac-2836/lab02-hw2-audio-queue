import type { TrackLoader } from './audio-task-queue';

/**
 * Builds a loader that fetches a track and decodes it. Every failure
 * (abort, HTTP error, decode error) rejects, so the queue rejects the task.
 * `fetchFn` is injectable so the loader can be tested without a network.
 */
export function createTrackLoader(
  context: BaseAudioContext,
  fetchFn: typeof fetch = fetch,
): TrackLoader {
  return async (trackUrl, signal) => {
    const response = await fetchFn(trackUrl, { signal });
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} for ${trackUrl}`,
      );
    }
    const data = await response.arrayBuffer();
    // decodeAudioData takes no signal; skip it if already cancelled.
    signal.throwIfAborted();
    let buffer: AudioBuffer;
    try {
      buffer = await context.decodeAudioData(data);
    } catch (cause) {
      throw new Error(`Failed to decode ${trackUrl}`, { cause });
    }
    signal.throwIfAborted();
    return buffer;
  };
}

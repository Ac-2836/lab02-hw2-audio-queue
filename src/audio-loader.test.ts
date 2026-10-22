import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTrackLoader } from './audio-loader.ts';

const decoded = { tag: 'decoded' } as unknown as AudioBuffer;

function fakeContext(decode?: () => Promise<AudioBuffer>) {
  const calls: ArrayBuffer[] = [];
  const context = {
    decodeAudioData: (data: ArrayBuffer) => {
      calls.push(data);
      return decode ? decode() : Promise.resolve(decoded);
    },
  } as unknown as BaseAudioContext;
  return { context, calls };
}

const okFetch = (async () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  arrayBuffer: async () => new ArrayBuffer(8),
})) as unknown as typeof fetch;

describe('createTrackLoader', () => {
  it('fetches with the signal and returns the decoded buffer', async () => {
    const { context, calls } = fakeContext();
    let seen: RequestInit | undefined;
    const fetchFn = (async (_url: string, init?: RequestInit) => {
      seen = init;
      return okFetch(_url);
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    const load = createTrackLoader(context, fetchFn);
    assert.equal(await load('/a.wav', controller.signal), decoded);
    assert.equal(seen?.signal, controller.signal);
    assert.equal(calls.length, 1);
  });

  it('rejects on an HTTP error without decoding', async () => {
    const { context, calls } = fakeContext();
    const notFound = (async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    })) as unknown as typeof fetch;
    const load = createTrackLoader(context, notFound);
    await assert.rejects(
      load('/x.wav', new AbortController().signal),
      /HTTP 404 Not Found for \/x\.wav/,
    );
    assert.equal(calls.length, 0);
  });

  it('rejects with the cause when decoding fails', async () => {
    const boom = new Error('bad data');
    const { context } = fakeContext(() => Promise.reject(boom));
    const load = createTrackLoader(context, okFetch);
    await assert.rejects(
      load('/a.wav', new AbortController().signal),
      (e: Error) => /Failed to decode/.test(e.message) && e.cause === boom,
    );
  });

  it('rejects with AbortError when fetch is aborted', async () => {
    const { context, calls } = fakeContext();
    const abortable = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const controller = new AbortController();
    const result = createTrackLoader(context, abortable)(
      '/a.wav',
      controller.signal,
    );
    controller.abort();
    await assert.rejects(result, { name: 'AbortError' });
    assert.equal(calls.length, 0);
  });

  it('skips decoding when aborted after the download', async () => {
    const { context, calls } = fakeContext();
    const controller = new AbortController();
    const fetchFn = (async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => {
        controller.abort();
        return new ArrayBuffer(8);
      },
    })) as unknown as typeof fetch;
    await assert.rejects(
      createTrackLoader(context, fetchFn)('/a.wav', controller.signal),
      { name: 'AbortError' },
    );
    assert.equal(calls.length, 0);
  });
});

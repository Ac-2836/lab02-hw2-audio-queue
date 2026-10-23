# Concurrent FIFO Audio Visualizer Queue Engine

Lab 02, Homework 2. A Web Audio player with a strictly FIFO download-and-decode
queue, per-task cancellation, and a real-time frequency visualizer. Vanilla
TypeScript and Vite, no UI framework and no runtime dependencies.

## How to run

Requires Node 22 (the unit tests use `--experimental-strip-types`).

```
npm install
npm run dev              # dev server on http://localhost:5102
npm run build            # typecheck (tsc --noEmit) + production build
npm run preview          # serve the build on http://localhost:5102
npm test                 # node:test unit checks
npm run generate-tracks  # regenerate public/audio/*.wav
```

The port is fixed to 5102 (`strictPort`), so a busy port is an error, not a
silent switch.

## Features

- Add any of four tracks to a queue, as many times as you like. Tracks
  download and decode one at a time in enqueue order, while the current track
  plays.
- Play, Skip, Stop and Clear, plus a Cancel button on every queue item.
- The queue auto-advances when a track ends or is skipped.
- A failed track (HTTP error, decode error) is marked in the list with a
  readable message and the queue continues with the next track.
- Canvas frequency bars driven by `requestAnimationFrame`.
- Status text in a polite live region.

## Architecture

```
src/types.ts              contract: AudioTask, AudioTaskQueue, PlayerState
src/audio-task-queue.ts   FIFO queue, one AbortController per task
src/audio-loader.ts       fetch(url, { signal }) + decodeAudioData
src/player.ts             one AudioContext, analyser, source lifecycle
src/visualizer.ts         rAF canvas renderer
src/main.ts, styles.css   delegated-event UI driven by PlayerState
```

Data flows one way: `types` define the contract; `AudioTaskQueue` takes a
loader function, so it knows nothing about the network; `createTrackLoader`
supplies the fetch-and-decode loader; `Player` owns the context, the queue
and the audio graph; `Visualizer` reads frequency data from the player;
`main.ts` wires the DOM to the player.

- **Queue.** `enqueueTask(url)` returns `{ id, promise }`; `enqueue(url)`
  returns just the promise, as in the slide contract. A single `isProcessing`
  gate processes one task at a time, in order. Each task has its own promise.
- **Player.** The `AudioContext` and queue are created on the first call to
  `enqueue()` / `play()`, which only happen inside a click handler (user
  gesture). The graph is `AudioBufferSourceNode -> AnalyserNode -> destination`.
  The analyser uses `fftSize` 512 (256 bins) and one `Uint8Array` allocated
  once and reused for every read. State is `IDLE | LOADING | PLAYING | ERROR`,
  exposed through `subscribe()`.
- **UI.** One delegated click listener on `<main>`. The queue `<ol>` is keyed
  by task id (`data-task-id`) and updated in place; all text goes through
  `textContent`.

## Cancellation

- Every task owns an `AbortController`; its signal is passed to `fetch`.
- `cancel(id)` on a queued task removes it from the queue and rejects its
  promise with an `AbortError`; it never starts loading.
- `cancel(id)` on the active task aborts its controller, so the download is
  aborted and the promise rejects with `AbortError`. If the abort arrives
  after the download, during `decodeAudioData` (which takes no signal), it is
  noticed when decoding ends and the buffer is discarded.
- `clear()` cancels every queued task and the active one.
- A cancelled task never reaches the audio graph. The UI handles every
  `AbortError` and removes the item.

## Memory safety

- Every `AudioBufferSourceNode` leaves through one function: its `ended`
  listener is removed, `stop()` is called (guarded) and `disconnect()` is
  called. This runs on natural end, skip, stop, failure and dispose, and
  there is never more than one live source.
- The visualizer runs a single rAF loop that is cancelled on any state other
  than `PLAYING`, on `stop()` and on `dispose()`. It reuses the player's data
  array and one gradient, writes only to the canvas and keeps no per-frame UI
  state. It disconnects its `ResizeObserver` and removes its media-query
  listener on dispose.
- The measured results (heap snapshots, node counts, frame timing) are in
  [`docs/VERIFICATION.md`](docs/VERIFICATION.md).

## Back/forward cache

`pagehide` fires both on real unload and when the page enters the
back/forward cache. When `event.persisted` is true the app only stops
playback (and stops auto-advance first) and stays fully alive, so the page is
usable after Back. On a real unload it disposes the player, visualizer and
listeners.

## Accessibility

- Semantic structure: one `<main>`, `<header>`, `<section>` with headings,
  `<button>` controls and lists.
- The canvas has `role="img"` and an `aria-label`; it is not focusable.
- Playback status is announced through a `role="status"` live region.
- Buttons have visible focus rings and 44 px height; the layout works at
  375 px width.
- If a focused control is disabled or removed, focus moves to an enabled
  control instead of falling to `<body>`.
- With `prefers-reduced-motion: reduce`, the bars refresh about four times a
  second instead of every frame.

## Audio credits

The four tracks in `public/audio/` are original and royalty-free: they are
synthesized by [`scripts/generate-tracks.mjs`](scripts/generate-tracks.mjs)
(additive sine synthesis, no samples and no downloads). They are mono, 22050
Hz, 16-bit PCM WAV files: `arpeggio.wav`, `pads.wav`, `pulse.wav` and
`sweep.wav`.

## Known limits

- Tracks added after the queue has finished playing are downloaded but wait:
  press Play again to start them.
- Stop while the head track is still loading cancels that task, so it leaves
  the queue.
- A cancel that arrives during decoding takes effect when the decode ends.
- The visualizer draws the lowest quarter of the spectrum, because the demo
  tracks have little energy above it.

## Project documents

- [`docs/project-rules.md`](docs/project-rules.md): working contract and
  conventions
- [`docs/TASK_DECOMPOSITION.md`](docs/TASK_DECOMPOSITION.md): work breakdown
  structure
- [`docs/AI_FAILURE_AUDIT.md`](docs/AI_FAILURE_AUDIT.md): AI defects found and
  fixed
- [`docs/VERIFICATION.md`](docs/VERIFICATION.md): memory, performance and
  Lighthouse results

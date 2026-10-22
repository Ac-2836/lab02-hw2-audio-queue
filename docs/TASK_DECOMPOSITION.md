# TASK_DECOMPOSITION.md: HW 2 Concurrent FIFO Audio Visualizer Queue Engine

Work Breakdown Structure. One row = one atomic subtask = one AI prompt = one
verified commit. Tick a task only after I have verified it.

**Level:** Core = must master and implement myself; Awareness = understand
for debugging/lookup (Lab 02 3-tier taxonomy). **Commit** messages are used
verbatim.

| Task | Level | Scope | Constraint | Commit | Deliverables |
|---|---|---|---|---|---|
| - [x] 0.1 Scaffold project | Awareness | build | Vite + TypeScript, strict mode; royalty-free tracks in `public/audio/` | `build(setup): scaffold vite typescript project` | project config, `public/audio/*`, `.gitignore` (`evidence/`, `node_modules/`, `dist/`) |
| - [ ] 1.1 Define queue contract | Core | contract | `AudioTask`, `AudioTaskQueue` per slide; player state union `IDLE \| LOADING \| PLAYING \| ERROR` | `feat(contract): define audio queue types` | `src/types.ts` |
| - [ ] 1.2 FIFO queue core | Core | queue | Strict enqueue order; one task processed at a time; promise per task | `feat(queue): implement fifo enqueue and processing` | `src/audio-task-queue.ts` |
| - [ ] 1.3 Download and decode | Core | audio | `fetch` with `AbortSignal`; `decodeAudioData`; errors reject the task | `feat(audio): fetch and decode tracks` | loader in `src/audio-loader.ts` |
| - [ ] 1.4 Cancellation | Core | queue | `AbortController` per task; cancelled tasks reject and are removed | `feat(queue): support task cancellation` | `cancel()` / `clear()` API |
| - [ ] 1.5 Playback and cleanup | Core | audio | `AudioContext` after user gesture; `stop()` + `disconnect()` every source node on end/skip | `feat(audio): play buffers with node cleanup` | `src/player.ts` |
| - [ ] 1.6 Analyser node | Core | audio | `AnalyserNode` `fftSize` 256 or 512; single reused `Uint8Array` | `feat(audio): connect frequency analyser` | analyser wiring |
| - [ ] 1.7 Visualizer | Core | viz | Canvas/SVG via `requestAnimationFrame` at 60fps; no per-frame UI state; cancel loop on stop | `feat(viz): render frequency bars with raf loop` | `src/visualizer.ts` |
| - [ ] 1.8 Queue UI | Core | ui | Semantic controls; stable track ids as keys; delegated events; state machine drives UI | `feat(ui): assemble queue controls and track list` | `src/main.ts`, `src/styles.css` |
| - [ ] 1.9 Leak and fps audit | Core | audit | Heap snapshot shows no orphan nodes after stop; Performance panel ~60fps | `docs(audit): record memory and performance results` | `docs/VERIFICATION.md` (results; screenshots stay in local git-ignored `evidence/`) |
| - [ ] 1.10 README | Awareness | docs | How to run, architecture, audio credits | `docs(readme): document usage and architecture` | `README.md` |

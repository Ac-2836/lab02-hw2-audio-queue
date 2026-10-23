# VERIFICATION.md: HW 2 leak and fps audit (task 1.9)

Results of the memory, performance and accessibility audit of the built app.
Raw numbers come from the local, git-ignored `evidence/1.9-results.md`.

## Setup

| Item | Value |
|---|---|
| Date | 2026-10-23, about 07:40-08:10 (UTC+7) |
| Commit under test | `828e3498fe9a373a39a5c179affeb0adca878d96` (`feat(ui): assemble queue controls and track list`), clean working tree |
| URL | http://localhost:5102/ (`npm run build` + `npx vite preview`; `vite dev` for the module-level regression scripts) |
| Versions | Chrome 155.0.8059.86 (headless), Node 22.17.1, npm 11.5.2, Vite 8.3.5, TypeScript 7.0.2, playwright-core 1.48, Lighthouse 12.2.1 |
| Unit tests / build | `npm test` 40/40 pass; `npm run build` OK |

Method: real clicks in headless Chrome; CDP `HeapProfiler` (GC +
`takeHeapSnapshot`, counts parsed from the snapshot JSON) and
`Runtime.queryObjects`; CDP `Performance.getMetrics`; CDP Tracing; raw rAF
timestamps; `PerformanceObserver` `longtask`. These are not DevTools panel
screenshots; the PNG data pages say so.

## 1. Memory

Three long sessions plus a fourth with a real back/forward-cache round trip.
Each session: add all 4 tracks twice (8 items, FIFO loads), Play, Skip x2,
per-item Cancel, Stop, Play, Clear, add 4 and Play, Stop, Clear, then one
whole track played to its natural end. After each session: Clear, 800 ms
idle, 2x GC, snapshot.

| Snapshot | JS heap | DOM nodes | JS listeners | AudioBufferSourceNode | AudioBuffer | AnalyserNode | AudioContext | Detached DOM | Documents |
|---|---|---|---|---|---|---|---|---|---|
| baseline (loaded, before any click) | 760 KB | 120 | 7 | 0 | 0 | 0 | 0 | 0 | 1 |
| after session 1 | 1552 KB | 156 | 33 | 0 | 0 | 1 | 1 | 0 | 1 |
| after session 2 | 1565 KB | 156 | 33 | 0 | 0 | 1 | 1 | 0 | 1 |
| after session 3 | 1572 KB | 156 | 33 | 0 | 0 | 1 | 1 | 0 | 1 |
| after session 4 (real bfcache round trip) | 2378 KB | 390 | 62 | 0 | 0 | 1 | 1 | 0 | 12 |

- Heap over sessions 1 to 3: 1552 KB, 1565 KB, 1572 KB (+13 KB, +7 KB): flat.
  DOM nodes (156) and listeners (33) are identical after every session.
- After every session: 0 `AudioBufferSourceNode`, 0 `AudioBuffer`, exactly 1
  `AnalyserNode` and 1 `AudioContext`, 0 detached DOM nodes, 0 live source
  nodes, 0 rAF loops, 0 unhandled rejections.
- Across all 4 sessions: 25 source nodes created, started, stopped and
  disconnected (25/25/25/25), at most 1 live at any time. Console clean, no
  page errors.
- Session 4 (real bfcache restore, `pageshow` persisted=true, same document,
  app usable afterwards): heap +806 KB, nodes 156 to 390, listeners 33 to 62.
  `Documents` went 1 to 12: this is the navigated-away media document
  (`/audio/pulse.wav`) still resident in the renderer, not app objects (all
  app object counts are unchanged, 0 detached DOM nodes). It is not a trend
  measure; it is reported for completeness.

## 2. Performance

About 10 s of playback of "Chord pads" in the built app.

| Run | fps | frame median / p95 / p99 / max (ms) | frames >20 ms / >33 ms | draws per frame | rAF callback cost median / p95 / max (ms) | long tasks | script ms/s | layouts | style recalcs |
|---|---|---|---|---|---|---|---|---|---|
| native refresh (headless Chrome vsync) | 144.1 | 6.9 / 7 / 7.1 / 8.7 | 0 / 0 | 1 | 0.086 / 0.206 / 1.079 | 0 | 16.7 | 0 | 0 |
| CPU throttled 6x | 143.9 | 6.9 / 7 / 7.1 / 20.8 | 1 / 0 | 1.001 | 0.2 / 0.812 / 6.734 | 0 | 50.3 | 0 | 0 |
| CPU throttled 20x (stress) | 110.7 | 7 / 14 / 20.8 / 48.5 | 14 / 1 | 1.001 | 0.812 / 3.491 / 23.486 | 0 | 174.3 | 0 | 0 |
| `--limit-fps=60` attempt (flag ignored, still native refresh) | 144.1 | 6.9 / 7.1 / 7.2 / 7.3 | 0 / 0 | 1 | 0.059 / 0.176 / 1.107 | 0 | 12.8 | 0 | 0 |

- **144 Hz caveat:** the headless Chrome used here runs at a 144 Hz refresh
  (median frame 6.9 ms). A literal 60 Hz capture was not possible:
  `--limit-fps=60` is ignored by this headless Chrome, so that run was still
  144 Hz. The 60 fps requirement is therefore shown by headroom, not by a
  60 Hz capture: at 6x CPU throttle the page still ran 143.9 fps with 0
  frames over 33 ms (max callback 6.7 ms against a 16.7 ms budget), and at
  20x it still ran 110.7 fps.
- The visualizer draws exactly once per animation frame (1.00 draws per
  frame), so it follows the display refresh rather than capping at 60.
- 0 long tasks, 0 layouts and 0 style recalcs during playback. The rAF
  callback p95 is 0.21 ms natively (these figures include the harness' own
  rAF callback, so they overstate the app).

## 3. Lighthouse 12.2.1 (built app)

| Form factor | Accessibility | Best Practices |
|---|---|---|
| mobile | 1.00 | 1.00 |
| desktop | 1.00 | 1.00 |

No failing audits in either report.

## 4. Regression of all earlier task scripts on HEAD

Module-level scripts (tasks 1.2 to 1.7) ran against `vite dev`, UI scripts
against `vite preview`.

| Script | Covers | PASS lines | FAIL lines |
|---|---|---|---|
| task-0.1 | scaffold, decode, console | 10 | 0 |
| task-1.2 | FIFO queue | 10 | 0 |
| task-1.3 | download/decode, throttled network | 12 | 0 |
| task-1.4 | cancellation | 21 | 0 |
| task-1.5 | playback, cleanup, heap | 13 | 0 |
| task-1.6 | analyser | 21 | 0 |
| task-1.7 | visualizer | 23 | 0 |
| task-1.8-a | UI mouse session | 21 | 0 |
| task-1.8-b | keyboard, error, contrast, 375px | 25 | 0 |
| bfcache-after | real bfcache restore | 13 | 0 |

Harness note: the 1.5 script collided with the app's `#stop` id; the first
1.7 attempt hit a transient dev-server socket error; both were fixed or
re-run, not app defects.

## 5. AI failure audit

Five genuine defects in AI-generated code were found during task
verification and logged with DevTools proof and fixes in
[`AI_FAILURE_AUDIT.md`](./AI_FAILURE_AUDIT.md):

| Entry | Defect |
|---|---|
| 01 | scaffold page logs a 404 console error (favicon) |
| 02 | stale load failure overwrites the next `play()` request |
| 03 | `any` used in player test |
| 04 | app is dead after a back/forward-cache restore |
| 05 | keyboard focus falls to `<body>` when a focused queue item is removed |

## 6. Evidence files

Screenshots and reports are kept in the local, git-ignored `evidence/`
folder and are not committed. Key files:

- `1.9-memory-audit.png`, `1.9-app-after-sessions.png`: memory data page and
  the app after the sessions
- `1.9-performance.png`: performance data page (4 runs)
- `1.9-lighthouse-mobile.report.html/.json`,
  `1.9-lighthouse-desktop.report.html/.json`
- `regression-head/`: `summary.txt`, `reg-*.log`, regenerated PNGs
- `README.md`: index of all per-task evidence

## Verdict

PASS: no leak found (flat heap, 0 orphan nodes or buffers, 0 detached DOM
nodes), no dropped frames, one draw per frame, Lighthouse 1.00/1.00 on mobile
and desktop, all earlier checks still pass on HEAD. Caveat: a real 60 Hz
display could not be emulated here; 60 fps is shown by headroom at 6x and 20x
CPU throttle.

# AI Failure Audit

This report records failures observed while implementing and verifying this
homework. Each entry is logged before the AI is asked to fix the subtask.
Screenshots listed as verification evidence show the corrected UI; they are
not presented as screenshots of the original failure.

<!--
Copy this template for each failure (number entries 01, 02, 03, ...):

## AI Failure NN: <short title>

- **AI Prompt:** <the prompt / subtask given to the AI>
- **AI Generated Code:** <what the AI produced and why it is wrong>
- **Risk:** <impact if shipped: crash, XSS, leak, a11y, wrong state, ...>
- **Detection Method / DevTools Proof:** <console error, panel, snapshot,
  test, or git diff that exposed it>
- **Engineering Refactor / Manual Fix:** <the fix applied>
- **Verification Evidence:** <how the fix was verified; evidence/*.png>
-->

## AI Failure 01: scaffold page logs a 404 console error (favicon)

- **AI Prompt:** Task 0.1 Scaffold project: Vite + TypeScript strict,
  royalty-free tracks in `public/audio/`, `.gitignore`.
- **AI Generated Code:** `index.html` has no `<link rel="icon">`, so the
  browser requests `/favicon.ico`, which the server answers with 404. Every
  page load of the scaffold therefore logs a console error.
- **Risk:** Console is not clean from the first commit, which hides real
  errors later (e.g. a failed track fetch) and lowers the Lighthouse
  Best Practices score.
- **Detection Method / DevTools Proof:** Chrome console on
  `http://localhost:5102/`: "Failed to load resource: the server responded
  with a status of 404 (Not Found)". Lighthouse `errors-in-console` score 0,
  source `http://localhost:5102/favicon.ico`, Best Practices 0.96
  (`evidence/0.1-lighthouse-before-fix.json`,
  `evidence/0.1-before-fix-console.png`).
- **Engineering Refactor / Manual Fix:** added
  `<link rel="icon" href="data:," />` to `<head>` in `index.html`, so the
  browser no longer requests `/favicon.ico`.
- **Verification Evidence:** re-ran the Chrome check on the rebuilt preview:
  console empty, no page errors, all requests 200, 4 WAVs still decode.
  Lighthouse Accessibility 1.0, Best Practices 1.0, `errors-in-console`
  passes (`evidence/0.1-lighthouse-after-fix.json`,
  `evidence/0.1-after-fix-console.png`).

## AI Failure 02: stale load failure overwrites the next play() request

- **AI Prompt:** Task 1.5 Playback and cleanup: `src/player.ts` with
  AudioContext after a user gesture, stop() + disconnect() of every source on
  end/skip, state IDLE/LOADING/PLAYING/ERROR.
- **AI Generated Code:** In `Player.play()` the `catch` block ignores only
  `AbortError`. For any other error it sets `this.pendingId = null`, releases
  the source and sets `ERROR` without checking that the failed task is still
  the current one (`this.pendingId === task.id`). The success path has that
  guard; the error path does not. Also, `task.promise` is awaited only after
  `await context.resume()`, so a task that rejects during the resume gets no
  handler attached in time.
- **Risk:** If play(A) fails (HTTP 404, decode error) while it is still
  waiting for `resume()` of a suspended context (Safari/iOS, or a context
  created without activation) and the user skips to B, A's late catch clears
  B's `pendingId`. B's buffer is then dropped by the `pendingId !== task.id`
  check, the player sticks in ERROR and B never plays. The same stale catch
  runs for a cancelled task whose loader fails with a non-abort error (e.g.
  `Failed to decode` while being skipped). The early rejection also fires an
  `unhandledrejection` page error.
- **Detection Method / DevTools Proof:** Chrome harness with a real
  `AudioContext` created suspended and `resume()` delayed 400 ms:
  `play('/favicon.ico')` (404 in about 30 ms), then `play('/audio/pulse.wav')`
  after 150 ms. State log `LOADING, LOADING, ERROR, IDLE`; final state ERROR
  (expected PLAYING); `pageerror`/`unhandledrejection`
  "Error: HTTP 404 Not Found for /favicon.ico"
  (`evidence/1.5-before-fix-playback-cleanup.png`).
- **Engineering Refactor / Manual Fix:** `play()` now attaches
  `task.promise.catch(() => {})` right after `enqueueTask`, so an early
  rejection is handled while `resume()` is awaited, and the `catch` returns
  early when `this.pendingId !== task.id || isAbortError(error)` before
  touching state. A unit test covers "A fails during resume, B supersedes,
  B plays".
- **Verification Evidence:** same Chrome race harness re-run after the fix:
  state log `LOADING, LOADING, PLAYING, IDLE`, final state PLAYING, no
  `unhandledrejection` and no page errors; gesture, natural end, 20 skips
  and heap counts unchanged and passing
  (`evidence/1.5-after-fix-playback-cleanup.png`). `npm test` 24 of 24.

## AI Failure 03: `any` used in player test

- **AI Prompt:** Task 1.5 Playback and cleanup (unit self-check for the
  player).
- **AI Generated Code:** `src/player.test.ts` uses `any` in
  `addEventListener(type: string, cb: any, opts?: any)`,
  `removeEventListener(...)` and `as any` casts on the Player constructor
  arguments (lines 27, 31, 89, 90).
- **Risk:** Breaks the standing rule "TS types: avoid `any`; use `unknown` or
  a specific interface/type"; hides signature drift between the fakes and the
  real DOM/Player types.
- **Detection Method / DevTools Proof:** `grep -nE "\bany\b"
  src/player.test.ts` returns 4 matches (git diff review).
- **Engineering Refactor / Manual Fix:** removed every `any` from
  `src/player.test.ts` (specific DOM listener/option types and
  `as unknown as` casts for the fakes).
- **Verification Evidence:** `grep -nE "any" src/*.ts` returns nothing;
  `npm test` 24 of 24 and `npm run build` pass after the change.

## AI Failure 04: app is dead after a back/forward-cache restore

- **AI Prompt:** Task 1.8 Queue UI: `src/main.ts`, `index.html`,
  `src/styles.css`; semantic controls, delegated events, state machine drives
  the UI, cleanup of every listener.
- **AI Generated Code:** `main.ts` registers
  `window.addEventListener('pagehide', ..., { once: true })` whose handler
  removes the click listener, unsubscribes, disposes the visualizer and calls
  `player.dispose()` (which closes the AudioContext). `pagehide` also fires
  when the page enters the back/forward cache (`event.persisted === true`);
  the page is later restored as the same document, but nothing is rebuilt.
- **Risk:** After the user navigates away and presses Back, the page looks
  alive (it still shows "Playing Bass pulse." with Stop enabled) but every
  button is dead: the click listener is gone, the player is disposed and the
  AudioContext is closed. The user has to reload manually.
- **Detection Method / DevTools Proof:** Real Chrome with bfcache enabled
  (`pageshow` log `persisted:false` then `persisted:true`, same document
  marker kept): play Bass pulse, navigate to `/audio/arpeggio.wav`, go Back.
  UI snapshot unchanged ("Playing Bass pulse."), `AudioContext.state ===
  'closed'`, clicking "Add to queue" adds no item, rAF loops 0
  (`evidence/1.8-before-fix-bfcache-restored.png`).
- **Engineering Refactor / Manual Fix:** the `pagehide` handler is no longer
  `{ once: true }` and branches on `event.persisted`: when persisted it sets
  `mode = 'STOPPED'` first and then calls `player.stop()` (so stopping does
  not auto-advance) and returns; otherwise it removes the listeners and does
  the full dispose. A `pageshow` handler calls `render()` when
  `event.persisted`.
- **Verification Evidence:** real bfcache restore in Chrome, two round trips
  (`pageshow` persisted=true, same document marker): AudioContext `running`
  (not closed), no rAF loop, no live source node, UI shows "Stopped. Press
  Play to start the queue." with the queue intact and Play enabled, Add
  works, Play works and the visualizer restarts; no unhandled rejections
  (`evidence/1.8-after-fix-bfcache-restored.png`).

## AI Failure 05: keyboard focus falls to `<body>` when a focused queue item is removed

- **AI Prompt:** Task 1.8 Queue UI (accessibility: semantic controls,
  keyboard use).
- **AI Generated Code:** `render()` is meant to rescue focus when the focused
  control disappears, but its guard is
  `focused instanceof HTMLElement && root.contains(focused) && (!focused.isConnected || ...)`.
  `focused` is read before `syncList()` removes the `<li>`, and after
  removal `root.contains(focused)` is false, so the fallback branch can never
  run for a removed element (the `!focused.isConnected` test is unreachable
  in practice).
- **Risk:** A keyboard or screen-reader user who activates a per-item
  "Cancel" button (Tab, Enter) loses focus to `<body>` and must Tab from the
  top of the page again (WCAG 2.4.3 focus order / 2.4.7).
- **Detection Method / DevTools Proof:** Real keyboard session in Chrome:
  Tab to "Cancel Bass pulse", Enter; `document.activeElement` is `BODY`
  afterwards, while "focus not stranded after Play disables itself" passes
  (that button stays in the DOM)
  (`evidence/1.8-before-fix-session-b.png`).
- **Engineering Refactor / Manual Fix:** `render()` now computes
  `const hadFocus = focused instanceof HTMLElement && root.contains(focused)`
  before `syncList()`, and moves focus to the first enabled fallback button
  when `hadFocus` and the element is disconnected or disabled.
- **Verification Evidence:** the same real keyboard session (Tab to "Cancel
  Bass pulse", Enter) now leaves focus on the Stop button instead of
  `<body>`; Play-disables-itself case still passes; Lighthouse Accessibility
  1.0 and Best Practices 1.0 (`evidence/1.8-session-b-after-fix.png`,
  `evidence/1.8-lighthouse-after-fix.json`).

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

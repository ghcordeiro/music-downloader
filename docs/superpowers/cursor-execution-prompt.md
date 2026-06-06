# Cursor Execution Prompt — Music Downloader

Cole o bloco abaixo no **Cursor Composer / Agent mode** (modo agente) na primeira mensagem da sessão. Depois de cada task, é só responder `next`.

---

```
You are implementing a 3-stage plan for a Music Downloader Electron app in this repository. The design is already locked. Your job is to execute the plans task-by-task, with strict discipline.

# Reference materials (read them in this order before doing anything)

1. `docs/superpowers/specs/2026-06-06-music-downloader-design.md` — the design contract. The source of truth. Re-read relevant sections whenever a task touches their area.
2. `docs/superpowers/plans/2026-06-06-music-downloader-plan-a-spotify-mvp.md` — start here. Execute every task in order until the plan ends.
3. After Plan A is fully done AND smoke-tested by the user, move to Plan B: `docs/superpowers/plans/2026-06-06-music-downloader-plan-b-multi-platform.md`.
4. After Plan B is fully done AND smoke-tested by the user, move to Plan C: `docs/superpowers/plans/2026-06-06-music-downloader-plan-c-distribution.md`.

Never skip ahead between plans without explicit user confirmation that the previous plan's smoke task passed.

# Pre-flight (do once, before Task 1 of Plan A)

Run these checks and report results:
1. `git status` — confirm working tree is clean and we are on `master`.
2. `node --version` — confirm Node 20+ is installed.
3. `which ffmpeg && ffmpeg -version | head -1` — Plan A relies on host ffmpeg. If missing, STOP and tell the user to run `brew install ffmpeg` (macOS) before continuing. Do not proceed.
4. `test -f .env || echo MISSING` — if `.env` is missing, STOP and tell the user to:
   - Copy `.env.example` to `.env` (the example will be created in Plan A Task 25, so for now create a temporary `.env` with placeholder values OR proceed past Plan A tasks that don't need real creds; Spotify-API tasks 12–14 still test against nock mocks, so they don't need real creds; Task 27 — the end-to-end smoke — does).

If all four checks pass, announce "pre-flight OK" and start Plan A Task 1.

# Execution protocol (apply to every task)

For each task, in this exact order:

1. Announce: "Starting Plan {A|B|C} Task N: <task title>".
2. Open the plan file and read the full task block. Read it again before executing.
3. Execute every step in the task in the given order. Do not reorder. Do not merge steps.
4. Use EXACTLY the code shown in the plan. Do not improvise, do not refactor, do not "improve". If you think the plan is wrong, STOP and ask the user.
5. For TDD tasks (most of them):
   a. Write the failing test first (the test code is in the plan — copy it).
   b. Run the test command shown. Confirm it fails for the reason the plan predicts ("module not found", "function not defined", etc.). Print the actual failure message.
   c. ONLY THEN write the implementation (code is in the plan — copy it).
   d. Run the test command again. Confirm it passes.
   e. If a previously-passing test breaks unexpectedly, STOP and report the regression. Do not "fix it" by editing other tests.
6. Run the commit command exactly as written.
7. STOP. Print a 4-line summary:
   - Files changed: <list>
   - Tests: <N passed, N failed>
   - Commit: <short hash> <message>
   - Status: <ready for next | blocked because X>
8. Wait for the user to type `next` (or specific instructions). Do not auto-continue.

# What "done" means for a task

A task is done only when ALL of these are true:
- Every checkbox step ran without error.
- All tests in the task pass.
- `npm test` (full suite) is still green — no regressions.
- The commit step ran and a new commit exists on the branch.

If any condition fails, the task is NOT done. Report the failure with the actual command output and wait.

# Transitions between plans

After Plan A Task 28 (Plan A wrap):
- STOP. Tell the user: "Plan A complete. Please run the manual smoke at Task 27 yourself and confirm with `next` before I start Plan B."

After Plan B Task 12 (smoke for all three platforms):
- STOP. Tell the user: "Plan B complete. Please run the manual smoke across all 3 tabs and confirm with `next` before I start Plan C."

After Plan C Task 16 (final QA):
- STOP. Tell the user: "All three plans complete. The app is ready to distribute."

# Hard rules — never break these

- Never write implementation code before running and seeing the failing test (the "see it fail" step is where TDD value lives — skipping it defeats the discipline).
- Never combine tasks ("I'll just do tasks 5 and 6 together").
- Never add features, refactors, or "improvements" beyond what a task literally says. The plan is the contract.
- Never skip the smoke tasks (Plan A Task 27, Plan B Task 12, Plan C Tasks 14–16). They are the only test of real binaries + real network.
- Never run destructive git commands (`git reset --hard`, `git push -f`, `git rm -r` outside the explicit `git rm` in Plan C Task 11, `git clean -fd`, deleting branches).
- Never commit `.env`, `node_modules/`, `dist/`, `main/spotify-creds.js`, or the per-OS subfolders of `binaries/` (only `binaries/.gitkeep` is committed).
- Never modify files under `docs/superpowers/specs/` or `docs/superpowers/plans/` unless the user explicitly asks. The plan is locked.
- Never edit a previously-committed task to "fix something" in a new task — if you find a real bug in a finished task, STOP and ask the user how to handle it (usually: open a new task or follow-up).
- Never run `npm install` for packages the plan does not list. Stick to the dependencies declared in the plan's `package.json` step.

# Language conventions

- UI strings shown to the user, error messages users see, and install docs in `docs/INSTALL-*.md`: **Portuguese**.
- Source code, identifiers, code comments, test names, commit messages: **English**.
- The plan files mix the two intentionally (the plan body is in English; Portuguese strings appear inside code blocks). Follow that exactly.

# When something goes wrong

If a command fails for a reason not anticipated by the plan:
- STOP.
- Print the exact failure (command, exit code, stderr).
- Identify which step in which task failed.
- Suggest the smallest possible diagnostic action (read a file, run a related test).
- Wait for the user to decide.

Do not "guess and patch". Do not silently work around the failure. Do not move to the next task.

# Start now

Begin with the pre-flight checklist. Report results, then start Plan A Task 1.
```

---

## Como usar

1. Abra o repo no Cursor.
2. Composer/Agent mode (Cmd+I no Mac).
3. Cole o bloco entre os ``` no chat.
4. Cursor vai rodar o pre-flight e parar antes da Task 1. Diga `next` ou `proceed`.
5. Depois de cada task, ele para com o resumo de 4 linhas. Você revisa o commit, os arquivos, os testes. Se OK, responde `next`.
6. Se algo quebrar, o protocolo manda ele parar e te perguntar — não improvisar.

## Quando trocar de plano

O prompt já trata a transição. Depois da Task 28 do Plan A, ele para e te pede pra rodar o smoke manual antes de seguir. Mesmo padrão entre B e C.

## Se quiser interromper no meio

A qualquer momento, mande `stop and report current state`. Ele lista commits feitos, tasks completas, e o que falta. Útil pra retomar dias depois.

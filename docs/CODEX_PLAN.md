# Codex Implementation Brief – "Generate-and-Import" Feature for ContextPlus

This document is the **single source of truth** that Codex agents will reference while executing the 12 incremental tasks described in the companion roadmap.
It explains the existing architecture, coding conventions, new UX requirements, API contracts, data models, and success criteria—so each task can be delivered independently while remaining perfectly aligned with the final vision.

---

## Progress Checklist

Use the following list to track completion status for each task.

- [x] **Task 0** – IDB schema bump → `tasks` store
- [x] **Task 1** – AI Instructions UI & validation
- [x] **Task 2** – Generate Updates button
- [x] **Task 3** – `buildContextBundle()` helper
- [x] **Task 4** – Prompt Preview modal
- [x] **Task 5** – Seed "Code" & "Ask" presets
- [x] **Task 6** – `buildPrompt()`
- [ ] **Task 7** – LLM call & Task persistence
- [ ] **Task 8** – Parse model output & diff UI
- [ ] **Task 9** – `applyPatchLowLevel()` plumbing
- [ ] **Task 10** – Task list polling & icons
- [ ] **Task 11** – Settings toggle: Dry-run / Beta
- [ ] **Task 12** – Polish & edge cases

---

## 1  Existing Codebase (high-level)

| Layer                   | Files                                                     | Purpose                                                                                                                               | Notes                                |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Client (Vanilla JS)** | `app.js`, `index.html`, `style.css`                       | SPA served statically (Netlify). Handles GitHub OAuth, repo tree browsing, file selection, clipboard copy, file-description workflow. | No bundler; write plain ES2020.      |
| **Persistence**         | `indexedDB` (name `contextplus`, v3)                      | Stores `settings`, `instructions`, `descriptions`. Fallback to `localStorage` when IDB unavailable.                                   | Utility helpers `idbGet` / `idbSet`. |
| **Back-end glue**       | Netlify functions `exchange.js`, `llm-proxy.js`           | • `exchange` → OAuth token exchange.  • `llm-proxy` → Forwards LLM calls (OpenAI, Anthropic, Google).                                 | Deployed automatically by Netlify.   |
| **GitHub API access**   | Direct `fetch()` from browser using personal OAuth token. | Current usage: list repos, branches, trees, raw file contents.                                                                        | No server-side cache.                |
| **UI helpers**          | Custom modals, toasts, drag-and-drop card list.           | All live in `app.js` and `style.css`.                                                                                                 |                                      |

---

## 2  New Business Logic

### 2.1  "Generate Updates" Workflow (Happy Path)

1. **User configures**: selects files / descriptions / custom instructions, writes optional "AI Instructions".
2. Clicks **Generate Updates** → *Prompt Preview* modal appears.
3. User confirms → request POSTed to `/.netlify/functions/llm-proxy`.
4. Model returns JSON header `{ "title": "…"} ` + `patch` block (unified diff).
5. Patch saved to IndexedDB `tasks` store, displayed at top of *Task List*.
6. User hits **Apply Patch** → low-level Git plumbing creates new branch, commit, PR.
7. Task status auto-polls PR until merged.

### 2.2  Task Lifecycle States

```
pending   → error (retry) → pending …
pending   → open_pr      → merged
```

### 2.3  Modes

* **Code** mode ⇒ generate diff (default).
* **Ask** mode ⇒ normal answer; SYSTEM message swapped.

---

## 3  New Data Structures

### 3.1  IndexedDB `tasks` Store

```ts
interface Task {
  id: number;             // autoIncrement
  title: string;          // from model
  prompt: string;         // full human-readable prompt
  patch: string|null;     // unified diff or null until received
  branch: string|null;    // ai/YYYYMMDD-HHMM-slug
  prUrl: string|null;     // GitHub PR HTML link
  status: "pending" | "error" | "open_pr" | "merged";
  created: number;        // Date.now()
}
```

### 3.2  Context Bundle (sent to LLM)

```jsonc
{
  "files":      [ { "path": "...", "text": "..." } ],
  "instructions": [ "user-authored …" ],
  "aiRequest": "free-form text | null",
  "descriptions": [ "… optional file summaries …" ]
}
```

---

## 4  Prompt Templates

### 4.1  **Code** (unified diff) – default preset

````text
SYSTEM:
You are an automated code-modification agent.
Return ONE unified git patch wrapped in ```patch … ```; no commentary.

USER:
Repository root is / (ContextPlus).
Current branch: {{currentBranch}}.
Please implement the following change(s):

{{aiRequest or "None"}}

{{instructions (any number, numbered)}}

Context files follow.
>>> path/to/file.ext
<file text>
<<< END FILE
...
Remember: output only ONE patch block.
````

### 4.2  **Ask** – Q&A preset

Same prose but **omit** diff instructions; response may be free-form.

---

## 5  GitHub API Contract (Low-level path 6B)

1. **GET** `.../git/ref/heads/:base` → `baseSha`.
2. For each new/changed file in diff: **POST** `.../git/blobs` ⇒ `blobSha`.
3. Assemble **tree** object referencing blobShas; **POST** `.../git/trees` ⇒ `treeSha`.
4. **POST** `.../git/commits` (parent = `baseSha`, tree =`treeSha`) ⇒ `commitSha`.
5. **POST** `.../git/refs` `{ ref: "refs/heads/{{branch}}", sha: commitSha }`.
6. **POST** `/pulls` `{ head: branch, base: currentBranch }`.

Fallback: if any step fails due to size or 422 ⇒ revert to per-file `PUT /contents` path.

---

## 6  UI Additions

| Element                  | id / selector                                | Notes                                   |
| ------------------------ | -------------------------------------------- | --------------------------------------- |
| AI Instructions textarea | `#ai-instructions`                           | Always visible above Output.            |
| Include-toggle           | `#ai-instructions-toggle`                    | Feeds “AI Request” card.                |
| Generate Updates button  | `#generate-btn`                              | Disabled unless ready.                  |
| Prompt Preview modal     | `#prompt-modal`                              | Two tabs “Prompt” / “Payload”.          |
| Task List panel          | `#task-list`                                 | List of Task rows (new column/section). |
| Restore default button   | inside Instruction modal when preset id < 0. |                                         |

Iconography: use small SVGs already in codebase (`git-branch`, `check`, `x-circle`, etc.).

---

## 7  Global Constants

```js
const TASK_POLL_INTERVAL = 60_000;   // 60 s
const MAX_PATCH_LINES     = 10_000;
const MAX_PROMPT_TOKENS   = 128_000; // approx chars/4.7
```

---

## 8  Coding Conventions

* **Vanilla JS only**; keep all new client logic in `app.js`.
* Prefer small helper functions over new libraries; the only external addition allowed is a ≤2 kB diff parser (`diffparser` npm UMD build, fetch via CDN).
* Maintain existing logging style: `log('contextplus', ...)`.

---

## 9  Error Handling & UX

* Toast for **validation errors** (missing AI instructions, empty diff, etc.).
* Task rows show retry button if status=`error`.
* Periodic PR polling stops when merged or when tab hidden (use `document.visibilityState`).
* Dry-run: if enabled, skip Steps 5-6 (GitHub writes) and mark task `open_pr (dry-run)`.

---

## 10  Roadmap Tasks (Reference)

| Task | Focus                           | Outcome                       |
| ---- | ------------------------------- | ----------------------------- |
| 0    | IDB schema bump → `tasks` store | Migration completes silently. |
| 1    | AI Instructions UI & validation | “AI Request” card appears.    |
| 2    | Generate Updates btn            | Ready gating.                 |
| 3    | `buildContextBundle()` helper   | Shared by copy & generate.    |
| 4    | Prompt Preview modal            | JSON + text tabs.             |
| 5    | Seed “Code” & “Ask” presets     | Restore-default support.      |
| 6    | `buildPrompt()`                 | Produces final string.        |
| 7    | LLM call & Task persistence     | Row shows “pending”.          |
| 8    | Parse model output & diff UI    | Row shows diff + Apply btn.   |
| 9    | `applyPatchLowLevel()` plumbing | PR created / fallback 6A.     |
| 10   | Task list polling & icons       | Merged state shown.           |
| 11   | Settings toggle: Dry-run / Beta | Flags respected at runtime.   |
| 12   | Polish & edge cases             | Size limits, rate-limit, CSS. |

---

## 11  Acceptance Criteria

* Creating, applying, and merging a simple two-line change succeeds end-to-end within one minute.
* Cancelling in the Prompt Preview leaves no orphan tasks.
* Dry-run leaves GitHub untouched and marks task accordingly.
* UI works in both light and dark themes.
* No console errors in latest Chrome / Firefox.

---

**Make sure every Codex task PR:**

1. Touches only the files listed in the roadmap section for that task.
2. Contains **manual test instructions** in the description.
3. Passes `npm run lint` (if added later) and existing Netlify build.


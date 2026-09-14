# Pi Thread Memory v0 Implementation Plan

> Superseded for backend and modal behavior by `2026-09-14-approved-repairs.md`; retained as the original lifecycle implementation record.

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Build the complete session-local Pi thread-memory extension defined by the v0 contract.

**Architecture:** Keep the model-independent lifecycle, schema validation, branch capture, and rendering in a small core; use one atomic JSON store and one Pi-specific command/UI adapter. The approved repair replaces direct selected-model calls with Agy-first isolated inference and ENOENT-only Pi fallback.

**Tech Stack:** TypeScript, Node.js built-ins, Pi extension/TUI/AI APIs, Node's built-in test runner.

---

### Task 1: Lock lifecycle behavior with failing tests

**Files:** Create `test/core.test.ts`, `package.json`, `tsconfig.json`.

Test compatible edited refresh, incompatible/unknown/reset exclusion, compaction ancestry, failure/cancellation atomicity, fixed capture labels, non-mutating Ask/export/steer, undo, validation, and serialized mutations. Run `npm test` and confirm failure because the core is absent.

### Task 2: Implement the minimal model-independent core and store

**Files:** Create `src/core.ts`, `src/profile.ts`, `src/storage.ts`.

Implement the generic document schema/profile contract, bounded newest-lineage capture, mechanical ancestry classification, whole-document parsing, prompts, lifecycle state transitions, render/export helpers, mutation queue, and same-directory temp-file rename persistence. Run `npm test` to green.

### Task 3: Add the Pi extension and TUI

**Files:** Create `src/index.ts`, `src/ui.ts`.

Register deterministic `/thread` routing; use the selected Pi model with a fresh request session; add cancellable generation, confirmations, summary/full/Ask modals, optional latest response, focus, edit/undo, export, and copy-only steering. Run `npm run typecheck` and correct API mismatches.

### Task 4: Document and verify the package

**Files:** Create `README.md`, `.gitignore`.

Document install/use, storage and privacy boundaries, and honest v0 limitations. Run fresh `npm test`, `npm run typecheck`, and `npm pack --dry-run`; inspect the resulting file list. Do not commit, publish, or change Pi global configuration.

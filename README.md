# Pi Buddy

An on-demand, session-local working-memory sidecar for Pi. It summarizes the current conversation lineage into a validated local document without injecting anything into Pi's main model context.

## Install

Requires Node.js 22.19+ and Pi 0.85.1 or a compatible release.

```bash
pi install npm:pi-thread-buddy
```

For development without changing Pi configuration:

```bash
pi -e ./src/index.ts
```

## Use

`/thread` is the only slash command; it only handles extension mechanics:

```text
/thread                open saved memory; create it if absent
/thread <text>         open (creating if absent), then run <text> as if typed into the bar below
/thread doctor         check Agy and Pi fallback readiness
/thread config         choose the thread's Agy model or reasoning effort
```

Everything else — memory *content* — happens through the input bar pinned at the bottom of the modal. Type a question and press Enter to Ask the saved memory (the default mode); `/`-prefixed bar commands do everything else:

```text
<question>                     ask saved memory, streamed into the modal body
/edit <instruction>            revise memory with natural language (one-step /undo)
/steer <intent>                draft a copyable prompt for Pi; C copies, nothing is sent automatically
/focus <instruction>           set guidance for the next refresh or reset
/focus clear                   clear focus
/refresh                       rebuild from compatible prior memory + current lineage
/reset                         confirmed rebuild from current lineage only
/full                          switch to the Full tab
/export [md|json]              export into the current working directory
/undo                          undo the last memory edit once
/help                          static help: bar commands, keys, and content vs. mechanics
```

Typing `/` at the start of the bar shows an inline hint of the available commands, narrowed as you keep typing. Bar commands are parsed deterministically by one router shared between the bar and `/thread <text>`; unrecognized `/word` input shows an error without leaving the current view.

Generation, editing, Ask, and Steer use Agy independently of Pi's selected model and authentication. The per-thread defaults match Bro: `gemini-3.7-flash` with `low` effort. Agy runs in a temporary sandbox directory with slash commands disabled; prompts use NDJSON on stdin, responses stream into the same modal, and structured memory output is hidden until it validates. Escape cancels the child process.

Only a spawn `ENOENT` (Agy is absent from `PATH`) falls back once to an isolated request through Pi's selected model. An explicit thread effort is passed to Pi; `default` inherits Pi's current thinking setting (or low if unavailable). Authentication, quota, model, timeout, cancellation, process, and malformed-output failures stay visible and never trigger fallback. A persistent footer notice identifies an ENOENT fallback; install/sign in to Agy and use `/thread doctor` and `/thread config` to resolve it. The extension never installs Agy or edits global Pi configuration.

The modal keeps loading, streaming, result, and error states in one overlay, with the bar always pinned at the bottom. Summary and Full are instant local tabs (`Tab`/`Shift+Tab`, or `/full`) with independent scroll positions. Use arrows, Page Up/Down, mouse wheel, or trackpad to scroll; with an empty draft, `C` copies only the displayed view, `R` retries the same captured bar command, and `L` expands a captured latest Pi response when Ask included one. `Esc` clears a non-empty draft first, then closes or cancels. Steer never copies automatically.

Memory-changing operations run one at a time, validate the whole returned JSON document, and atomically replace the previous file only after success. A failed retry keeps the previous successful result visible.

Cancellation is honored through the final check immediately before the atomic rename. The rename is the commit boundary; once dispatched, a completed commit cannot be rolled back by a later abort.

State is stored under Pi's agent directory in `buddy-memory/`, keyed by a hash of the Pi session ID. It contains the profile/version, generated memory and summary, focus, captured Pi head and coverage, edit status, one-step undo state, and per-thread Agy model/effort. Older state without those settings remains readable and receives defaults only when next saved. Exports use the full session hash and an exclusive numeric suffix when needed, so an existing export is never overwritten.

## Boundaries and limitations

- v0 is interactive-TUI only and ships one software-development profile; the core document shape is profile-neutral.
- Source capture keeps a bounded newest portion of the active branch. Earlier material may survive through prior memory or Pi compaction summaries, but preservation is not lossless.
- Compatibility is deliberately coarse: prior memory is reused only when its captured entry is still on the active lineage. Rewinds, divergence, session mismatch, or unknown ancestry discard it after confirmation; branches are not merged.
- Repeated consolidation can preserve mistakes or lose detail. User edits can be superseded by explicit newer conversation.
- Memory reflects conversation claims and corrections, not fresh repository, ticket, PR, or CI verification.
- There is no background indexing, automatic context injection, cross-session aggregation, durable correction ledger, item-level provenance, or dedicated diagram system.

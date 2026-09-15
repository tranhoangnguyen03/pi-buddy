# Changelog

All notable changes to pi-buddy are documented here.

## [0.2.0] - 2026-09-14

### Changed

- Modal input bar: the Thread memory modal now pins a pi-btw-style input bar at the bottom. Default mode is Ask (type a question, press Enter, streams into the body and replaces the current result). `/`-prefixed bar commands cover the rest of memory content: `/edit`, `/steer`, `/focus` (and `/focus clear`), `/refresh`, `/reset`, `/full`, `/export [md|json]`, `/undo`, and `/help` (static, no model call). Typing `/` shows an inline completion hint of available commands. One shared router parses bar input for both the bar itself and `/thread <text>` preload — there is no duplicated parsing.
- Simplified `/thread`: it now only handles extension mechanics — `/thread` (open, create if absent), `/thread <text>` (open and preload `<text>` through the bar router), `/thread doctor` (unchanged), and the new `/thread config` (a Model / Effort / Done menu that replaces `/thread model` and `/thread effort`).
- `Esc` now clears a non-empty bar draft first, then closes/cancels as before. `C`, `R`, and `L` still work as single-key shortcuts when the draft is empty.

### Removed

- Slash subcommands `/thread refresh`, `/thread reset`, `/thread full`, `/thread export`, `/thread steer`, `/thread edit`, `/thread focus`, `/thread undo`, `/thread model`, and `/thread effort` — this logic now lives behind the shared bar router, reachable from the modal's input bar or via `/thread <text>`.

### Notes

- Stored thread settings (`settings.model` / `settings.effort`) keep the same on-disk shape; `/thread config` reads and writes them exactly as `/thread model`/`/thread effort` did.

## [0.1.0] - 2026-09-14

Initial release.

### Added

- On-demand, session-local working-memory sidecar for Pi: `/thread` opens the saved summary and creates memory if absent; `/thread refresh` rebuilds from compatible prior memory plus the current lineage; `/thread reset` rebuilds from the current lineage only, with confirmation.
- Bro-style single modal: streaming generation, native Summary/Full tabs (Tab/Shift+Tab) with independent scroll positions, mouse/trackpad scrolling, `C` copy of the displayed view, `R` retry on the same captured input (a failed retry restores the previous good result inline), `L` latest-response expansion for Ask, and `Esc` close/cancel.
- Natural-language memory operations: Ask (`/thread <question>`, optionally including the latest completed Pi response), Edit (`/thread edit <instruction>` with one-step undo), Focus (`/thread focus`), Export (`/thread export [md|json]`), and copy-only steering prompts (`/thread steer <intent>`).
- Agy-first inference backend: sandboxed temporary working directory, stdin NDJSON stream-json framing, cancellation and timeout handling, with fallback to Pi's selected model only when the Agy executable is missing. `/thread model`, `/thread effort`, and `/thread doctor` configure and diagnose the backend.
- Compaction-aware refresh that carries prior memory forward, conservative branch exclusion when the captured head is no longer on the active lineage, atomic versioned JSON storage, and serialized memory mutations.

### Notes

- Memory represents conversation material and user corrections, not independently verified repository, ticket, PR, or CI state.
- TUI-only; one software-development memory profile ships, with a profile-neutral core.

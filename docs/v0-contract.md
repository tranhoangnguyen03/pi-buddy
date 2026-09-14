# Pi Thread Memory — v0 contract

Status: agreed product direction, consolidated for implementation.

## Purpose

An on-demand, session-local working-memory sidecar for Pi. Help the user reconstruct the mental state needed to resume, understand, judge, and steer work without replaying the conversation.

Memory represents selected conversation material and user corrections—not independently verified repository, ticket, PR, or CI state.

## Boundaries

- One saved memory per Pi session. No cross-session aggregation.
- No background indexing, autonomous project exploration, or automatic injection into Pi's working context.
- Software development is the first memory profile. The core and UI must not hard-code software-development categories.
- Memory is a useful interpretation, not a complete archive or an authoritative record of live project state.

## Memory lifecycle

### First open

Capture the available current conversation lineage, bounded to the input budget. Generate and validate a complete memory document, save it, and show its summary.

### Subsequent opens

Open saved memory without a model call or implicit refresh. Show capture time, source coverage, edited status, and whether the conversation position has changed.

### Refresh

For compatible continuation, including compaction:

```
previous saved memory + available conversation + profile + focus
    → complete replacement memory
```

Compatibility means the previous captured entry remains an ancestor of, or equals, the current captured head. Determine compatibility mechanically; do not ask the model to reason about tree IDs.

Conversation input may overlap previously processed material. The model consolidates it; v0 has no patch protocol, incremental cursor, or item-level provenance.

Indexer instructions:

- Preserve useful prior information unless supplied conversation explicitly changes or contradicts it.
- Absence from available conversation does not mean an earlier fact or decision was removed.
- Distinguish proposals, accepted decisions, assumptions, reported claims, and observed results in the memory content.
- Keep unresolved contradictions visible; do not invent their resolution.
- Preserve relevant rationale and superseded choices where useful for understanding current work.
- Focus changes emphasis, not factual authority.
- Never present remembered validation as fresh verification of current code.

### Rewind, divergence, or unknown compatibility

Exclude prior memory and generate from the selected available lineage only. Before proceeding, visibly explain that incompatible prior memory and its edits will not carry forward. Allow cancellation.

This is conservative: v0 does not merge branches or recover compatible portions of old memory.

### Reset

An explicit action regenerates memory from available current conversation only, without prior memory. Require confirmation that edits and pre-compaction details may be lost.

Reset is the recovery path for accumulated interpretation errors. It is not the ordinary refresh operation.

### Compaction and bounded coverage

Prior memory carries useful information through compaction. It does not guarantee lossless historical preservation.

Use the current lineage available through Pi's APIs. If it exceeds the request budget, retain a bounded newest portion and disclose the omission. Budget against the exact compact prior-memory serialization and final framed prompt. Coverage counts only entries that contribute serialized source; metadata and explicitly context-excluded commands do not inflate totals or omissions. Indicate when earlier information is carried through prior memory rather than supplied conversation.

Do not assume compaction deletes stored session entries. Verify Pi's actual ancestry and compaction APIs before implementing source capture.

### Atomicity and concurrent activity

- Capture source position and material before generation starts.
- Results belong to that captured position, even if Pi moves during generation.
- Serialize memory-changing operations.
- Closing a modal aborts immediately, but its queue slot remains held until the active operation, including any dispatched atomic rename, settles.
- Validate generated documents before atomic persistence.
- Failure or cancellation preserves the last successful memory.
- Never silently publish a result as describing a newer conversation position.

## User edits

Natural-language editing receives the full memory and the user's instruction, then returns a complete revised document.

- Show a short description of the change and offer Undo last edit.
- Update the summary with the edited document.
- Edits survive compatible refreshes because edited memory is supplied as prior context.
- Edits are not permanent locks. Explicit newer conversation may supersede them; ambiguous conflicts remain visible.
- No separate persistent correction ledger in v0.
- Editing memory does not edit the original conversation or steer Pi automatically.

## Interface

### Commands

| Command | Behavior |
| --- | --- |
| `/thread` | Open saved summary; create memory if absent |
| `/thread refresh` | Consolidate prior memory with available conversation when compatible |
| `/thread reset` | Regenerate from available conversation only, with confirmation |
| `/thread full` | Show complete formatted memory |
| `/thread <question>` | Ask about saved memory |
| `/thread edit <instruction>` | Correct saved memory naturally |
| `/thread focus [instruction]` | Show or set guidance for future refresh/reset operations |
| `/thread export [md\|json]` | Export saved memory; default Markdown |
| `/thread steer <intent>` | Generate a copyable prompt for Pi |
| `/thread model [id]` | Show or set the session-local Agy model |
| `/thread effort [default\|low\|medium\|high]` | Show or set the session-local reasoning effort (`default` is the model's fixed/built-in effort) |
| `/thread doctor` | Check Agy and Pi fallback readiness |

Parse reserved command words deterministically; other input is a question. Do not add model-driven command routing.

Actions requiring memory should offer initial creation if none exists. Focus can be configured before creation.

### Views

- Summary: a plain-language, compact orientation to the actual goal, current state, important choices, and user attention. It is not a fixed domain dashboard and does not append an arbitrary open/next list.
- Full memory: deterministic, well-formatted rendering of every saved field.
- Summary and Full are native `Tab`/`Shift+Tab` modal tabs with independent scroll offsets and no model call.
- Header: compact source/backend/model/effort status. Technical capture details remain available in Full without dominating Summary.
- A changed conversation position does not block reading, asking, editing, exporting, or steering from the explicitly labeled saved snapshot.
- Diagrams may be requested through Ask. No dedicated diagram subsystem or domain dashboard in v0.

### Ask

Ask uses saved memory without implicitly refreshing it.

Provide an “Include latest Pi response” toggle. Capture the latest completed assistant response when submitting; display it in an expandable panel alongside the question. If none exists, explain that rather than silently substituting another source.

The answer distinguishes saved memory from the latest response where they differ. Ask does not modify memory.

### Focus

Focus is user-owned configuration separate from generated memory. Setting it does not change existing memory; show “Applies on the next refresh or reset.” Provide a clear-focus action.

### Steering

Generate the smallest useful prompt for the stated next intent using saved memory. Show it without sending, executing, or automatically copying it; `C` is the explicit copy action. Preserve relevant uncertainty and do not imply remembered results are current verification.

### Modal interaction

Use one stable modal across loading, streaming, result, retry, and error. Ask and Steer stream human-readable output. Index and Edit show readable progress but never raw structured JSON. Arrows, Page Up/Down, mouse wheel, and trackpad scroll. `C` copies the displayed view with inline success/error status, `R` retries the same captured inputs and preserves the previous good result if retry fails, `L` expands the captured latest response where applicable, and `Esc` closes or aborts. Ask, Edit, Focus, Export, and Steer remain slash commands rather than modal actions.

## Agent contracts and naive assumptions

Use separate narrow prompts, not separate autonomous agents:

```
INDEX: optional prior memory + conversation + profile + focus → memory
EDIT:  memory + correction                                  → memory
ASK:   memory + question + optional latest response          → answer
STEER: memory + next intent                                 → prompt
```

Assume one bounded source slice and the full saved memory fit a request. Assume whole-document generation and editing are adequate. Discover extraction quality, drift, latency, cost, and memory-growth limits through usage rather than a pre-build evaluation program.

Do not silently truncate saved memory if it outgrows the supported request size; report the limit and preserve it. Reset remains an explicit, potentially lossy recovery option.

Tree bookkeeping, storage, schema validation, and UI state remain outside model responsibilities.

## Profile and persistence boundary

Use a small profile contract containing identity/version, memory schema, indexing guidance, and presentation/steering guidance only as needed. Ship the software-development profile first. A tiny second example can check that the core is not coupled to software terminology; it is not a second product feature.

Persist local versioned JSON containing:

- profile identity/version;
- generated memory including summary;
- focus;
- session identity and captured Pi head;
- capture time and source-coverage metadata;
- edited status;
- the previous edit state needed for one-step undo.

The primary execution adapter is Agy, independent of Pi's selected model/auth, using a sandbox temp cwd, disabled slash commands, stdin stream-JSON framing, cancellation cleanup, timeout, and delta throttling. Defaults are `gemini-3.7-flash` and `low`, persisted per thread. Only spawn ENOENT falls back once to isolated Pi inference; all other Agy failures remain visible. Pi fallback inherits the selected Pi model and receives the configured thread effort; `default` inherits Pi's current thinking setting (or low if unavailable). Source budgeting is independent of `ctx.model` for Agy.

Exact schema, Pi API mapping, input budget, and filesystem location are implementation decisions. They must follow actual platform capabilities rather than assumptions in this document. Old stored memories remain readable; adding optional backend settings must not delete or silently rewrite them.

## Deferred

- Cross-session aggregation and automatic scope correlation.
- Incremental patches, selected-turn controls, and partial rebuilds.
- Durable correction reconciliation or permanent overrides.
- Branch-aware snapshot reuse and memory merging.
- Per-item evidence/provenance graphs.
- Live project-state verification and external integrations.
- Background indexing and automatic main-context injection.
- Domain-specific dashboards, plugin frameworks, and dedicated diagram infrastructure.

See `../issues/001-branch-aware-memory-lifecycle.md` for deferred tree and coverage work.

## Minimum implementation checks

No pre-build benchmark is required. Implementation must still check:

1. Compatible refresh receives prior edited memory.
2. Divergence or unknown compatibility excludes it.
3. Reset excludes prior memory and requires confirmation.
4. Invalid output, cancellation, or failed persistence does not destroy saved memory.
5. Source position is captured before generation and labeled correctly after Pi moves.
6. Ask/export/steer do not mutate memory or inject into Pi.

## Known v0 limitations

Repeated consolidation may preserve mistakes or lose details. Compacted or omitted source cannot be independently reconstructed from the snapshot. Explicit newer conversation may supersede user edits. Branch divergence can lose useful prior context. These are accepted limitations, made visible through coverage labels, editable memory, and explicit reset behavior.

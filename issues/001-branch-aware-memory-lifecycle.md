# Branch-aware memory lifecycle and source coverage

Status: deferred beyond v0; local issue, not published to an external tracker.

## Problem

Pi supports time travel, branching, forks, and compaction. v0 only checks whether the prior capture point is on the current lineage. Compatible refresh includes prior memory; divergence or unknown compatibility excludes it. This avoids abandoned-future contamination but may discard useful common history and edits.

Compaction and bounded input also mean memory may retain claims whose original evidence is absent from the current indexing input.

## v0 boundary

- Store session identity and captured head mechanically.
- Check ancestry outside the model.
- Capture source before generation and disclose coverage.
- Exclude prior memory on divergence or unknown compatibility.
- No branch merging, per-item provenance, or historical reconstruction.

## Future investigation

- Distinguish continuation, rewind, divergence, forks, and compaction using actual Pi APIs.
- Reuse compatible snapshots or their common-history portion.
- Decide whether incremental updates provide enough value to justify their semantics.
- Define correction behavior across branches and resets.
- Track source coverage and recover historical material where available.
- Prevent off-branch claims from appearing current without burdening model prompts with tree mechanics.

## Trigger

Revisit when usage demonstrates that conservative exclusion loses valuable continuity, repeated full consolidation is too costly, or compaction causes material information loss.

## Acceptance direction

Demonstrate correct behavior across continuation, rewind, alternate branch, compaction, and fork fixtures. Preserve understandable user behavior and narrow agent contracts. Do not require an evidence graph unless simpler snapshot-level methods prove insufficient.

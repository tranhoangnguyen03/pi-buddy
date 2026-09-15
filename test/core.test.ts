import assert from "node:assert/strict";
import { test } from "node:test";

import {
	captureBranch,
	classifyCompatibility,
	computeSourceBudget,
	computeSourceBudgetChars,
	createMutationQueue,
	editMemory,
	formatInferencePrompt,
	formatHeader,
	latestCompletedAssistantText,
	parseBarCommand,
	parseThreadCommand,
	parseMemoryDocument,
	regenerateMemory,
	renderExport,
	renderMemoryMarkdown,
	requiresDestructiveConfirmation,
	serializeMemoryDocument,
	undoLastEdit,
	updateFocus,
	updateThreadSettings,
	type MemoryDocument,
	type StoredState,
} from "../src/core.ts";
import { genericProfileExample, softwareProfile } from "../src/profile.ts";

const oldMemory: MemoryDocument = {
	title: "Old secret marker",
	summary: "Existing summary",
	sections: [{ title: "Decisions", items: [{ kind: "decision", text: "Keep the simple path" }] }],
};

const newMemory: MemoryDocument = {
	title: "Current work",
	summary: "Fresh summary",
	sections: [{ title: "Next", items: [{ kind: "next", text: "Verify it" }] }],
};

const state = (overrides: Partial<StoredState> = {}): StoredState => ({
	schemaVersion: 1,
	profile: { id: softwareProfile.id, version: softwareProfile.version },
	sessionId: "session-1",
	memory: oldMemory,
	focus: null,
	capture: {
		headId: "b",
		capturedAt: "2026-09-14T00:00:00.000Z",
		coverage: {
			budgetChars: 1000,
			includedChars: 20,
			totalEntries: 2,
			includedEntries: 2,
			omittedEntries: 0,
			truncated: false,
			includesCompaction: false,
			carriedPrior: false,
		},
	},
	edited: true,
	undo: null,
	updatedAt: "2026-09-14T00:00:00.000Z",
	...overrides,
});

const response = JSON.stringify(newMemory);

test("compatible refresh supplies prior edited memory and carries its edited status", async () => {
	let prompt = "";
	let saved: StoredState | undefined;
	const snapshot = captureBranch(
		"session-1",
		"c",
		[
			{ type: "message", id: "a", parentId: null, timestamp: "", message: { role: "user", content: "one", timestamp: 1 } },
			{ type: "compaction", id: "b", parentId: "a", timestamp: "", summary: "earlier", firstKeptEntryId: "a", tokensBefore: 2 },
			{ type: "message", id: "c", parentId: "b", timestamp: "", message: { role: "user", content: "two", timestamp: 2 } },
		],
		1000,
	);

	const result = await regenerateMemory({
		existing: state(),
		snapshot,
		mode: "refresh",
		profile: softwareProfile,
		infer: async (request) => ((prompt = request.userPrompt), response),
		save: async (next) => { saved = next; },
	});

	assert.equal(classifyCompatibility(state(), snapshot), "compatible");
	assert.match(prompt, /Old secret marker/);
	assert.equal(result.edited, true);
	assert.equal(result.capture?.coverage.carriedPrior, true);
	assert.deepEqual(saved, result);
});

test("divergence and unknown session compatibility exclude prior memory", async () => {
	for (const snapshot of [
		captureBranch("session-1", "x", [{ type: "message", id: "x", parentId: null, timestamp: "", message: { role: "user", content: "new branch", timestamp: 1 } }], 1000),
		captureBranch("session-2", "b", [{ type: "message", id: "b", parentId: null, timestamp: "", message: { role: "user", content: "other session", timestamp: 1 } }], 1000),
	]) {
		let prompt = "";
		await regenerateMemory({
			existing: state(), snapshot, mode: "refresh", profile: softwareProfile,
			infer: async (request) => ((prompt = request.userPrompt), response), save: async () => {},
		});
		assert.doesNotMatch(prompt, /Old secret marker/);
	}
});

test("reset excludes prior memory and reset or incompatible refresh requires confirmation", async () => {
	const compatible = captureBranch("session-1", "b", [{ type: "message", id: "b", parentId: null, timestamp: "", message: { role: "user", content: "now", timestamp: 1 } }], 1000);
	let prompt = "";
	await regenerateMemory({
		existing: state(), snapshot: compatible, mode: "reset", profile: softwareProfile,
		infer: async (request) => ((prompt = request.userPrompt), response), save: async () => {},
	});
	assert.doesNotMatch(prompt, /Old secret marker/);
	assert.equal(requiresDestructiveConfirmation("reset", "compatible"), true);
	assert.equal(requiresDestructiveConfirmation("refresh", "incompatible"), true);
	assert.equal(requiresDestructiveConfirmation("refresh", "unknown"), true);
	assert.equal(requiresDestructiveConfirmation("refresh", "compatible"), false);
});

test("bounded capture keeps newest lineage and discloses compaction and omission", () => {
	const snapshot = captureBranch(
		"session-1",
		"c",
		[
			{ type: "message", id: "a", parentId: null, timestamp: "", message: { role: "user", content: "x".repeat(100), timestamp: 1 } },
			{ type: "compaction", id: "b", parentId: "a", timestamp: "", summary: "compact marker", firstKeptEntryId: "a", tokensBefore: 2 },
			{ type: "message", id: "c", parentId: "b", timestamp: "", message: { role: "user", content: "newest marker", timestamp: 2 } },
		],
		80,
	);
	assert.match(snapshot.sourceText, /newest marker/);
	assert.equal(snapshot.coverage.truncated, true);
	assert.ok(snapshot.coverage.omittedEntries > 0);
	assert.equal(snapshot.coverage.includesCompaction, true);
	assert.equal(classifyCompatibility(state(), snapshot), "compatible");
});

test("coverage counts only source-bearing entries and excludes metadata and hidden bash", () => {
	const snapshot = captureBranch("session-1", "e", [
		{ type: "model_change", id: "a" },
		{ type: "label", id: "b" },
		{ type: "message", id: "c", message: { role: "bashExecution", command: "secret-command", output: "secret-output", excludeFromContext: true } },
		{ type: "message", id: "d", message: { role: "bashExecution", command: "visible-command", output: "visible-output", excludeFromContext: false } },
		{ type: "message", id: "e", message: { role: "user", content: "continue" } },
	], 10_000);
	assert.doesNotMatch(snapshot.sourceText, /secret-(?:command|output)/);
	assert.match(snapshot.sourceText, /visible-command/);
	assert.match(snapshot.sourceText, /visible-output/);
	assert.deepEqual({ total: snapshot.coverage.totalEntries, included: snapshot.coverage.includedEntries, omitted: snapshot.coverage.omittedEntries, truncated: snapshot.coverage.truncated }, { total: 2, included: 2, omitted: 0, truncated: false });
	assert.equal(snapshot.ancestryKnown, true);
});

test("invalid model output, cancellation, and persistence failure leave the old state untouched", async () => {
	const original = state();
	const snapshot = captureBranch("session-1", "b", [], 1000);
	let saves = 0;

	await assert.rejects(regenerateMemory({
		existing: original, snapshot, mode: "refresh", profile: softwareProfile,
		infer: async () => "not json", save: async () => { saves++; },
	}), /valid JSON/);
	assert.equal(saves, 0);

	await assert.rejects(regenerateMemory({
		existing: original, snapshot, mode: "refresh", profile: softwareProfile,
		infer: async () => { throw new DOMException("cancelled", "AbortError"); }, save: async () => { saves++; },
	}), /cancelled/);
	assert.equal(saves, 0);

	await assert.rejects(regenerateMemory({
		existing: original, snapshot, mode: "refresh", profile: softwareProfile,
		infer: async () => response, save: async () => { throw new Error("disk full"); },
	}), /disk full/);
	assert.deepEqual(original.memory, oldMemory);
});

test("an aborted signal prevents persistence even when inference returns after cancellation", async () => {
	const controller = new AbortController();
	controller.abort();
	let saves = 0;
	await assert.rejects(regenerateMemory({
		existing: state(), snapshot: captureBranch("session-1", "b", [], 1000), mode: "refresh", profile: softwareProfile,
		infer: async () => response, save: async () => { saves++; }, signal: controller.signal,
	}), /abort/i);
	assert.equal(saves, 0);
});

test("memory regeneration propagates its cancellation signal to persistence", async () => {
	const controller = new AbortController();
	let received: AbortSignal | undefined;
	await regenerateMemory({
		existing: state(), snapshot: captureBranch("session-1", "b", [], 1000), mode: "refresh", profile: softwareProfile,
		infer: async () => response, save: async (_next, signal) => { received = signal; }, signal: controller.signal,
	});
	assert.equal(received, controller.signal);
});

test("capture metadata remains fixed and header reports a moved Pi head", async () => {
	const snapshot = captureBranch("session-1", "b", [], 1000);
	const result = await regenerateMemory({
		existing: null, snapshot, mode: "create", profile: softwareProfile,
		infer: async () => response, save: async () => {}, now: () => new Date("2026-09-14T01:02:03.000Z"),
	});
	assert.equal(result.capture?.headId, "b");
	assert.match(formatHeader(result, "later-head"), /conversation position has changed/i);
});

test("edit validates a whole replacement and supports exactly one undo", async () => {
	let saved: StoredState | undefined;
	const edited = await editMemory({
		existing: state({ edited: false }), instruction: "Fix the decision", profile: softwareProfile,
		infer: async () => response, save: async (next) => { saved = next; },
	});
	assert.deepEqual(edited.memory, newMemory);
	assert.deepEqual(edited.undo?.memory, oldMemory);
	assert.equal(edited.edited, true);

	const undone = await undoLastEdit(edited, async (next) => { saved = next; });
	assert.deepEqual(undone.memory, oldMemory);
	assert.equal(undone.undo, null);
	assert.deepEqual(saved, undone);
	await assert.rejects(undoLastEdit(undone, async () => {}), /Nothing to undo/);
});

test("document parsing is strict and rendering is profile-agnostic", () => {
	assert.deepEqual(parseMemoryDocument(`\n\`\`\`json\n${response}\n\`\`\`\n`), newMemory);
	assert.throws(() => parseMemoryDocument(JSON.stringify({ ...newMemory, extra: true })), /unexpected field/);
	const custom: MemoryDocument = {
		title: "Trip",
		summary: "Plan a quiet weekend",
		sections: [{ title: genericProfileExample.presentation.sectionOrder[0]!, items: [{ kind: "context", text: "Near water" }] }],
	};
	assert.match(renderMemoryMarkdown(custom), /Near water/);
});

test("Ask/export/steer helpers do not mutate saved memory", async () => {
	const original = state();
	const before = structuredClone(original);
	const infer = async () => "A non-empty answer";
	const { askMemory, steerMemory } = await import("../src/core.ts");
	assert.equal(await askMemory(original, "What next?", null, infer), "A non-empty answer");
	assert.equal(await steerMemory(original, "ship it", infer), "A non-empty answer");
	assert.match(renderExport(original, "md"), /Existing summary/);
	assert.match(renderExport(original, "md", "new-head"), /conversation position has changed/i);
	assert.match(renderExport(original, "json"), /"schemaVersion": 1/);
	assert.deepEqual(original, before);
});

test("mutation queue runs operations one at a time in submission order", async () => {
	const enqueue = createMutationQueue();
	const events: string[] = [];
	let release!: () => void;
	const gate = new Promise<void>((resolve) => { release = resolve; });
	const first = enqueue(async () => { events.push("first:start"); await gate; events.push("first:end"); });
	const second = enqueue(async () => { events.push("second"); });
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(events, ["first:start"]);
	release();
	await Promise.all([first, second]);
	assert.deepEqual(events, ["first:start", "first:end", "second"]);
});

test("/thread mechanics (open, doctor, config) are routed deterministically; everything else goes to the bar router", () => {
	assert.deepEqual(parseThreadCommand(""), { action: "open" });
	assert.deepEqual(parseThreadCommand("doctor"), { action: "doctor" });
	assert.deepEqual(parseThreadCommand("config"), { action: "config" });
	assert.deepEqual(parseThreadCommand("What changed?"), { action: "bar", command: { action: "ask", question: "What changed?" } });
	assert.deepEqual(parseThreadCommand("/edit correct this"), { action: "bar", command: { action: "edit", instruction: "correct this" } });
	// "doctor"/"config" only short-circuit as bare words; with arguments they fall through to the bar router as Ask text.
	assert.deepEqual(parseThreadCommand("doctor now"), { action: "bar", command: { action: "ask", question: "doctor now" } });
});

test("bar commands parse all '/'-prefixed content operations; unprefixed text is Ask; unknown commands throw", () => {
	assert.deepEqual(parseBarCommand(""), { action: "ask", question: "" });
	assert.deepEqual(parseBarCommand("What changed?"), { action: "ask", question: "What changed?" });
	assert.deepEqual(parseBarCommand("/edit correct this"), { action: "edit", instruction: "correct this" });
	assert.deepEqual(parseBarCommand("/steer ship it"), { action: "steer", intent: "ship it" });
	assert.deepEqual(parseBarCommand("/focus emphasize tests"), { action: "focus", instruction: "emphasize tests" });
	assert.deepEqual(parseBarCommand("/focus clear"), { action: "focus-clear" });
	assert.deepEqual(parseBarCommand("/refresh"), { action: "refresh" });
	assert.deepEqual(parseBarCommand("/reset"), { action: "reset" });
	assert.deepEqual(parseBarCommand("/full"), { action: "full" });
	assert.deepEqual(parseBarCommand("/undo"), { action: "undo" });
	assert.deepEqual(parseBarCommand("/help"), { action: "help" });
	assert.deepEqual(parseBarCommand("/export"), { action: "export", format: "md" });
	assert.deepEqual(parseBarCommand("/export json"), { action: "export", format: "json" });
	assert.throws(() => parseBarCommand("/export xml"), /Usage: \/export/);
	assert.throws(() => parseBarCommand("/edit"), /Usage: \/edit/);
	assert.throws(() => parseBarCommand("/steer"), /Usage: \/steer/);
	assert.throws(() => parseBarCommand("/focus"), /Usage: \/focus/);
	assert.throws(() => parseBarCommand("/refresh extra"), /Usage: \/refresh/);
	assert.throws(() => parseBarCommand("/foo"), /Unknown bar command: \/foo/);
});

test("source budget reserves room for prior memory and rejects an oversized saved document", () => {
	assert.ok(computeSourceBudget(128_000, 50_000) < computeSourceBudget(128_000, 0));
	assert.throws(() => computeSourceBudget(8_000, 20_000), /too large/);
	assert.throws(() => computeSourceBudget(8_000, 0), /too large/);
	assert.equal(computeSourceBudgetChars(240_000, 50_000), 174_000);
});

test("generation budgets the exact compact prior and framed prompt", async () => {
	const original = state();
	const requestBudget = 30_000;
	const prior = serializeMemoryDocument(original.memory!);
	const snapshot = captureBranch("session-1", "b", [{ type: "message", id: "b", message: { role: "user", content: "x".repeat(30_000) } }], computeSourceBudgetChars(requestBudget, prior.length));
	let requestLength = 0;
	let prompt = "";
	await regenerateMemory({
		existing: original, snapshot, mode: "refresh", profile: softwareProfile, requestBudgetChars: requestBudget,
		infer: async (request) => { requestLength = formatInferencePrompt(request).length; prompt = request.userPrompt; return response; },
		save: async () => {},
	});
	assert.ok(requestLength <= requestBudget);
	assert.ok(prompt.includes(`<prior-memory>\n${prior}\n</prior-memory>`));
	assert.equal(prompt.includes(JSON.stringify(original.memory, null, 2)), false);
});

test("latest response uses text-only completed stop or length output", () => {
	const length = [{ type: "message", message: { role: "assistant", stopReason: "length", content: [
		{ type: "text", text: "visible one" },
		{ type: "thinking", thinking: "private reasoning" },
		{ type: "toolCall", name: "read", arguments: { secret: true } },
		{ type: "text", text: "visible two" },
	] } }];
	assert.equal(latestCompletedAssistantText(length), "visible one\nvisible two");
	const stop = [{ type: "message", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "completed" }] } }];
	assert.equal(latestCompletedAssistantText(stop), "completed");
	for (const stopReason of ["toolUse", "aborted", "error"]) {
		assert.equal(latestCompletedAssistantText([{ type: "message", message: { role: "assistant", stopReason, content: [{ type: "text", text: "not complete" }] } }]), null);
	}
	assert.equal(latestCompletedAssistantText([{ type: "message", message: { role: "assistant", stopReason: "stop", content: [{ type: "thinking", thinking: "only private" }] } }]), null);
	assert.equal(latestCompletedAssistantText([]), null);
});

test("focus is stored separately without changing generated memory", async () => {
	const original = state();
	let saved: StoredState | undefined;
	const focused = await updateFocus(original, "Emphasize accessibility", async (next) => { saved = next; });
	assert.deepEqual(focused.memory, original.memory);
	assert.equal(focused.focus, "Emphasize accessibility");
	assert.deepEqual(saved, focused);
});

test("thread model and effort settings persist without changing memory", async () => {
	const original = state();
	let saved: StoredState | undefined;
	const configured = await updateThreadSettings(original, { model: "gemini-3.7-flash", effort: "high" }, async (next) => { saved = next; });
	assert.deepEqual(configured.memory, original.memory);
	assert.deepEqual(configured.settings, { model: "gemini-3.7-flash", effort: "high" });
	assert.deepEqual(saved, configured);
	await assert.rejects(updateThreadSettings(original, { model: "bad model", effort: "low" }, async () => {}), /model ID/);
});

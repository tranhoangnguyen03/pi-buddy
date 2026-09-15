import assert from "node:assert/strict";
import { test } from "node:test";

import extension, { memoryResult } from "../src/index.ts";
import type { StoredState } from "../src/core.ts";

test("extension registers only the deterministic thread command", () => {
	const commands: Array<{ name: string; options: unknown }> = [];
	extension({ registerCommand: (name: string, options: unknown) => commands.push({ name, options }) } as never);
	assert.equal(commands.length, 1);
	assert.equal(commands[0]?.name, "thread");
	assert.equal(typeof (commands[0]?.options as { handler?: unknown }).handler, "function");
});

test("/thread argument completions only offer mechanics (doctor, config), not the removed content subcommands", () => {
	const commands: Array<{ name: string; options: { getArgumentCompletions?: (prefix: string) => Array<{ value: string }> | null } }> = [];
	extension({ registerCommand: (name: string, options: unknown) => commands.push({ name, options: options as never }) } as never);
	const completions = commands[0]!.options.getArgumentCompletions!;
	assert.deepEqual(completions("")?.map((item) => item.value).sort(), ["config", "doctor"]);
	assert.deepEqual(completions("c")?.map((item) => item.value), ["config"]);
	assert.equal(completions("refresh"), null);
	assert.equal(completions("model"), null);
	assert.equal(completions("effort"), null);
});

test("result and retry compare the captured head with the leaf at render time", async () => {
	const state: StoredState = {
		schemaVersion: 1,
		profile: { id: "software-development", version: 2 },
		sessionId: "session",
		memory: { title: "Memory", summary: "Summary", sections: [{ title: "State", items: [] }] },
		focus: null,
		capture: { headId: "captured", capturedAt: "2026-09-14T00:00:00.000Z", coverage: { budgetChars: 100, includedChars: 10, totalEntries: 1, includedEntries: 1, omittedEntries: 0, truncated: false, includesCompaction: false, carriedPrior: false } },
		edited: false,
		undo: null,
		updatedAt: "2026-09-14T00:00:00.000Z",
	};
	let leaf = "captured";
	const finishInference = async () => {
		await new Promise((resolve) => setImmediate(resolve));
		return memoryResult(state, () => leaf);
	};
	const first = finishInference();
	leaf = "moved-during-inference";
	assert.match((await first).full!, /position has changed/i);
	const retry = finishInference();
	leaf = "moved-during-retry";
	assert.match((await retry).sourceLabel!, /position changed/i);
	assert.equal(state.capture?.headId, "captured");
});

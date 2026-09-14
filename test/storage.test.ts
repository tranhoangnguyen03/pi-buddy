import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import type { StoredState } from "../src/core.ts";
import { softwareProfile } from "../src/profile.ts";
import { atomicWriteFile, JsonMemoryStore, sessionKey, writeUniqueExport } from "../src/storage.ts";

const validState: StoredState = {
	schemaVersion: 1,
	profile: { id: softwareProfile.id, version: softwareProfile.version },
	sessionId: "session/with unsafe path characters",
	memory: {
		title: "Stored",
		summary: "Atomic state",
		sections: [{ title: "Context", items: [] }],
	},
	focus: null,
	capture: null,
	edited: false,
	undo: null,
	updatedAt: "2026-09-14T00:00:00.000Z",
};

test("JSON store round-trips valid state atomically and rejects invalid replacement", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-buddy-"));
	try {
		const store = new JsonMemoryStore(directory);
		await store.save(validState);
		assert.deepEqual(await store.load(validState.sessionId), validState);
		await assert.rejects(store.save({ ...validState, memory: { ...validState.memory!, unexpected: true } } as StoredState), /unexpected field/);
		assert.deepEqual(await store.load(validState.sessionId), validState);
		assert.equal((await readdir(directory)).some((name) => name.endsWith(".tmp")), false);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("exports use the full session hash and never overwrite an existing export", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-thread-export-"));
	try {
		const first = await writeUniqueExport(directory, validState.sessionId, "md", "first");
		const second = await writeUniqueExport(directory, validState.sessionId, "md", "second");
		assert.match(first, new RegExp(`buddy-memory-${sessionKey(validState.sessionId)}\\.md$`));
		assert.notEqual(first, second);
		assert.equal(await readFile(first, "utf8"), "first");
		assert.equal(await readFile(second, "utf8"), "second");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("abort immediately before atomic rename preserves the previous file", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-thread-abort-"));
	try {
		const path = join(directory, "state.json");
		await writeFile(path, "old", "utf8");
		let checks = 0;
		const signal = {
			throwIfAborted() {
				if (++checks === 2) throw new DOMException("cancelled", "AbortError");
			},
		} as AbortSignal;
		await assert.rejects(atomicWriteFile(path, "new", signal), /cancelled/);
		assert.equal(await readFile(path, "utf8"), "old");
		assert.equal((await readdir(directory)).some((name) => name.endsWith(".tmp")), false);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

import { MEMORY_SCHEMA_VERSION, THREAD_EFFORTS, validateMemoryDocument, type StoredState } from "./core.ts";

export function sessionKey(sessionId: string): string {
	return createHash("sha256").update(sessionId).digest("hex");
}

function validateCoverage(value: unknown): void {
	if (!value || typeof value !== "object") throw new Error("Invalid memory coverage");
	const coverage = value as Record<string, unknown>;
	for (const key of ["budgetChars", "includedChars", "totalEntries", "includedEntries", "omittedEntries"]) {
		if (!Number.isInteger(coverage[key]) || (coverage[key] as number) < 0) throw new Error(`Invalid coverage.${key}`);
	}
	for (const key of ["truncated", "includesCompaction", "carriedPrior"]) {
		if (typeof coverage[key] !== "boolean") throw new Error(`Invalid coverage.${key}`);
	}
}

export function validateStoredState(value: unknown): StoredState {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid memory state");
	const state = value as Record<string, unknown>;
	if (state.schemaVersion !== MEMORY_SCHEMA_VERSION) throw new Error(`Unsupported memory schema version: ${String(state.schemaVersion)}`);
	if (typeof state.sessionId !== "string" || !state.sessionId) throw new Error("Invalid session identity");
	if (!state.profile || typeof state.profile !== "object") throw new Error("Invalid memory profile");
	const profile = state.profile as Record<string, unknown>;
	if (typeof profile.id !== "string" || !profile.id || !Number.isInteger(profile.version)) throw new Error("Invalid memory profile");
	if (state.memory !== null) validateMemoryDocument(state.memory);
	if (state.focus !== null && typeof state.focus !== "string") throw new Error("Invalid focus");
	if (typeof state.edited !== "boolean" || typeof state.updatedAt !== "string") throw new Error("Invalid memory metadata");
	if (state.capture !== null) {
		if (!state.capture || typeof state.capture !== "object") throw new Error("Invalid capture");
		const capture = state.capture as Record<string, unknown>;
		if (capture.headId !== null && typeof capture.headId !== "string") throw new Error("Invalid capture head");
		if (typeof capture.capturedAt !== "string") throw new Error("Invalid capture time");
		validateCoverage(capture.coverage);
	}
	if (state.undo !== null) {
		if (!state.undo || typeof state.undo !== "object") throw new Error("Invalid undo state");
		const undo = state.undo as Record<string, unknown>;
		validateMemoryDocument(undo.memory);
		if (typeof undo.edited !== "boolean") throw new Error("Invalid undo state");
	}
	if (state.settings !== undefined) {
		if (!state.settings || typeof state.settings !== "object") throw new Error("Invalid thread settings");
		const settings = state.settings as Record<string, unknown>;
		if (typeof settings.model !== "string" || !settings.model.trim()) throw new Error("Invalid Agy model");
		if (typeof settings.effort !== "string" || !(THREAD_EFFORTS as readonly string[]).includes(settings.effort)) throw new Error("Invalid Agy effort");
	}
	return value as StoredState;
}

export async function atomicWriteFile(path: string, content: string, signal?: AbortSignal): Promise<void> {
	signal?.throwIfAborted();
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	let handle;
	try {
		handle = await open(temporary, "wx", 0o600);
		await handle.writeFile(content, "utf8");
		await handle.sync();
		await handle.close();
		handle = undefined;
		// The rename is the atomic commit. Cancellation after it is dispatched cannot roll it back.
		signal?.throwIfAborted();
		await rename(temporary, path);
	} catch (error) {
		await handle?.close().catch(() => {});
		await unlink(temporary).catch(() => {});
		throw error;
	}
}

export async function writeUniqueExport(directory: string, sessionId: string, extension: "md" | "json", content: string): Promise<string> {
	await mkdir(directory, { recursive: true });
	const base = `buddy-memory-${sessionKey(sessionId)}`;
	for (let number = 1; ; number++) {
		const path = join(directory, `${base}${number === 1 ? "" : `-${number}`}.${extension}`);
		let handle;
		try {
			handle = await open(path, "wx", 0o600);
			await handle.writeFile(content, "utf8");
			await handle.sync();
			await handle.close();
			return path;
		} catch (error) {
			await handle?.close().catch(() => {});
			if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
			if (handle) await unlink(path).catch(() => {});
			throw error;
		}
	}
}

export class JsonMemoryStore {
	private readonly root: string;

	constructor(root: string) {
		this.root = root;
	}

	private path(sessionId: string): string {
		return join(this.root, `${sessionKey(sessionId)}.json`);
	}

	async load(sessionId: string): Promise<StoredState | null> {
		try {
			return validateStoredState(JSON.parse(await readFile(this.path(sessionId), "utf8")));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	}

	async save(state: StoredState, signal?: AbortSignal): Promise<void> {
		validateStoredState(state);
		await mkdir(this.root, { recursive: true, mode: 0o700 });
		await atomicWriteFile(this.path(state.sessionId), `${JSON.stringify(state, null, 2)}\n`, signal);
	}
}

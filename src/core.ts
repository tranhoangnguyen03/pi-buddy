import type { MemoryProfile } from "./profile.ts";

export const MEMORY_SCHEMA_VERSION = 1 as const;
export const MAX_MEMORY_CHARS = 200_000;
export const DEFAULT_AGY_MODEL = "gemini-3.7-flash";
export const THREAD_EFFORTS = ["default", "low", "medium", "high"] as const;
export type ThreadEffort = (typeof THREAD_EFFORTS)[number];

export interface ThreadSettings {
	model: string;
	effort: ThreadEffort;
}

export const DEFAULT_THREAD_SETTINGS: ThreadSettings = { model: DEFAULT_AGY_MODEL, effort: "low" };

export const memoryKinds = ["proposal", "decision", "assumption", "reported", "observed", "open", "next", "context"] as const;
export type MemoryKind = (typeof memoryKinds)[number];

export interface MemoryItem {
	kind: MemoryKind;
	text: string;
	detail?: string;
}

export interface MemoryDocument {
	title: string;
	summary: string;
	sections: Array<{ title: string; items: MemoryItem[] }>;
}

export interface Coverage {
	budgetChars: number;
	includedChars: number;
	totalEntries: number;
	includedEntries: number;
	omittedEntries: number;
	truncated: boolean;
	includesCompaction: boolean;
	carriedPrior: boolean;
}

export interface CaptureSnapshot {
	sessionId: string;
	headId: string | null;
	branchIds: string[];
	ancestryKnown: boolean;
	capturedAt: string;
	sourceText: string;
	coverage: Coverage;
}

export interface StoredState {
	schemaVersion: typeof MEMORY_SCHEMA_VERSION;
	profile: { id: string; version: number };
	sessionId: string;
	memory: MemoryDocument | null;
	focus: string | null;
	capture: null | {
		headId: string | null;
		capturedAt: string;
		coverage: Coverage;
	};
	edited: boolean;
	undo: null | { memory: MemoryDocument; edited: boolean };
	/** Optional for compatibility with memories saved before per-thread Agy settings existed. */
	settings?: ThreadSettings;
	updatedAt: string;
}

export interface InferenceRequest {
	kind: "index" | "edit" | "ask" | "steer";
	systemPrompt: string;
	userPrompt: string;
	signal?: AbortSignal;
}

export type Infer = (request: InferenceRequest) => Promise<string>;

export const serializeMemoryDocument = (memory: MemoryDocument): string => JSON.stringify(memory);

export function formatInferencePrompt(request: Pick<InferenceRequest, "systemPrompt" | "userPrompt">): string {
	return `System instructions:\n${request.systemPrompt}\n\nTask input:\n${request.userPrompt}`;
}

type BranchEntry = {
	type: string;
	id?: unknown;
	parentId?: unknown;
	timestamp?: unknown;
	message?: unknown;
	summary?: unknown;
	firstKeptEntryId?: unknown;
	tokensBefore?: unknown;
	customType?: unknown;
	content?: unknown;
};

const exactKeys = (value: Record<string, unknown>, allowed: readonly string[], at: string) => {
	for (const key of Object.keys(value)) {
		if (!allowed.includes(key)) throw new Error(`${at} has unexpected field "${key}"`);
	}
};

const requiredString = (value: unknown, at: string, max: number): string => {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${at} must be a non-empty string`);
	if (value.length > max) throw new Error(`${at} exceeds ${max} characters`);
	return value;
};

export function validateMemoryDocument(value: unknown): MemoryDocument {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Memory document must be an object");
	const root = value as Record<string, unknown>;
	exactKeys(root, ["title", "summary", "sections"], "Memory document");
	const title = requiredString(root.title, "title", 200);
	const summary = requiredString(root.summary, "summary", 8_000);
	if (!Array.isArray(root.sections) || root.sections.length === 0 || root.sections.length > 24) {
		throw new Error("sections must contain 1 to 24 sections");
	}
	const sections = root.sections.map((section, sectionIndex) => {
		if (!section || typeof section !== "object" || Array.isArray(section)) throw new Error(`sections[${sectionIndex}] must be an object`);
		const record = section as Record<string, unknown>;
		exactKeys(record, ["title", "items"], `sections[${sectionIndex}]`);
		const sectionTitle = requiredString(record.title, `sections[${sectionIndex}].title`, 200);
		if (!Array.isArray(record.items) || record.items.length > 100) throw new Error(`sections[${sectionIndex}].items must be an array of at most 100 items`);
		const items = record.items.map((item, itemIndex) => {
			if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`sections[${sectionIndex}].items[${itemIndex}] must be an object`);
			const itemRecord = item as Record<string, unknown>;
			exactKeys(itemRecord, ["kind", "text", "detail"], `sections[${sectionIndex}].items[${itemIndex}]`);
			if (typeof itemRecord.kind !== "string" || !(memoryKinds as readonly string[]).includes(itemRecord.kind)) {
				throw new Error(`sections[${sectionIndex}].items[${itemIndex}].kind is invalid`);
			}
			const result: MemoryItem = {
				kind: itemRecord.kind as MemoryKind,
				text: requiredString(itemRecord.text, `sections[${sectionIndex}].items[${itemIndex}].text`, 8_000),
			};
			if (itemRecord.detail !== undefined) result.detail = requiredString(itemRecord.detail, `sections[${sectionIndex}].items[${itemIndex}].detail`, 12_000);
			return result;
		});
		return { title: sectionTitle, items };
	});
	const document = { title, summary, sections };
	if (JSON.stringify(document).length > MAX_MEMORY_CHARS) throw new Error(`Memory document exceeds ${MAX_MEMORY_CHARS} characters`);
	return document;
}

export function parseMemoryDocument(output: string): MemoryDocument {
	let json = output.trim();
	const fence = json.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
	if (fence) json = fence[1]!.trim();
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch (error) {
		throw new Error(`Model did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	return validateMemoryDocument(parsed);
}

function textContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => {
		if (!part || typeof part !== "object") return "";
		const block = part as Record<string, unknown>;
		if (block.type === "text" && typeof block.text === "string") return block.text;
		if (block.type === "thinking" && typeof block.thinking === "string") return `[thinking] ${block.thinking}`;
		if (block.type === "toolCall" && typeof block.name === "string") return `[tool call] ${block.name} ${JSON.stringify(block.arguments ?? {})}`;
		if (block.type === "image") return "[image]";
		return "";
	}).filter(Boolean).join("\n");
}

function serializeEntry(entry: BranchEntry): string {
	if (entry.type === "message" && entry.message && typeof entry.message === "object") {
		const message = entry.message as Record<string, unknown>;
		const role = typeof message.role === "string" ? message.role : "message";
		if (role === "bashExecution") return message.excludeFromContext === true ? "" : `[Bash]: ${String(message.command ?? "")}\n${String(message.output ?? "")}`;
		return `[${role}]: ${textContent(message.content)}`;
	}
	if (entry.type === "compaction" && typeof entry.summary === "string") return `[Compaction summary]: ${entry.summary}`;
	if (entry.type === "branch_summary" && typeof entry.summary === "string") return `[Branch summary]: ${entry.summary}`;
	if (entry.type === "custom_message") return `[Custom ${String(entry.customType ?? "message")}]: ${textContent(entry.content)}`;
	return "";
}

export function captureBranch(sessionId: string, headId: string | null, entries: BranchEntry[], budgetChars: number, now = () => new Date()): CaptureSnapshot {
	if (!sessionId) throw new Error("Pi session identity is unavailable");
	const budget = Math.max(1, Math.floor(budgetChars));
	const sources = entries.flatMap((entry) => {
		const text = serializeEntry(entry);
		return text ? [{ type: entry.type, text }] : [];
	});
	const segments = sources.map((source) => source.text);
	const selected: string[] = [];
	let remaining = budget;
	let includedEntries = 0;
	for (let index = segments.length - 1; index >= 0 && remaining > 0; index--) {
		const segment = segments[index]!;
		if (!segment) continue;
		const separator = selected.length ? 2 : 0;
		if (separator >= remaining) break;
		remaining -= separator;
		if (segment.length <= remaining) {
			selected.unshift(segment);
			remaining -= segment.length;
			includedEntries++;
			continue;
		}
		selected.unshift(segment.slice(-remaining));
		remaining = 0;
	}
	const branchIds = entries.flatMap((entry) => typeof entry.id === "string" ? [entry.id] : []);
	const sourceText = selected.join("\n\n");
	return {
		sessionId,
		headId,
		branchIds,
		ancestryKnown: branchIds.length === entries.length && (headId === null || branchIds.at(-1) === headId),
		capturedAt: now().toISOString(),
		sourceText,
		coverage: {
			budgetChars: budget,
			includedChars: sourceText.length,
			totalEntries: segments.length,
			includedEntries,
			omittedEntries: Math.max(0, segments.length - includedEntries),
			truncated: segments.length > includedEntries,
			includesCompaction: sources.some((source) => source.type === "compaction"),
			carriedPrior: false,
		},
	};
}

export type Compatibility = "compatible" | "incompatible" | "unknown";

export function classifyCompatibility(existing: StoredState | null, snapshot: CaptureSnapshot): Compatibility {
	if (!existing?.capture || existing.sessionId !== snapshot.sessionId || !snapshot.ancestryKnown) return "unknown";
	if (existing.capture.headId === null) return snapshot.headId === null ? "compatible" : "unknown";
	return snapshot.branchIds.includes(existing.capture.headId) ? "compatible" : "incompatible";
}

export function requiresDestructiveConfirmation(mode: "create" | "refresh" | "reset", compatibility: Compatibility): boolean {
	return mode === "reset" || (mode === "refresh" && compatibility !== "compatible");
}

const INDEX_SYSTEM = `You maintain an on-demand working-memory document. Return exactly one complete JSON document matching the supplied schema, with no prose outside it. Preserve useful prior information unless supplied conversation explicitly changes or contradicts it. Absence from supplied conversation is not removal. Keep unresolved contradictions visible. Focus changes emphasis, not factual authority. Write for a person returning to the work: use simple, faithful language and short concrete statements. Make summary a compact, scannable orientation to the actual current goal, current state, important choices, and anything needing the user's attention; omit categories that add no value. Do not fill it with generic process caveats or dense jargon. Never present remembered validation as fresh verification of current external state.`;
const EDIT_SYSTEM = `Revise the supplied working-memory document according to the correction. Return exactly one complete replacement JSON document matching the supplied schema, with no prose outside it. Do not change the original conversation and do not invent facts.`;
const ASK_SYSTEM = `Answer from the saved working memory without treating it as live external state. If a latest Pi response is supplied, distinguish it from saved memory wherever they differ. Be direct and preserve uncertainty.`;
const STEER_SYSTEM = `Generate only the smallest useful prompt for the stated next intent using the saved working memory. Preserve relevant uncertainty. Do not imply remembered results are current verification. Do not add a preamble.`;

function profileText(profile: MemoryProfile): string {
	return JSON.stringify(profile, null, 2);
}

export async function regenerateMemory(options: {
	existing: StoredState | null;
	snapshot: CaptureSnapshot;
	mode: "create" | "refresh" | "reset";
	profile: MemoryProfile;
	infer: Infer;
	save: (state: StoredState, signal?: AbortSignal) => Promise<void>;
	signal?: AbortSignal;
	now?: () => Date;
	requestBudgetChars?: number;
}): Promise<StoredState> {
	const { existing, snapshot, mode, profile, infer, save, signal } = options;
	const compatibility = classifyCompatibility(existing, snapshot);
	const includePrior = mode === "refresh" && compatibility === "compatible" && existing?.memory !== null;
	const prior = includePrior ? existing?.memory : undefined;
	const priorText = prior ? serializeMemoryDocument(prior) : "";
	const requestBudget = options.requestBudgetChars ?? 240_000;
	if (priorText.length + 16_000 > requestBudget) {
		throw new Error("Saved memory is too large for the selected model request; it was preserved. Use /thread reset with a larger-context model if appropriate.");
	}
	const coverage = { ...snapshot.coverage, carriedPrior: Boolean(prior) };
	const userPrompt = [
		"<profile>", profileText(profile), "</profile>",
		"<source-coverage>", JSON.stringify(coverage), "</source-coverage>",
		...(existing?.focus ? ["<focus>", existing.focus, "</focus>"] : []),
		...(prior ? ["<prior-memory>", priorText, "</prior-memory>"] : []),
		"<available-conversation>", snapshot.sourceText || "(no conversation material)", "</available-conversation>",
	].join("\n");
	const request: InferenceRequest = { kind: "index", systemPrompt: INDEX_SYSTEM, userPrompt, signal };
	if (formatInferencePrompt(request).length > requestBudget) {
		throw new Error("Memory request exceeds its input budget; saved memory was preserved. Reduce focus text or use /thread reset.");
	}
	signal?.throwIfAborted();
	const output = await infer(request);
	signal?.throwIfAborted();
	const memory = parseMemoryDocument(output);
	const now = (options.now ?? (() => new Date()))().toISOString();
	const next: StoredState = {
		schemaVersion: MEMORY_SCHEMA_VERSION,
		profile: { id: profile.id, version: profile.version },
		sessionId: snapshot.sessionId,
		memory,
		focus: existing?.focus ?? null,
		capture: { headId: snapshot.headId, capturedAt: snapshot.capturedAt, coverage },
		edited: Boolean(prior && existing?.edited),
		undo: null,
		settings: existing?.settings ?? DEFAULT_THREAD_SETTINGS,
		updatedAt: now,
	};
	signal?.throwIfAborted();
	await save(next, signal);
	return next;
}

export async function editMemory(options: {
	existing: StoredState;
	instruction: string;
	profile: MemoryProfile;
	infer: Infer;
	save: (state: StoredState, signal?: AbortSignal) => Promise<void>;
	signal?: AbortSignal;
	now?: () => Date;
}): Promise<StoredState> {
	if (!options.existing.memory) throw new Error("No saved memory to edit");
	const instruction = requiredString(options.instruction, "Edit instruction", 12_000);
	const userPrompt = [
		"<profile>", profileText(options.profile), "</profile>",
		"<memory>", JSON.stringify(options.existing.memory, null, 2), "</memory>",
		"<correction>", instruction, "</correction>",
	].join("\n");
	options.signal?.throwIfAborted();
	const output = await options.infer({ kind: "edit", systemPrompt: EDIT_SYSTEM, userPrompt, signal: options.signal });
	options.signal?.throwIfAborted();
	const memory = parseMemoryDocument(output);
	const next: StoredState = {
		...options.existing,
		profile: { id: options.profile.id, version: options.profile.version },
		memory,
		edited: true,
		undo: { memory: options.existing.memory, edited: options.existing.edited },
		updatedAt: (options.now ?? (() => new Date()))().toISOString(),
	};
	options.signal?.throwIfAborted();
	await options.save(next, options.signal);
	return next;
}

export async function undoLastEdit(existing: StoredState, save: (state: StoredState) => Promise<void>, now = () => new Date()): Promise<StoredState> {
	if (!existing.undo) throw new Error("Nothing to undo");
	const next: StoredState = { ...existing, memory: existing.undo.memory, edited: existing.undo.edited, undo: null, updatedAt: now().toISOString() };
	await save(next);
	return next;
}

function requireMemory(state: StoredState): MemoryDocument {
	if (!state.memory) throw new Error("No saved memory");
	return state.memory;
}

function validatePlainOutput(output: string): string {
	const text = output.trim();
	if (!text) throw new Error("Model returned an empty response");
	return text;
}

export async function askMemory(state: StoredState, question: string, latestResponse: string | null, infer: Infer, signal?: AbortSignal): Promise<string> {
	const memory = requireMemory(state);
	const userPrompt = [
		"<saved-memory>", JSON.stringify(memory, null, 2), "</saved-memory>",
		"<question>", requiredString(question, "Question", 12_000), "</question>",
		...(latestResponse ? ["<latest-pi-response>", latestResponse, "</latest-pi-response>"] : []),
	].join("\n");
	signal?.throwIfAborted();
	const output = await infer({ kind: "ask", systemPrompt: ASK_SYSTEM, userPrompt, signal });
	signal?.throwIfAborted();
	return validatePlainOutput(output);
}

export async function steerMemory(state: StoredState, intent: string, infer: Infer, signal?: AbortSignal): Promise<string> {
	const memory = requireMemory(state);
	const userPrompt = [
		"<saved-memory>", JSON.stringify(memory, null, 2), "</saved-memory>",
		"<next-intent>", requiredString(intent, "Steering intent", 12_000), "</next-intent>",
	].join("\n");
	signal?.throwIfAborted();
	const output = await infer({ kind: "steer", systemPrompt: STEER_SYSTEM, userPrompt, signal });
	signal?.throwIfAborted();
	return validatePlainOutput(output);
}

export function formatHeader(state: StoredState, currentHeadId: string | null): string {
	if (!state.capture) return "No memory capture yet.";
	const coverage = state.capture.coverage;
	const lines = [
		`Captured: ${state.capture.capturedAt}`,
		`Coverage: ${coverage.includedEntries}/${coverage.totalEntries} lineage entries${coverage.truncated ? ` (${coverage.omittedEntries} earlier or partial entries omitted)` : ""}${coverage.includesCompaction ? "; Pi compaction present" : ""}${coverage.carriedPrior ? "; earlier context carried through prior memory" : ""}`,
		`Edited: ${state.edited ? "yes" : "no"}`,
	];
	if (state.capture.headId !== currentHeadId) lines.push("Notice: the conversation position has changed since this snapshot was captured.");
	return lines.join("  \n");
}

export function formatCompactStatus(state: StoredState, currentHeadId: string | null): string {
	if (!state.capture) return "not captured";
	const coverage = state.capture.coverage;
	return [
		new Date(state.capture.capturedAt).toLocaleString(),
		`${coverage.includedEntries}/${coverage.totalEntries} entries${coverage.truncated ? ", partial" : ""}`,
		state.edited ? "edited" : "generated",
		state.capture.headId !== currentHeadId ? "position changed" : "captured position",
	].join(" · ");
}

export function renderMemoryMarkdown(memory: MemoryDocument): string {
	const lines = [`# ${memory.title}`, "", memory.summary];
	for (const section of memory.sections) {
		lines.push("", `## ${section.title}`);
		if (section.items.length === 0) lines.push("", "_None recorded._");
		for (const item of section.items) {
			lines.push("", `- **${item.kind}:** ${item.text}${item.detail ? ` — ${item.detail}` : ""}`);
		}
	}
	return lines.join("\n");
}

export function renderExport(state: StoredState, format: "md" | "json", currentHeadId = state.capture?.headId ?? null): string {
	if (format === "json") return `${JSON.stringify(state, null, 2)}\n`;
	return `${formatHeader(state, currentHeadId)}\n\n${renderMemoryMarkdown(requireMemory(state))}\n`;
}

export function createMutationQueue() {
	let tail = Promise.resolve();
	return function enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = tail.then(operation, operation);
		tail = result.then(() => undefined, () => undefined);
		return result;
	};
}

export function computeSourceBudget(contextWindowTokens: number, priorMemoryChars: number): number {
	return computeSourceBudgetChars(Math.min(240_000, Math.floor(contextWindowTokens * 2)), priorMemoryChars);
}

export function computeSourceBudgetChars(requestChars: number, priorMemoryChars: number): number {
	const available = requestChars - 16_000 - priorMemoryChars;
	if (available < 8_000) {
		throw new Error("Saved memory is too large for the selected model request; it was preserved. Use /thread reset with a larger-context model if appropriate.");
	}
	return available;
}

export function latestCompletedAssistantText(entries: Array<{ type: string; message?: unknown }>): string | null {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry?.type !== "message" || !entry.message || typeof entry.message !== "object") continue;
		const message = entry.message as Record<string, unknown>;
		if (message.role !== "assistant" || (message.stopReason !== "stop" && message.stopReason !== "length")) continue;
		if (!Array.isArray(message.content)) continue;
		const text = message.content.map((part) => {
			if (!part || typeof part !== "object") return "";
			const block = part as Record<string, unknown>;
			return block.type === "text" && typeof block.text === "string" ? block.text : "";
		}).filter(Boolean).join("\n").trim();
		if (text) return text;
	}
	return null;
}

export async function updateFocus(existing: StoredState, focus: string | null, save: (state: StoredState) => Promise<void>, now = () => new Date()): Promise<StoredState> {
	const normalized = focus === null ? null : requiredString(focus, "Focus", 12_000);
	const next = { ...existing, focus: normalized, updatedAt: now().toISOString() };
	await save(next);
	return next;
}

export function createEmptyState(sessionId: string, profile: MemoryProfile, focus: string | null = null, now = () => new Date()): StoredState {
	return {
		schemaVersion: MEMORY_SCHEMA_VERSION,
		profile: { id: profile.id, version: profile.version },
		sessionId,
		memory: null,
		focus,
		capture: null,
		edited: false,
		undo: null,
		settings: DEFAULT_THREAD_SETTINGS,
		updatedAt: now().toISOString(),
	};
}

export function threadSettings(state: StoredState | null): ThreadSettings {
	return state?.settings ?? DEFAULT_THREAD_SETTINGS;
}

export async function updateThreadSettings(
	existing: StoredState,
	settings: ThreadSettings,
	save: (state: StoredState) => Promise<void>,
	now = () => new Date(),
): Promise<StoredState> {
	if (!settings.model.trim() || /\s/.test(settings.model)) throw new Error("Agy model must be one non-empty model ID");
	if (!(THREAD_EFFORTS as readonly string[]).includes(settings.effort)) throw new Error("Agy effort must be default, low, medium, or high");
	const next = { ...existing, settings: { model: settings.model.trim(), effort: settings.effort }, updatedAt: now().toISOString() };
	await save(next);
	return next;
}

/** Content-operation commands parsed from the modal input bar. Ask has no prefix; everything else is `/word [argument]`. */
export type BarCommand =
	| { action: "ask"; question: string }
	| { action: "edit"; instruction: string }
	| { action: "steer"; intent: string }
	| { action: "focus"; instruction: string }
	| { action: "focus-clear" }
	| { action: "refresh" }
	| { action: "reset" }
	| { action: "full" }
	| { action: "undo" }
	| { action: "help" }
	| { action: "export"; format: "md" | "json" };

/** Bar commands with a `/` prefix, in the order shown by the inline completion hint and `/help`. */
export const BAR_COMMANDS = ["edit", "steer", "focus", "refresh", "reset", "full", "export", "undo", "help"] as const;

export function parseBarCommand(input: string): BarCommand {
	const value = input.trim();
	if (!value.startsWith("/")) return { action: "ask", question: value };
	const [word, ...rest] = value.slice(1).split(/\s+/);
	const argument = rest.join(" ").trim();
	if (word === "refresh" || word === "reset" || word === "full" || word === "undo" || word === "help") {
		if (argument) throw new Error(`Usage: /${word}`);
		return { action: word };
	}
	if (word === "export") {
		if (!argument) return { action: "export", format: "md" };
		if (argument === "md" || argument === "json") return { action: "export", format: argument };
		throw new Error("Usage: /export [md|json]");
	}
	if (word === "edit") {
		if (!argument) throw new Error("Usage: /edit <instruction>");
		return { action: "edit", instruction: argument };
	}
	if (word === "steer") {
		if (!argument) throw new Error("Usage: /steer <intent>");
		return { action: "steer", intent: argument };
	}
	if (word === "focus") {
		if (argument === "clear") return { action: "focus-clear" };
		if (!argument) throw new Error("Usage: /focus <instruction>|clear");
		return { action: "focus", instruction: argument };
	}
	throw new Error(`Unknown bar command: /${word ?? ""}. Type / for a list, or /help.`);
}

/** Mechanics commands handled by the `/thread` slash command itself. */
export type ThreadCommand =
	| { action: "open" }
	| { action: "doctor" }
	| { action: "config" }
	| { action: "bar"; command: BarCommand };

export function parseThreadCommand(input: string): ThreadCommand {
	const value = input.trim();
	if (!value) return { action: "open" };
	const [word, ...rest] = value.split(/\s+/);
	if ((word === "doctor" || word === "config") && rest.length === 0) return { action: word };
	return { action: "bar", command: parseBarCommand(value) };
}

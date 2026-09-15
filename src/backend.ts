import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import { formatInferencePrompt, type Infer, type InferenceRequest, type ThreadEffort, type ThreadSettings } from "./core.ts";

const AGY_TIMEOUT_MS = 125_000;
const AGY_SCHEMA = {
	type: "object",
	additionalProperties: false,
	required: ["title", "summary", "sections"],
	properties: {
		title: { type: "string" },
		summary: { type: "string" },
		sections: {
			type: "array",
			items: {
				type: "object",
				additionalProperties: false,
				required: ["title", "items"],
				properties: {
					title: { type: "string" },
					items: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							required: ["kind", "text"],
							properties: {
								kind: { enum: ["proposal", "decision", "assumption", "reported", "observed", "open", "next", "context"] },
								text: { type: "string" },
								detail: { type: "string" },
							},
						},
					},
				},
			},
		},
	},
};

type AgyEvent = {
	event?: string;
	step_update?: { step_type?: string; text_delta?: unknown };
	result?: { status?: string; response?: unknown; structured_output?: unknown; error?: unknown };
};

export interface BackendStatus {
	backend: "Agy" | "Pi fallback";
	model: string;
	effort: string;
	notice?: string;
}

export const AGY_UNAVAILABLE_NOTICE = "Agy is not installed or not on PATH. Install and sign in to Agy; check /thread doctor and /thread config. This request used isolated Pi fallback.";

export class AgyUnavailableError extends Error {
	constructor(message = "Agy executable was not found") {
		super(message);
		this.name = "AgyUnavailableError";
	}
}

export function agyInputFrame(prompt: string): string {
	return `${JSON.stringify({ event: "user", message: { content: prompt } })}\n`;
}

export function agyArgs(settings: ThreadSettings, schemaPath?: string): string[] {
	const suffix = (["low", "medium", "high"] as const).find((effort) => settings.model.endsWith(`-${effort}`));
	const model = settings.effort === "default" ? settings.model : suffix ? settings.model.slice(0, -suffix.length - 1) : settings.model;
	return [
		"--sandbox",
		"--disable-slash-commands",
		"--input-format", "stream-json",
		"--output-format", "stream-json",
		"--model", model,
		...(settings.effort === "default" ? [] : ["--effort", settings.effort]),
		...(schemaPath ? ["--json-schema", schemaPath] : []),
		"--print-timeout", "2m",
		"--print", "",
	];
}

export function parseAgyLine(line: string): { delta?: string; result?: string } {
	let event: AgyEvent;
	try {
		event = JSON.parse(line) as AgyEvent;
	} catch {
		throw new Error("Agy returned invalid streaming data");
	}
	if (event.event === "step_update" && event.step_update?.step_type === "agent_response" && typeof event.step_update.text_delta === "string") {
		return { delta: event.step_update.text_delta };
	}
	if (event.event === "result") {
		if (event.result?.status !== "SUCCESS" || typeof event.result.response !== "string") {
			throw new Error(typeof event.result?.error === "string" ? `Agy failed: ${event.result.error}` : "Agy did not complete successfully");
		}
		// A --json-schema call's raw `response` is the model's freeform final text: it can carry
		// extra keys the schema forbids or, after a tool-validation retry, concatenated text from
		// every turn. `structured_output` is the value agy itself validated against the schema.
		if (event.result.structured_output !== undefined) return { result: JSON.stringify(event.result.structured_output) };
		return { result: event.result.response };
	}
	return {};
}

export async function runAgyText(
	request: InferenceRequest,
	settings: ThreadSettings,
	onProgress?: (text: string) => void,
	command = "agy",
): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-buddy-"));
	let progressTimer: ReturnType<typeof setTimeout> | undefined;
	try {
		const structured = request.kind === "index" || request.kind === "edit";
		const schemaPath = structured ? join(directory, "memory.schema.json") : undefined;
		if (schemaPath) await writeFile(schemaPath, JSON.stringify(AGY_SCHEMA), "utf8");
		const child = spawn(command, agyArgs(settings, schemaPath), {
			cwd: directory,
			detached: process.platform !== "win32",
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		let processError: Error | undefined;
		let stderr = "";
		let partial = "";
		let final = "";
		let parseError: Error | undefined;
		let timedOut = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const kill = (signal: NodeJS.Signals) => {
			try {
				if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
				else child.kill(signal);
			} catch {}
		};
		const stop = () => {
			if (child.exitCode !== null || child.signalCode !== null) return;
			kill("SIGTERM");
			killTimer ??= setTimeout(() => kill("SIGKILL"), 1_000);
			killTimer.unref();
		};
		const timeout = setTimeout(() => { timedOut = true; stop(); }, AGY_TIMEOUT_MS);
		request.signal?.addEventListener("abort", stop, { once: true });
		child.once("error", (error) => { processError = error; });
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => { stderr += chunk; });
		child.stdin.on("error", () => {});
		child.stdin.end(agyInputFrame(formatInferencePrompt(request)));

		const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
			child.once("close", (code, signal) => resolve({ code, signal }));
		});
		const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
		try {
			for await (const line of lines) {
				if (!line.trim()) continue;
				try {
					const event = parseAgyLine(line);
					if (event.delta) {
						partial += event.delta;
						if (onProgress && !progressTimer) progressTimer = setTimeout(() => {
							progressTimer = undefined;
							if (!request.signal?.aborted) onProgress(partial);
						}, 75);
					}
					if (event.result !== undefined) final = event.result;
				} catch (error) {
					parseError = error instanceof Error ? error : new Error(String(error));
					stop();
					break;
				}
			}
		} finally {
			lines.close();
		}
		const closedResult = await closed;
		clearTimeout(timeout);
		if (killTimer) clearTimeout(killTimer);
		request.signal?.removeEventListener("abort", stop);
		if (request.signal?.aborted) throw new DOMException("Canceled", "AbortError");
		if (timedOut) throw new Error("Agy timed out after 2 minutes");
		if (processError) {
			if ((processError as NodeJS.ErrnoException).code === "ENOENT") throw new AgyUnavailableError();
			throw new Error(`Agy could not start: ${processError.message}`);
		}
		if (parseError) throw parseError;
		if (closedResult.signal || closedResult.code === null) throw new Error("Agy process ended unexpectedly");
		if (closedResult.code !== 0) throw new Error(`Agy failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
		const text = final.trim();
		if (!text) throw new Error(stderr.trim() || "Agy returned no final result");
		onProgress?.(text);
		return text;
	} finally {
		if (progressTimer) clearTimeout(progressTimer);
		await rm(directory, { recursive: true, force: true });
	}
}

export async function inferWithFallback(
	primary: () => Promise<string>,
	fallback: () => Promise<string>,
	onUnavailable?: () => void,
): Promise<string> {
	try {
		return await primary();
	} catch (error) {
		if (!(error instanceof AgyUnavailableError)) throw error;
		onUnavailable?.();
		return fallback();
	}
}

export function inferenceProgress(kind: InferenceRequest["kind"], text: string): string {
	return kind === "index" || kind === "edit" ? "**Generating and validating structured memory…**" : text;
}

export function makeInference(
	ctx: ExtensionCommandContext,
	settings: ThreadSettings,
	onProgress: ((text: string) => void) | undefined,
	onStatus: (status: BackendStatus) => void,
	onAgyUnavailable: () => void,
): Infer {
	const fallbackModel = ctx.model;
	const fallbackEffort = settings.effort === "default" ? (ctx.thinkingLevel ?? "low") : settings.effort;
	return async (request) => {
		const report = (text: string) => onProgress?.(inferenceProgress(request.kind, text));
		return inferWithFallback(
		async () => {
			onStatus({ backend: "Agy", model: settings.model, effort: settings.effort });
			return runAgyText(request, settings, report);
		},
		async () => {
			if (!fallbackModel) throw new Error("Agy is unavailable and Pi has no selected fallback model");
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(fallbackModel);
			if (!auth.ok) throw new Error(`Agy is unavailable and Pi fallback is not ready: ${auth.error}`);
			const provider = ctx.modelRegistry.getProvider(fallbackModel.provider);
			if (!provider) throw new Error(`Pi fallback provider ${fallbackModel.provider} is unavailable`);
			const model = auth.baseUrl ? { ...fallbackModel, baseUrl: auth.baseUrl } : fallbackModel;
			onStatus({ backend: "Pi fallback", model: `${model.provider}/${model.id}`, effort: fallbackEffort, notice: AGY_UNAVAILABLE_NOTICE });
			const message: UserMessage = { role: "user", content: [{ type: "text", text: request.userPrompt }], timestamp: Date.now() };
			const stream = provider.streamSimple(model, { systemPrompt: request.systemPrompt, messages: [message] }, {
				apiKey: auth.apiKey,
				headers: auth.headers,
				env: auth.env,
				signal: request.signal,
				cacheRetention: "none",
				maxTokens: Math.min(8192, model.maxTokens),
				reasoning: fallbackEffort === "off" ? undefined : fallbackEffort,
			});
			let text = "";
			for await (const event of stream) {
				if (event.type === "text_delta") {
					text += event.delta;
					report(text);
				}
				if (event.type === "error") throw new Error(event.error.errorMessage ?? `Pi fallback failed (${event.reason})`);
			}
			if (!text.trim()) throw new Error("Pi fallback returned no text");
			return text;
		},
		() => { onAgyUnavailable(); },
	);
	};
}

export interface AgyModelFamily {
	id: string;
	label: string;
	efforts: Exclude<ThreadEffort, "default">[];
	variants: Array<{ id: string; effort?: Exclude<ThreadEffort, "default"> }>;
}

export function parseAgyModels(output: string): AgyModelFamily[] {
	const families = new Map<string, AgyModelFamily>();
	for (const line of output.split(/\r?\n/)) {
		const [rawId, ...rawLabel] = line.split("\t");
		if (!rawId?.trim() || !rawLabel.length) continue;
		const id = rawId.trim();
		const label = rawLabel.join(" ").trim();
		const effort = (["low", "medium", "high"] as const).find((value) => id.endsWith(`-${value}`) && label.toLowerCase().endsWith(`(${value})`));
		const familyId = effort ? id.slice(0, -effort.length - 1) : id;
		const family = families.get(familyId) ?? { id: familyId, label: effort ? label.replace(/\s+\((Low|Medium|High)\)$/, "") : label, efforts: [], variants: [] };
		if (effort && !family.efforts.includes(effort)) family.efforts.push(effort);
		family.variants.push({ id, effort });
		families.set(familyId, family);
	}
	if (!families.size) throw new Error("Agy returned no available models");
	return [...families.values()];
}

async function runAgyInfo(args: string[], signal?: AbortSignal, timeout = 30_000): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "pi-buddy-"));
	try {
		return await new Promise<string>((resolve, reject) => {
			const child = spawn("agy", args, { cwd: directory, signal, timeout, killSignal: "SIGKILL", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
			let stdout = "";
			let stderr = "";
			child.stdout.setEncoding("utf8");
			child.stderr.setEncoding("utf8");
			child.stdout.on("data", (chunk: string) => { stdout += chunk; });
			child.stderr.on("data", (chunk: string) => { stderr += chunk; });
			child.once("error", (error) => reject((error as NodeJS.ErrnoException).code === "ENOENT" ? new AgyUnavailableError() : error));
			child.once("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `Agy exited with code ${code}`)));
		});
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

export const agyVersion = (signal?: AbortSignal) => runAgyInfo(["--version"], signal).then((text) => text.trim());
export const listAgyModels = (signal?: AbortSignal) => runAgyInfo(["models"], signal).then(parseAgyModels);
export const agyUsage = (signal?: AbortSignal) => runAgyInfo(["-p", "/usage", "--output-format", "json", "--print-timeout", "30s", "--sandbox"], signal, 35_000).then((text) => {
	let value: unknown;
	try { value = JSON.parse(text); } catch { throw new Error("Agy returned invalid usage data"); }
	if (!value || typeof value !== "object" || (value as { status?: unknown }).status !== "SUCCESS" || typeof (value as { response?: unknown }).response !== "string") {
		throw new Error("Agy account check failed");
	}
	return (value as { response: string }).response;
});

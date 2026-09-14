import { join } from "node:path";

import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
	AgyUnavailableError,
	agyUsage,
	agyVersion,
	listAgyModels,
	makeInference,
	type BackendStatus,
} from "./backend.ts";
import {
	askMemory,
	captureBranch,
	classifyCompatibility,
	computeSourceBudgetChars,
	createEmptyState,
	createMutationQueue,
	editMemory,
	formatCompactStatus,
	formatHeader,
	latestCompletedAssistantText,
	parseThreadCommand,
	regenerateMemory,
	renderExport,
	renderMemoryMarkdown,
	requiresDestructiveConfirmation,
	serializeMemoryDocument,
	steerMemory,
	threadSettings,
	undoLastEdit,
	updateFocus,
	updateThreadSettings,
	type StoredState,
	type ThreadSettings,
} from "./core.ts";
import { softwareProfile } from "./profile.ts";
import { JsonMemoryStore, writeUniqueExport } from "./storage.ts";
import { showFocus, showThreadModal, type ThreadModalResult } from "./ui.ts";

const AGY_REQUEST_CHARS = 240_000;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function requireInteractive(ctx: ExtensionCommandContext): boolean {
	if (ctx.mode === "tui") return true;
	ctx.ui.notify("Thread memory requires interactive TUI mode.", "error");
	return false;
}

function summaryMarkdown(state: StoredState): string {
	return `# ${state.memory!.title}\n\n${state.memory!.summary}`;
}

function fullMarkdown(state: StoredState, currentHead: string | null): string {
	return `${renderMemoryMarkdown(state.memory!)}${state.focus ? `\n\n## Focus for next rebuild\n\n${state.focus}` : ""}\n\n## Snapshot details\n\n${formatHeader(state, currentHead)}`;
}

function backendLabel(settings: ThreadSettings, status?: BackendStatus): string {
	return status
		? `${status.backend}: ${status.model} · ${status.effort}`
		: `Agy: ${settings.model} · ${settings.effort}`;
}

export function memoryResult(state: StoredState, getCurrentHead: () => string | null, status?: BackendStatus): ThreadModalResult<StoredState> {
	const currentHead = getCurrentHead();
	const warning = status?.notice ? `> ⚠ ${status.notice}\n\n` : "";
	return {
		summary: `${warning}${summaryMarkdown(state)}`,
		full: `${warning}${fullMarkdown(state, currentHead)}`,
		value: state,
		sourceLabel: `${backendLabel(threadSettings(state), status)} · ${formatCompactStatus(state, currentHead)}`,
	};
}

function textResult(text: string, status: BackendStatus, options: Omit<ThreadModalResult<string>, "summary" | "value" | "sourceLabel"> = {}): ThreadModalResult<string> {
	return {
		summary: `${status.notice ? `> ⚠ ${status.notice}\n\n` : ""}${text}`,
		value: text,
		sourceLabel: `${status.backend}: ${status.model} · ${status.effort}`,
		...options,
	};
}

export default function threadMemoryExtension(pi: ExtensionAPI) {
	const store = new JsonMemoryStore(join(getAgentDir(), "thread-memory"));
	const mutate = createMutationQueue();

	const load = (ctx: ExtensionCommandContext) => store.load(ctx.sessionManager.getSessionId());
	const save = (state: StoredState, signal?: AbortSignal) => store.save(state, signal);
	const stateOrEmpty = async (ctx: ExtensionCommandContext) => (await load(ctx)) ?? createEmptyState(ctx.sessionManager.getSessionId(), softwareProfile);
	const markAgyUnavailable = (ctx: ExtensionCommandContext) => {
		ctx.ui.setStatus("thread-memory", "Agy missing: install/sign in · /thread doctor|model|effort · Pi fallback");
	};
	const clearAgyUnavailable = (ctx: ExtensionCommandContext) => {
		ctx.ui.setStatus("thread-memory", undefined);
	};

	const generate = async (ctx: ExtensionCommandContext, existing: StoredState | null, mode: "create" | "refresh" | "reset") => {
		const branch = ctx.sessionManager.getBranch();
		const sessionId = ctx.sessionManager.getSessionId();
		const headId = ctx.sessionManager.getLeafId();
		const capturedAt = new Date();
		const ancestry = captureBranch(sessionId, headId, branch, 1, () => capturedAt);
		const compatibility = classifyCompatibility(existing, ancestry);
		if (requiresDestructiveConfirmation(mode, compatibility)) {
			const reset = mode === "reset";
			const confirmed = await ctx.ui.confirm(
				reset ? "Reset thread memory?" : "Refresh from a different branch?",
				reset
					? "Prior memory, user edits, and pre-compaction details may be lost. Regenerate from available conversation only?"
					: "The previous captured position is not on the current lineage (or ancestry is unknown). Prior memory and its edits will not carry forward. Continue?",
			);
			if (!confirmed) return undefined;
		}
		const priorChars = mode === "refresh" && compatibility === "compatible" && existing?.memory ? serializeMemoryDocument(existing.memory).length : 0;
		let sourceBudget: number;
		try {
			sourceBudget = computeSourceBudgetChars(AGY_REQUEST_CHARS, priorChars);
		} catch (error) {
			ctx.ui.notify(errorMessage(error), "error");
			return undefined;
		}
		const snapshot = captureBranch(sessionId, headId, branch, sourceBudget, () => capturedAt);
		const settings = threadSettings(existing);
		let progress: (text: string) => void = () => {};
		let status: BackendStatus = { backend: "Agy", model: settings.model, effort: settings.effort };
		const infer = makeInference(ctx, settings, () => progress("**Building and validating structured memory…**"), (next) => { status = next; }, () => markAgyUnavailable(ctx));
		return showThreadModal(ctx, {
			title: "Thread memory",
			loadingText: mode === "reset" ? "Rebuilding thread memory…" : "Building thread memory…",
			retryLabel: "build again",
			run: async (signal, onProgress) => {
				progress = onProgress;
				const state = await regenerateMemory({
					existing, snapshot, mode, profile: softwareProfile, infer, save, signal,
					requestBudgetChars: AGY_REQUEST_CHARS,
				});
				return memoryResult(state, () => ctx.sessionManager.getLeafId(), status);
			},
		});
	};

	const ensureMemory = async (ctx: ExtensionCommandContext, confirmCreation: boolean): Promise<StoredState | undefined> => {
		const existing = await load(ctx);
		if (existing?.memory) return existing;
		if (confirmCreation && !(await ctx.ui.confirm("Create thread memory?", "No memory exists for this Pi session. Create it from the available current lineage?"))) return undefined;
		return mutate(async () => {
			const current = (await load(ctx)) ?? existing;
			return current?.memory ? current : generate(ctx, current, "create");
		});
	};

	pi.registerCommand("thread", {
		description: "Open or manage session-local thread memory",
		getArgumentCompletions: (prefix) => {
			const commands = ["refresh", "reset", "full", "undo", "edit", "focus", "export", "steer", "model", "effort", "doctor"];
			const matches = commands.filter((value) => value.startsWith(prefix.trim().toLowerCase())).map((value) => ({ value, label: value }));
			return matches.length ? matches : null;
		},
		handler: async (args, ctx) => {
			if (!requireInteractive(ctx)) return;
			let command;
			try {
				command = parseThreadCommand(args);
			} catch (error) {
				ctx.ui.notify(errorMessage(error), "error");
				return;
			}
			try {
				if (command.action === "doctor") {
					const captured = await stateOrEmpty(ctx);
					const settings = threadSettings(captured);
					await showThreadModal(ctx, {
						title: "Thread memory doctor",
						loadingText: "Checking Agy and fallback settings…",
						retryLabel: "check again",
						run: async (signal) => {
							try {
								const [version, models] = await Promise.all([agyVersion(signal), listAgyModels(signal), agyUsage(signal)]);
								clearAgyUnavailable(ctx);
								const selected = models.find((model) => model.id === settings.model || model.variants.some((variant) => variant.id === settings.model));
								const effortReady = Boolean(selected && (selected.efforts.length ? settings.effort !== "default" && selected.efforts.includes(settings.effort) : settings.effort === "default"));
								const fallbackEffort = settings.effort === "default" ? (ctx.thinkingLevel ?? "low") : settings.effort;
								const fallback = ctx.model
									? `${ctx.model.provider}/${ctx.model.id} · effort ${fallbackEffort} · ${ctx.modelRegistry.hasConfiguredAuth(ctx.model) ? "auth configured" : "auth missing"}`
									: "no Pi model selected";
								return {
									summary: `# Thread memory doctor\n\n- ✓ **Agy:** ${version}\n- ✓ **Agy account:** connected\n- ${selected ? "✓" : "✗"} **Agy model:** \`${settings.model}\`${selected ? " is available" : " is not in the current catalog"}\n- ${effortReady ? "✓" : "✗"} **Reasoning effort:** ${settings.effort}\n- **Pi fallback (ENOENT only):** ${fallback}\n\n${selected && effortReady ? "**Ready.**" : "**Use `/thread model` or `/thread effort` to choose supported settings.**"}`,
									sourceLabel: `Agy: ${settings.model} · ${settings.effort}`,
								};
							} catch (error) {
								if (!(error instanceof AgyUnavailableError)) throw error;
								markAgyUnavailable(ctx);
								return {
									summary: `# Thread memory doctor\n\nAgy was not found on PATH. Install Agy, sign in, then use \`/thread doctor\`. Configure this thread with \`/thread model\` and \`/thread effort\`.\n\nPi fallback is used only when spawning Agy returns ENOENT.`,
									sourceLabel: `Pi fallback available: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model selected"}`,
								};
							}
						},
					});
					return;
				}
				if (command.action === "model-show" || command.action === "model-set") {
					const existing = await stateOrEmpty(ctx);
					const models = await listAgyModels();
					const currentSettings = threadSettings(existing);
					let selected = command.action === "model-set"
						? models.find((item) => item.id === command.model || item.variants.some((variant) => variant.id === command.model))
						: undefined;
					const requestedVariant = command.action === "model-set" ? selected?.variants.find((variant) => variant.id === command.model) : undefined;
					if (command.action === "model-set" && !selected) {
						ctx.ui.notify(`Agy model "${command.model}" is not in the current catalog.`, "warning");
						return;
					}
					if (!selected) {
						const ordered = [...models].sort((a, b) => Number(b.id === currentSettings.model || b.variants.some((variant) => variant.id === currentSettings.model)) - Number(a.id === currentSettings.model || a.variants.some((variant) => variant.id === currentSettings.model)));
						const choices = ordered.map((item) => `${item.id} — ${item.label}${item.id === currentSettings.model || item.variants.some((variant) => variant.id === currentSettings.model) ? " (current)" : ""}`);
						const choice = await ctx.ui.select(`Thread Agy model (current: ${currentSettings.model})`, choices);
						if (!choice) return;
						selected = ordered[choices.indexOf(choice)];
					}
					if (!selected) return;
					const effort = requestedVariant?.effort
						?? (selected.efforts.includes(currentSettings.effort === "default" ? "low" : currentSettings.effort) ? currentSettings.effort : selected.efforts.includes("low") ? "low" : selected.efforts[0] ?? "default");
					await mutate(async () => {
						const current = await stateOrEmpty(ctx);
						return updateThreadSettings(current, { model: selected.id, effort }, save);
					});
					ctx.ui.notify(`Thread Agy model: ${selected.id} · effort ${effort}`, "info");
					return;
				}
				if (command.action === "effort-show" || command.action === "effort-set") {
					const existing = await stateOrEmpty(ctx);
					const settings = threadSettings(existing);
					const models = await listAgyModels();
					const family = models.find((item) => item.id === settings.model || item.variants.some((variant) => variant.id === settings.model));
					if (!family) {
						ctx.ui.notify(`Model "${settings.model}" is not in Agy's current catalog. Run /thread model first.`, "warning");
						return;
					}
					let effort = command.action === "effort-set" ? command.effort : undefined;
					if (!family.efforts.length) {
						if (effort && effort !== "default") {
							ctx.ui.notify(`${family.label} uses a fixed effort level.`, "warning");
							return;
						}
						effort = "default";
					} else if (effort === "default" || (effort && !family.efforts.includes(effort))) {
						ctx.ui.notify(`${family.label} supports ${family.efforts.join(" or ")} effort.`, "warning");
						return;
					} else if (!effort) {
						const efforts = [...family.efforts].sort((a, b) => Number(b === settings.effort) - Number(a === settings.effort));
						const choices = efforts.map((item) => `${item}${item === settings.effort ? " (current)" : ""}`);
						const choice = await ctx.ui.select(`Thread reasoning effort (current: ${settings.effort})`, choices);
						if (!choice) return;
						effort = efforts[choices.indexOf(choice)];
					}
					if (!effort) return;
					await mutate(async () => {
						const current = await stateOrEmpty(ctx);
						return updateThreadSettings(current, { ...threadSettings(current), effort }, save);
					});
					ctx.ui.notify(`Thread reasoning effort: ${effort}`, "info");
					return;
				}
				if (command.action === "open") {
					const state = await load(ctx);
					if (state?.memory) await showThreadModal(ctx, { title: "Thread memory", initial: memoryResult(state, () => ctx.sessionManager.getLeafId()), retryable: false });
					else await mutate(() => generate(ctx, state, "create"));
					return;
				}
				if (command.action === "refresh" || command.action === "reset") {
					await mutate(async () => {
						const existing = await load(ctx);
						if (!existing?.memory && !(await ctx.ui.confirm("Create thread memory?", "No memory exists for this Pi session. Create it now?"))) return undefined;
						return generate(ctx, existing, command.action === "reset" ? "reset" : existing?.memory ? "refresh" : "create");
					});
					return;
				}
				if (command.action === "focus-set" || command.action === "focus-clear") {
					await mutate(async () => updateFocus(await stateOrEmpty(ctx), command.action === "focus-set" ? command.instruction : null, save));
					ctx.ui.notify(command.action === "focus-set" ? "Focus saved. Applies on the next refresh or reset." : "Focus cleared.", "info");
					return;
				}
				if (command.action === "focus-show") {
					const existing = await load(ctx);
					if (await showFocus(ctx, existing?.focus ?? null) === "clear") {
						await mutate(async () => updateFocus(await stateOrEmpty(ctx), null, save));
						ctx.ui.notify("Focus cleared.", "info");
					}
					return;
				}
				const state = await ensureMemory(ctx, true);
				if (!state?.memory) return;
				if (command.action === "full") {
					await showThreadModal(ctx, { title: "Thread memory", initial: memoryResult(state, () => ctx.sessionManager.getLeafId()), initialView: "full", retryable: false });
					return;
				}
				if (command.action === "edit") {
					const captured = state;
					const settings = threadSettings(captured);
					let progress: (text: string) => void = () => {};
					let status: BackendStatus = { backend: "Agy", model: settings.model, effort: settings.effort };
					const infer = makeInference(ctx, settings, () => progress("**Editing and validating structured memory…**"), (next) => { status = next; }, () => markAgyUnavailable(ctx));
					const edited = await mutate(() => showThreadModal(ctx, {
						title: "Thread memory",
						loadingText: "Editing thread memory…",
						retryLabel: "apply edit again",
						run: async (signal, onProgress) => {
							progress = onProgress;
							const next = await editMemory({ existing: captured, instruction: command.instruction, profile: softwareProfile, infer, save, signal });
							return memoryResult(next, () => ctx.sessionManager.getLeafId(), status);
						},
					}));
					if (edited) ctx.ui.notify(`Applied edit. Undo with /thread undo.`, "info");
					return;
				}
				if (command.action === "undo") {
					const undone = await mutate(async () => undoLastEdit((await load(ctx))!, save));
					ctx.ui.notify("Last memory edit undone.", "info");
					await showThreadModal(ctx, { title: "Thread memory", initial: memoryResult(undone, () => ctx.sessionManager.getLeafId()), retryable: false });
					return;
				}
				if (command.action === "export") {
					const path = await writeUniqueExport(ctx.cwd, ctx.sessionManager.getSessionId(), command.format, renderExport(state, command.format, ctx.sessionManager.getLeafId()));
					ctx.ui.notify(`Exported ${path}`, "info");
					return;
				}
				if (command.action === "ask") {
					const source = await ctx.ui.select("Ask thread memory", ["Saved memory only", "Include latest Pi response", "Cancel"]);
					if (!source || source === "Cancel") return;
					const latestRequested = source === "Include latest Pi response";
					const latest = latestRequested ? latestCompletedAssistantText(ctx.sessionManager.getBranch()) : null;
					const captured = state;
					const settings = threadSettings(captured);
					let progress: (text: string) => void = () => {};
					let status: BackendStatus = { backend: "Agy", model: settings.model, effort: settings.effort };
					const infer = makeInference(ctx, settings, (text) => progress(`## Answer\n\n${text}`), (next) => { status = next; }, () => markAgyUnavailable(ctx));
					await showThreadModal(ctx, {
						title: "Ask thread memory",
						loadingText: "Asking thread memory…",
						retryLabel: "ask again",
						run: async (signal, onProgress) => {
							progress = onProgress;
							const answer = await askMemory(captured, command.question, latest, infer, signal);
							return textResult(`## Question\n\n${command.question}\n\n## Answer\n\n${answer}`, status, { latestRequested, latestResponse: latest });
						},
					});
					return;
				}
				if (command.action === "steer") {
					const captured = state;
					const settings = threadSettings(captured);
					let progress: (text: string) => void = () => {};
					let status: BackendStatus = { backend: "Agy", model: settings.model, effort: settings.effort };
					const infer = makeInference(ctx, settings, progress, (next) => { status = next; }, () => markAgyUnavailable(ctx));
					await showThreadModal(ctx, {
						title: "Steering prompt",
						loadingText: "Drafting steering prompt…",
						retryLabel: "draft again",
						run: async (signal, onProgress) => {
							progress = onProgress;
							return textResult(await steerMemory(captured, command.intent, infer, signal), status);
						},
					});
				}
			} catch (error) {
				if (error instanceof AgyUnavailableError) markAgyUnavailable(ctx);
				ctx.ui.notify(`Thread memory: ${errorMessage(error)}`, "error");
			}
		},
	});

}

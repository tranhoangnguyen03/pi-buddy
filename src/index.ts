import { join } from "node:path";

import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

import {
	AgyUnavailableError,
	agyUsage,
	agyVersion,
	listAgyModels,
	makeInference,
	type AgyModelFamily,
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
	type BarCommand,
	type StoredState,
} from "./core.ts";
import { softwareProfile } from "./profile.ts";
import { JsonMemoryStore, writeUniqueExport } from "./storage.ts";
import { showThreadModal, type BarDispatchResult, type DispatchableBarCommand, type ThreadModalResult } from "./ui.ts";

const AGY_REQUEST_CHARS = 240_000;

const HELP_MARKDOWN = `# Thread memory bar commands

Type a question and press Enter to Ask the saved memory. \`/\`-prefixed bar commands act on memory **content**; \`/thread\` itself only handles extension **mechanics** (open, doctor, config).

- \`/edit <instruction>\` — revise memory with natural language (one-step \`/undo\`)
- \`/steer <intent>\` — draft a copyable prompt for Pi; \`C\` copies it, nothing is sent automatically
- \`/focus <instruction>\` or \`/focus clear\` — set or clear guidance for the next refresh or reset
- \`/refresh\` — rebuild from compatible prior memory plus the current conversation
- \`/reset\` — rebuild from the current conversation only (confirmation required)
- \`/full\` — switch to the Full tab
- \`/export [md|json]\` — export saved memory into the working directory
- \`/undo\` — undo the last edit
- \`/help\` — this screen

## Keys

\`Tab\`/\`Shift+Tab\` switch Summary/Full · arrows, Page Up/Down, mouse wheel scroll · \`C\` copies the displayed view · \`R\` retries the last bar command · \`L\` expands a captured latest Pi response · \`Esc\` clears the draft, then closes.

Use \`/thread doctor\` to check the Agy backend, and \`/thread config\` to change the model or reasoning effort.`;

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

function backendLabel(settings: ReturnType<typeof threadSettings>, status?: BackendStatus): string {
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
	const store = new JsonMemoryStore(join(getAgentDir(), "buddy-memory"));
	const mutate = createMutationQueue();

	const load = (ctx: ExtensionCommandContext) => store.load(ctx.sessionManager.getSessionId());
	const save = (state: StoredState, signal?: AbortSignal) => store.save(state, signal);
	const stateOrEmpty = async (ctx: ExtensionCommandContext) => (await load(ctx)) ?? createEmptyState(ctx.sessionManager.getSessionId(), softwareProfile);
	const markAgyUnavailable = (ctx: ExtensionCommandContext) => {
		ctx.ui.setStatus("buddy-memory", "Agy missing: install/sign in · /thread doctor|config · Pi fallback");
	};
	const clearAgyUnavailable = (ctx: ExtensionCommandContext) => {
		ctx.ui.setStatus("buddy-memory", undefined);
	};

	const runGenerate = async (
		ctx: ExtensionCommandContext,
		existing: StoredState | null,
		mode: "create" | "refresh" | "reset",
		signal: AbortSignal,
		onProgress: (text: string) => void,
	): Promise<{ state: StoredState; status: BackendStatus } | undefined> => {
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
		const sourceBudget = computeSourceBudgetChars(AGY_REQUEST_CHARS, priorChars);
		const snapshot = captureBranch(sessionId, headId, branch, sourceBudget, () => capturedAt);
		const settings = threadSettings(existing);
		let status: BackendStatus = { backend: "Agy", model: settings.model, effort: settings.effort };
		const infer = makeInference(ctx, settings, () => onProgress("**Building and validating structured memory…**"), (next) => { status = next; }, () => markAgyUnavailable(ctx));
		const state = await regenerateMemory({ existing, snapshot, mode, profile: softwareProfile, infer, save, signal, requestBudgetChars: AGY_REQUEST_CHARS });
		return { state, status };
	};

	const openThreadModal = async (ctx: ExtensionCommandContext, presetCommand?: BarCommand): Promise<void> => {
		let state = await load(ctx);
		if (presetCommand && !state?.memory) {
			if (!(await ctx.ui.confirm("Create thread memory?", "No memory exists for this Pi session. Create it from the available current lineage?"))) return;
		}
		state ??= createEmptyState(ctx.sessionManager.getSessionId(), softwareProfile);

		const dispatch = (command: DispatchableBarCommand): { run: (signal: AbortSignal, onProgress: (text: string) => void) => Promise<BarDispatchResult<StoredState | string>> } => {
			if (command.action === "ask") {
				const captured = state!;
				const question = command.question;
				const latest = latestCompletedAssistantText(ctx.sessionManager.getBranch());
				const settings = threadSettings(captured);
				let status: BackendStatus = { backend: "Agy", model: settings.model, effort: settings.effort };
				return {
					run: async (signal, onProgress) => {
						const infer = makeInference(ctx, settings, (text) => onProgress(`## Answer\n\n${text}`), (next) => { status = next; }, () => markAgyUnavailable(ctx));
						const answer = await askMemory(captured, question, latest, infer, signal);
						return {
							kind: "display",
							result: textResult(`## Question\n\n${question}\n\n## Answer\n\n${answer}`, status, { latestRequested: true, latestResponse: latest }),
							retryable: true,
						};
					},
				};
			}
			if (command.action === "edit") {
				const captured = state!;
				const instruction = command.instruction;
				const settings = threadSettings(captured);
				let status: BackendStatus = { backend: "Agy", model: settings.model, effort: settings.effort };
				return {
					run: async (signal, onProgress) => {
						const infer = makeInference(ctx, settings, () => onProgress("**Editing and validating structured memory…**"), (next) => { status = next; }, () => markAgyUnavailable(ctx));
						const next = await mutate(() => editMemory({ existing: captured, instruction, profile: softwareProfile, infer, save, signal }));
						state = next;
						return { kind: "display", result: memoryResult(next, () => ctx.sessionManager.getLeafId(), status), retryable: true };
					},
				};
			}
			if (command.action === "steer") {
				const captured = state!;
				const intent = command.intent;
				const settings = threadSettings(captured);
				let status: BackendStatus = { backend: "Agy", model: settings.model, effort: settings.effort };
				return {
					run: async (signal, onProgress) => {
						const infer = makeInference(ctx, settings, onProgress, (next) => { status = next; }, () => markAgyUnavailable(ctx));
						const prompt = await steerMemory(captured, intent, infer, signal);
						return { kind: "display", result: textResult(prompt, status), retryable: true };
					},
				};
			}
			if (command.action === "refresh" || command.action === "reset") {
				const captured = state!;
				const mode = command.action;
				return {
					run: async (signal, onProgress) => {
						const outcome = await mutate(() => runGenerate(ctx, captured, mode, signal, onProgress));
						if (!outcome) return { kind: "cancelled" };
						state = outcome.state;
						return { kind: "display", result: memoryResult(outcome.state, () => ctx.sessionManager.getLeafId(), outcome.status), retryable: true };
					},
				};
			}
			if (command.action === "undo") {
				const captured = state!;
				return {
					run: async () => {
						const next = await mutate(() => undoLastEdit(captured, save));
						state = next;
						return { kind: "display", result: memoryResult(next, () => ctx.sessionManager.getLeafId()), retryable: false };
					},
				};
			}
			if (command.action === "focus" || command.action === "focus-clear") {
				const captured = state!;
				const instruction = command.action === "focus" ? command.instruction : null;
				return {
					run: async () => {
						const next = await mutate(() => updateFocus(captured, instruction, save));
						state = next;
						return { kind: "notice", text: instruction ? "Focus saved. Applies on the next refresh or reset." : "Focus cleared." };
					},
				};
			}
			const captured = state!;
			const format = command.format;
			return {
				run: async () => {
					const path = await writeUniqueExport(ctx.cwd, ctx.sessionManager.getSessionId(), format, renderExport(captured, format, ctx.sessionManager.getLeafId()));
					return { kind: "notice", text: `Exported ${path}` };
				},
			};
		};

		await showThreadModal(ctx, {
			title: "Thread memory",
			loadingText: "Building thread memory…",
			retryLabel: "build again",
			initial: state.memory ? memoryResult(state, () => ctx.sessionManager.getLeafId()) : undefined,
			run: state.memory ? undefined : async (signal, onProgress) => {
				const outcome = await mutate(() => runGenerate(ctx, state!, "create", signal, onProgress));
				state = outcome!.state;
				return memoryResult(outcome!.state, () => ctx.sessionManager.getLeafId(), outcome!.status);
			},
			dispatch,
			helpText: HELP_MARKDOWN,
			presetCommand,
		});
	};

	const isCurrentModel = (item: AgyModelFamily, settings: { model: string }) => item.id === settings.model || item.variants.some((variant) => variant.id === settings.model);

	const configureModel = async (ctx: ExtensionCommandContext): Promise<void> => {
		const existing = await stateOrEmpty(ctx);
		const currentSettings = threadSettings(existing);
		const models = await listAgyModels();
		const ordered = [...models].sort((a, b) => Number(isCurrentModel(b, currentSettings)) - Number(isCurrentModel(a, currentSettings)));
		const choices = ordered.map((item) => `${item.id} — ${item.label}${isCurrentModel(item, currentSettings) ? " (current)" : ""}`);
		const choice = await ctx.ui.select(`Thread Agy model (current: ${currentSettings.model})`, choices);
		if (!choice) return;
		const selected = ordered[choices.indexOf(choice)]!;
		const effort = selected.efforts.includes(currentSettings.effort === "default" ? "low" : currentSettings.effort)
			? currentSettings.effort
			: selected.efforts.includes("low") ? "low" : (selected.efforts[0] ?? "default");
		await mutate(async () => {
			const current = await stateOrEmpty(ctx);
			return updateThreadSettings(current, { model: selected.id, effort }, save);
		});
		ctx.ui.notify(`Thread Agy model: ${selected.id} · effort ${effort}`, "info");
	};

	const configureEffort = async (ctx: ExtensionCommandContext): Promise<void> => {
		const existing = await stateOrEmpty(ctx);
		const settings = threadSettings(existing);
		const models = await listAgyModels();
		const family = models.find((item) => isCurrentModel(item, settings));
		if (!family) {
			ctx.ui.notify(`Model "${settings.model}" is not in Agy's current catalog. Use /thread config to pick a model first.`, "warning");
			return;
		}
		if (!family.efforts.length) {
			ctx.ui.notify(`${family.label} uses a fixed effort level.`, "info");
			return;
		}
		const efforts = [...family.efforts].sort((a, b) => Number(b === settings.effort) - Number(a === settings.effort));
		const choices = efforts.map((item) => `${item}${item === settings.effort ? " (current)" : ""}`);
		const choice = await ctx.ui.select(`Thread reasoning effort (current: ${settings.effort})`, choices);
		if (!choice) return;
		const effort = efforts[choices.indexOf(choice)]!;
		await mutate(async () => {
			const current = await stateOrEmpty(ctx);
			return updateThreadSettings(current, { ...threadSettings(current), effort }, save);
		});
		ctx.ui.notify(`Thread reasoning effort: ${effort}`, "info");
	};

	const runConfigMenu = async (ctx: ExtensionCommandContext): Promise<void> => {
		for (;;) {
			const choice = await ctx.ui.select("Thread config", ["Model", "Effort", "Done"]);
			if (!choice || choice === "Done") return;
			if (choice === "Model") await configureModel(ctx);
			else await configureEffort(ctx);
		}
	};

	pi.registerCommand("thread", {
		description: "Open or manage session-local thread memory",
		getArgumentCompletions: (prefix) => {
			const commands = ["doctor", "config"];
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
									summary: `# Thread memory doctor\n\n- ✓ **Agy:** ${version}\n- ✓ **Agy account:** connected\n- ${selected ? "✓" : "✗"} **Agy model:** \`${settings.model}\`${selected ? " is available" : " is not in the current catalog"}\n- ${effortReady ? "✓" : "✗"} **Reasoning effort:** ${settings.effort}\n- **Pi fallback (ENOENT only):** ${fallback}\n\n${selected && effortReady ? "**Ready.**" : "**Use `/thread config` to choose supported settings.**"}`,
									sourceLabel: `Agy: ${settings.model} · ${settings.effort}`,
								};
							} catch (error) {
								if (!(error instanceof AgyUnavailableError)) throw error;
								markAgyUnavailable(ctx);
								return {
									summary: `# Thread memory doctor\n\nAgy was not found on PATH. Install Agy, sign in, then use \`/thread doctor\`. Configure this thread with \`/thread config\`.\n\nPi fallback is used only when spawning Agy returns ENOENT.`,
									sourceLabel: `Pi fallback available: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model selected"}`,
								};
							}
						},
					});
					return;
				}
				if (command.action === "config") {
					await runConfigMenu(ctx);
					return;
				}
				if (command.action === "open") {
					await openThreadModal(ctx);
					return;
				}
				await openThreadModal(ctx, command.command);
			} catch (error) {
				if (error instanceof AgyUnavailableError) markAgyUnavailable(ctx);
				ctx.ui.notify(`Thread memory: ${errorMessage(error)}`, "error");
			}
		},
	});
}

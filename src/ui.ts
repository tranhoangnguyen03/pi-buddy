import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { copyToClipboard, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
	Markdown,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Focusable,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

type Theme = ExtensionCommandContext["ui"]["theme"];
type TuiLike = {
	readonly mode: "regular" | "fullscreen";
	readonly terminal?: { write?: (data: string) => void };
	requestRender(): void;
};
type ModalKind = "loading" | "streaming" | "result" | "error";

export interface ThreadModalResult<T = unknown> {
	summary: string;
	full?: string;
	value?: T;
	sourceLabel?: string;
	latestRequested?: boolean;
	latestResponse?: string | null;
}

export interface ThreadModalOptions<T> {
	title: string;
	initial?: ThreadModalResult<T>;
	initialView?: "summary" | "full";
	loadingText?: string;
	retryLabel?: string;
	retryable?: boolean;
	run?: (signal: AbortSignal, onProgress: (text: string) => void) => Promise<ThreadModalResult<T>>;
}

export function wheelDelta(data: string): number {
	const match = /^\x1b\[<(\d+);\d+;\d+[Mm]$/.exec(data);
	if (!match) return 0;
	const button = Number.parseInt(match[1]!, 10);
	if ((button & 64) === 0) return 0;
	return (button & 3) === 0 ? -3 : (button & 3) === 1 ? 3 : 0;
}

export function setRegularMouseReporting(tui: Pick<TuiLike, "mode" | "terminal">, enabled: boolean): void {
	if (tui.mode === "regular") tui.terminal?.write?.(`\x1b[?1000${enabled ? "h" : "l"}\x1b[?1006${enabled ? "h" : "l"}`);
}

export class ThreadModal implements Focusable {
	focused = false;
	private readonly tui: TuiLike;
	private readonly theme: Theme;
	private readonly title: string;
	private readonly onClose: () => void;
	private readonly onRetry: () => void;
	private readonly onDispose: () => void;
	private readonly retryLabel: string;
	private readonly copy: (text: string) => Promise<void>;
	private readonly markdown = new Markdown("", 0, 0, getMarkdownTheme());
	private kind: ModalKind = "loading";
	private result?: ThreadModalResult;
	private activeView: "summary" | "full";
	private offsets = { summary: 0, full: 0 };
	private maxOffset = 0;
	private bodyHeight = 1;
	private notice = "";
	private retryable = false;
	private disposed = false;
	private expandedLatest = false;
	private jumpToLatest = false;

	constructor(
		tui: TuiLike,
		theme: Theme,
		title: string,
		onClose: () => void,
		onRetry: () => void,
		onDispose: () => void,
		retryLabel = "try again",
		copy: (text: string) => Promise<void> = copyToClipboard,
		initialView: "summary" | "full" = "summary",
	) {
		this.tui = tui;
		this.theme = theme;
		this.title = title;
		this.onClose = onClose;
		this.onRetry = onRetry;
		this.onDispose = onDispose;
		this.retryLabel = retryLabel;
		this.copy = copy;
		this.activeView = initialView;
		setRegularMouseReporting(this.tui, true);
	}

	setLoading(text: string): void {
		this.kind = "loading";
		this.notice = "";
		this.markdown.setText(`**${text}**`);
		this.offsets[this.activeView] = 0;
		this.tui.requestRender();
	}

	setStreaming(text: string): void {
		this.kind = "streaming";
		this.markdown.setText(text || "**Working…**");
		this.tui.requestRender();
	}

	setResult(result: ThreadModalResult, retryable: boolean, notice = ""): void {
		this.kind = "result";
		this.result = result;
		this.retryable = retryable;
		this.notice = notice;
		this.expandedLatest = false;
		this.jumpToLatest = false;
		if (!result.full) this.activeView = "summary";
		this.offsets = { summary: 0, full: 0 };
		this.updateMarkdown();
	}

	setError(message: string): void {
		this.kind = "error";
		this.retryable = true;
		this.notice = "";
		this.markdown.setText(`# Thread memory ran into a problem\n\n${message}`);
		this.offsets[this.activeView] = 0;
		this.tui.requestRender();
	}

	private displayedText(): string {
		if (!this.result) return "";
		const text = this.activeView === "full" && this.result.full ? this.result.full : this.result.summary;
		if (!this.result.latestRequested) return text;
		if (!this.result.latestResponse) return `${text}\n\n---\n\n_No completed Pi response was available._`;
		return this.expandedLatest
			? `${text}\n\n---\n\n## Latest Pi response\n\n${this.result.latestResponse}`
			: `${text}\n\n---\n\n_Latest Pi response hidden — press L to expand._`;
	}

	private updateMarkdown(): void {
		this.markdown.setText(this.displayedText());
		this.tui.requestRender();
	}

	private scroll(delta: number): void {
		this.offsets[this.activeView] = Math.max(0, Math.min(this.offsets[this.activeView] + delta, this.maxOffset));
		this.notice = "";
		this.tui.requestRender();
	}

	private switchView(direction: 1 | -1): void {
		if (!this.result?.full || this.kind !== "result") return;
		this.activeView = direction === 1
			? this.activeView === "summary" ? "full" : "summary"
			: this.activeView === "full" ? "summary" : "full";
		this.updateMarkdown();
	}

	private controls(): string {
		if (this.kind === "loading") return "Esc cancel";
		if (this.kind === "streaming") return "Working… · ↑/↓/PgUp/PgDn scroll · Esc cancel";
		if (this.kind === "error") return "R try again · Esc close";
		return `↑/↓/PgUp/PgDn scroll · C copy${this.result?.latestResponse ? " · L latest" : ""}${this.retryable ? ` · R ${this.retryLabel}` : ""} · Esc close`;
	}

	private frameLine(content: string, innerWidth: number): string {
		const clipped = truncateToWidth(content, innerWidth, "");
		return `${this.theme.fg("border", "│")}${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))}${this.theme.fg("border", "│")}`;
	}

	render(width: number): string[] {
		const dialogWidth = Math.max(24, width);
		const innerWidth = Math.max(22, dialogWidth - 2);
		const dialogHeight = Math.min(32, Math.max(7, Math.floor((process.stdout.rows ?? 30) * 0.78)));
		this.bodyHeight = Math.max(1, dialogHeight - 7);
		const rendered = this.markdown.render(innerWidth);
		this.maxOffset = Math.max(0, rendered.length - this.bodyHeight);
		if (this.jumpToLatest) {
			const latestLine = rendered.findIndex((line) => line.includes("Latest Pi response"));
			if (latestLine >= 0) this.offsets[this.activeView] = Math.min(latestLine, this.maxOffset);
			this.jumpToLatest = false;
		}
		this.offsets[this.activeView] = Math.max(0, Math.min(this.offsets[this.activeView], this.maxOffset));
		const offset = this.offsets[this.activeView];
		const hiddenBelow = Math.max(0, this.maxOffset - offset);
		const scroll = this.maxOffset > 0 ? ` · ↑${offset} ↓${hiddenBelow}` : "";
		const tabs = this.result?.full
			? ` · ${this.activeView === "summary" ? "[Summary] | Full" : "Summary | [Full]"}`
			: "";
		const source = this.result?.sourceLabel ?? "";
		const top = this.theme.fg("border", `┌${"─".repeat(innerWidth)}┐`);
		const bottom = this.theme.fg("border", `└${"─".repeat(innerWidth)}┘`);
		const rule = this.theme.fg("border", `├${"─".repeat(innerWidth)}┤`);
		const visible = rendered.slice(offset, offset + this.bodyHeight);
		const lines = [
			top,
			this.frameLine(this.theme.fg("accent", this.theme.bold(`${this.title}${tabs}${scroll}`)), innerWidth),
			this.frameLine(this.theme.fg("dim", source), innerWidth),
			rule,
			...visible.map((line) => this.frameLine(line, innerWidth)),
		];
		for (let index = visible.length; index < this.bodyHeight; index++) lines.push(this.frameLine("", innerWidth));
		lines.push(rule, this.frameLine(this.theme.fg("dim", `${this.notice ? `${this.notice} · ` : ""}${this.controls()}`), innerWidth), bottom);
		return lines;
	}

	invalidate(): void {
		this.markdown.invalidate();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) return this.onClose();
		if (matchesKey(data, "tab")) return this.switchView(1);
		if (matchesKey(data, "shift+tab")) return this.switchView(-1);
		const delta = wheelDelta(data)
			|| (matchesKey(data, "up") ? -1 : matchesKey(data, "down") ? 1 : 0)
			|| (matchesKey(data, "pageUp") ? -Math.max(1, this.bodyHeight - 1) : matchesKey(data, "pageDown") ? Math.max(1, this.bodyHeight - 1) : 0);
		if (delta) return this.scroll(delta);
		if ((matchesKey(data, "c") || matchesKey(data, "shift+c")) && this.kind === "result") {
			void this.copy(this.displayedText()).then(() => {
				if (!this.disposed) { this.notice = "Copied"; this.tui.requestRender(); }
			}).catch((error) => {
				if (!this.disposed) { this.notice = `Copy failed: ${error instanceof Error ? error.message : String(error)}`; this.tui.requestRender(); }
			});
			return;
		}
		if ((matchesKey(data, "r") || matchesKey(data, "shift+r")) && this.retryable && this.kind !== "loading" && this.kind !== "streaming") return this.onRetry();
		if ((matchesKey(data, "l") || matchesKey(data, "shift+l")) && this.kind === "result" && this.result?.latestResponse) {
			this.expandedLatest = !this.expandedLatest;
			this.jumpToLatest = this.expandedLatest;
			this.updateMarkdown();
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel" || !event.wheelDelta) return undefined;
		this.scroll(event.wheelDelta);
		return { handled: true, render: true, focus: true };
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		setRegularMouseReporting(this.tui, false);
		this.onDispose();
	}
}

export async function showThreadModal<T>(ctx: ExtensionCommandContext, options: ThreadModalOptions<T>): Promise<T | undefined> {
	if (ctx.mode !== "tui") return options.run ? (await options.run(new AbortController().signal, () => {})).value : options.initial?.value;
	let activeOperation: Promise<void> = Promise.resolve();
	const value = await ctx.ui.custom<T | undefined>((tui, theme, _keybindings, done) => {
		let closed = false;
		let controller: AbortController | undefined;
		let current = options.initial;
		let execute = () => {};
		const close = () => {
			if (closed) return;
			closed = true;
			controller?.abort();
			done(current?.value);
		};
		const modal = new ThreadModal(tui, theme, options.title, close, () => execute(), () => {
			closed = true;
			controller?.abort();
		}, options.retryLabel, copyToClipboard, options.initialView);
		execute = () => {
			if (!options.run || controller || closed) return;
			const previous = current;
			const nextController = new AbortController();
			controller = nextController;
			modal.setLoading(options.loadingText ?? "Working…");
			activeOperation = options.run(nextController.signal, (text) => {
				if (!closed && !nextController.signal.aborted && controller === nextController) modal.setStreaming(text);
			}).then((result) => {
				if (closed || nextController.signal.aborted) return;
				current = result;
				modal.setResult(result, options.retryable ?? true);
			}).catch((error) => {
				if (closed || nextController.signal.aborted) return;
				const message = error instanceof Error ? error.message : String(error);
				if (previous) {
					current = previous;
					modal.setResult(previous, options.retryable ?? true, `Retry failed: ${message}`);
				} else modal.setError(message);
			}).finally(() => {
				if (controller === nextController) controller = undefined;
			});
		};
		if (current) modal.setResult(current, options.retryable ?? Boolean(options.run));
		else execute();
		return modal;
	}, {
		overlay: true,
			overlayOptions: { width: "78%", minWidth: 48, maxHeight: "78%", anchor: "top-center", margin: { top: 1, left: 2, right: 2 } },
	});
	await activeOperation;
	return value;
}

export async function showFocus(ctx: ExtensionCommandContext, focus: string | null): Promise<"clear" | undefined> {
	const options = focus ? ["Keep focus", "Clear focus"] : ["Close"];
	const choice = await ctx.ui.select(`Thread focus: ${focus ?? "(not set)"}`, options);
	return choice === "Clear focus" ? "clear" : undefined;
}

import assert from "node:assert/strict";
import test from "node:test";
import { initTheme } from "@earendil-works/pi-coding-agent";

import { showThreadModal, ThreadModal, wheelDelta } from "../src/ui.ts";
import { createMutationQueue } from "../src/core.ts";

initTheme();

const tick = () => new Promise((resolve) => setImmediate(resolve));
const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function modal(options: { retry?: () => void; copy?: (text: string) => Promise<void>; close?: () => void; onBarSubmit?: (command: unknown) => void; helpText?: string } = {}) {
	let renders = 0;
	const component = new ThreadModal(
		{ mode: "fullscreen", requestRender: () => { renders++; } },
		theme as never,
		"Thread memory",
		options.close ?? (() => {}),
		options.retry ?? (() => {}),
		() => {},
		(options.onBarSubmit ?? (() => {})) as never,
		"build again",
		options.copy ?? (async () => {}),
		undefined,
		options.helpText,
	);
	return { component, renders: () => renders };
}

function type(component: ThreadModal, text: string): void {
	for (const char of text) component.handleInput(char);
}

test("Summary and Full are native tabs with independent scroll offsets and no retry/bar-submit call", () => {
	let retries = 0;
	const { component } = modal({ retry: () => { retries++; } });
	component.setResult({ summary: Array.from({ length: 50 }, (_, i) => `summary ${i}`).join("\n\n"), full: Array.from({ length: 50 }, (_, i) => `full ${i}`).join("\n\n") }, true);
	component.render(80);
	for (let i = 0; i < 5; i++) component.handleInput("\x1b[B");
	assert.match(component.render(80).join("\n"), /\[Summary\].*↑5/);
	component.handleInput("\t");
	assert.match(component.render(80).join("\n"), /\[Full\].*↑0/);
	component.handleInput("\x1b[B");
	component.handleInput("\x1b[B");
	component.handleInput("\x1b[Z");
	assert.match(component.render(80).join("\n"), /\[Summary\].*↑5/);
	component.handleInput("\t");
	assert.match(component.render(80).join("\n"), /\[Full\].*↑2/);
	assert.equal(retries, 0);
});

test("arrows, PageUp/PageDown, raw wheel, and normalized trackpad wheel scroll the modal", () => {
	const { component } = modal();
	component.setResult({ summary: Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n\n") }, false);
	component.render(80);
	component.handleInput("\x1b[6~");
	const afterPage = component.render(80).join("\n");
	assert.match(afterPage, /↑[1-9]/);
	component.handleInput("\x1b[<65;1;1M");
	component.handleMouse({ type: "wheel", button: "none", x: 1, y: 1, screenX: 1, screenY: 1, width: 80, height: 20, shift: false, alt: false, ctrl: false, wheelDelta: 4 });
	assert.notEqual(component.render(80).join("\n"), afterPage);
	assert.equal(wheelDelta("\x1b[<64;1;1M"), -3);
	assert.equal(wheelDelta("\x1b[<65;1;1M"), 3);
});

test("C copies only the displayed view, L expands latest inline, and Esc clears the draft before closing", async () => {
	const copied: string[] = [];
	let closed = 0;
	const { component } = modal({ copy: async (text) => { copied.push(text); }, close: () => { closed++; } });
	component.setResult({ summary: "summary view", full: "full view", latestRequested: true, latestResponse: "latest response" }, false);
	component.handleInput("c");
	await tick();
	assert.match(copied[0]!, /summary view/);
	assert.doesNotMatch(copied[0]!, /latest response/);
	component.handleInput("l");
	assert.match(component.render(80).join("\n"), /latest response/);
	component.handleInput("c");
	await tick();
	assert.match(copied[1]!, /latest response/);
	component.handleInput("\t");
	component.handleInput("c");
	await tick();
	assert.match(copied[2]!, /full view/);
	type(component, "draft text");
	component.handleInput("\x1b");
	assert.equal(closed, 0);
	assert.doesNotMatch(component.render(80).join("\n"), /draft text/);
	component.handleInput("\x1b");
	assert.equal(closed, 1);
});

test("single-letter shortcuts type into a non-empty draft instead of firing copy/retry/latest", async () => {
	const copied: string[] = [];
	let retries = 0;
	const { component } = modal({ copy: async (text) => { copied.push(text); }, retry: () => { retries++; } });
	component.setResult({ summary: "view", latestRequested: true, latestResponse: "latest" }, true);
	type(component, "xcr");
	assert.equal(copied.length, 0);
	assert.equal(retries, 0);
	assert.match(component.render(80).join("\n"), /> xcr/);
});

test("bar input routes /full and /help locally without reaching the bar-submit callback", () => {
	let submitted = 0;
	const { component } = modal({ onBarSubmit: () => { submitted++; }, helpText: "# Help\n\nbar commands" });
	component.setResult({ summary: "summary view", full: "full view" }, false);
	type(component, "/full");
	component.handleInput("\n");
	assert.match(component.render(80).join("\n"), /\[Full\]/);
	assert.equal(submitted, 0);
	component.handleInput("\t");
	type(component, "/help");
	component.handleInput("\n");
	assert.match(component.render(80).join("\n"), /bar commands/);
	assert.equal(submitted, 0);
});

test("an unrecognized bar command shows a notice and does not call the bar-submit callback", () => {
	let submitted = 0;
	const { component } = modal({ onBarSubmit: () => { submitted++; } });
	component.setResult({ summary: "view" }, false);
	type(component, "/nope");
	component.handleInput("\n");
	assert.match(component.render(80).join("\n"), /Unknown bar command/);
	assert.equal(submitted, 0);
});

test("a recognized bar command clears the draft and reaches the bar-submit callback", () => {
	const submitted: unknown[] = [];
	const { component } = modal({ onBarSubmit: (command) => submitted.push(command) });
	component.setResult({ summary: "view" }, false);
	type(component, "/undo");
	component.handleInput("\n");
	assert.deepEqual(submitted, [{ action: "undo" }]);
	assert.doesNotMatch(component.render(80).join("\n"), /\/undo/);
});

test("typing / shows an inline hint of available bar commands, narrowed by prefix", () => {
	const { component } = modal();
	component.setResult({ summary: "view" }, false);
	type(component, "/");
	assert.match(component.render(80).join("\n"), /\/edit.*\/steer.*\/focus/);
	type(component, "ed");
	assert.match(component.render(80).join("\n"), /\/edit/);
	assert.doesNotMatch(component.render(80).join("\n"), /\/steer/);
});

test("R reruns the same captured input and a failed retry restores the previous good result inline", async () => {
	const captured = { question: "same captured question", latest: "same latest" };
	const seen: unknown[] = [];
	let runs = 0;
	let afterRetry = "";
	const fakeContext = {
		mode: "tui",
		ui: {
			custom: async (factory: (...args: any[]) => any) => {
				let finish!: (value: unknown) => void;
				const finished = new Promise((resolve) => { finish = resolve; });
				const component = factory(
					{ mode: "fullscreen", requestRender: () => {} },
					theme,
					undefined,
					finish,
				);
				await tick();
				assert.match(component.render(80).join("\n"), /good result/);
				component.handleInput("r");
				await tick();
				afterRetry = component.render(80).join("\n");
				component.handleInput("\x1b");
				component.dispose();
				return finished;
			},
		},
	};
	const value = await showThreadModal(fakeContext as never, {
		title: "Retry",
		loadingText: "loading",
		run: async () => {
			seen.push(captured);
			if (++runs === 2) throw new Error("offline failure");
			return { summary: "good result", value: "good" };
		},
	});
	assert.equal(value, "good");
	assert.deepEqual(seen, [captured, captured]);
	assert.match(afterRetry, /good result/);
	assert.match(afterRetry, /Retry failed: offline failure/);
});

test("closing aborts immediately but keeps the mutation queue locked through a pending commit", async () => {
	const enqueue = createMutationQueue();
	let releaseCommit!: () => void;
	let operationStarted!: () => void;
	const commit = new Promise<void>((resolve) => { releaseCommit = resolve; });
	const started = new Promise<void>((resolve) => { operationStarted = resolve; });
	let signal: AbortSignal | undefined;
	let secondStarted = false;
	const fakeContext = {
		mode: "tui",
		ui: {
			custom: async (factory: (...args: any[]) => any) => {
				let finish!: (value: unknown) => void;
				const finished = new Promise((resolve) => { finish = resolve; });
				const component = factory({ mode: "fullscreen", requestRender: () => {} }, theme, undefined, finish);
				component.handleInput("\x1b");
				component.dispose();
				return finished;
			},
		},
	};
	const first = enqueue(() => showThreadModal(fakeContext as never, {
		title: "Commit boundary",
		run: async (nextSignal) => {
			signal = nextSignal;
			operationStarted();
			await commit;
			return { summary: "committed", value: "done" };
		},
	}));
	await started;
	const second = enqueue(async () => { secondStarted = true; });
	await tick();
	const stayedLocked = !secondStarted;
	const aborted = signal?.aborted;
	releaseCommit();
	await Promise.all([first, second]);
	assert.equal(aborted, true);
	assert.equal(stayedLocked, true);
	assert.equal(secondStarted, true);
});

test("non-TUI mode runs once and returns its value without opening the overlay", async () => {
	let calls = 0;
	const value = await showThreadModal({ mode: "print" } as never, {
		title: "Headless",
		run: async () => { calls++; return { summary: "s", value: "v" }; },
	});
	assert.equal(value, "v");
	assert.equal(calls, 1);
});

test("a preset bar command runs once the modal already shows an existing result", async () => {
	const dispatched: unknown[] = [];
	const fakeContext = {
		mode: "tui",
		ui: {
			custom: async (factory: (...args: any[]) => any) => {
				let finish!: (value: unknown) => void;
				const finished = new Promise((resolve) => { finish = resolve; });
				const component = factory({ mode: "fullscreen", requestRender: () => {} }, theme, undefined, finish);
				await tick();
				assert.match(component.render(80).join("\n"), /answer/);
				component.handleInput("\x1b");
				component.dispose();
				return finished;
			},
		},
	};
	await showThreadModal(fakeContext as never, {
		title: "Preset",
		initial: { summary: "existing" },
		presetCommand: { action: "ask", question: "What changed?" },
		dispatch: (command) => {
			dispatched.push(command);
			return { run: async () => ({ kind: "display", result: { summary: "answer" }, retryable: true }) };
		},
	});
	assert.deepEqual(dispatched, [{ action: "ask", question: "What changed?" }]);
});

test("a preset bar command runs only after initial memory creation succeeds", async () => {
	const dispatched: unknown[] = [];
	const fakeContext = {
		mode: "tui",
		ui: {
			custom: async (factory: (...args: any[]) => any) => {
				let finish!: (value: unknown) => void;
				const finished = new Promise((resolve) => { finish = resolve; });
				const component = factory({ mode: "fullscreen", requestRender: () => {} }, theme, undefined, finish);
				await tick();
				await tick();
				assert.match(component.render(80).join("\n"), /answer/);
				component.handleInput("\x1b");
				component.dispose();
				return finished;
			},
		},
	};
	await showThreadModal(fakeContext as never, {
		title: "Preset",
		run: async () => ({ summary: "created", value: "state" }),
		presetCommand: { action: "ask", question: "What changed?" },
		dispatch: (command) => {
			dispatched.push(command);
			return { run: async () => ({ kind: "display", result: { summary: "answer" }, retryable: true }) };
		},
	});
	assert.deepEqual(dispatched, [{ action: "ask", question: "What changed?" }]);
});

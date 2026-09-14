import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
	AgyUnavailableError,
	agyArgs,
	agyInputFrame,
	inferenceProgress,
	inferWithFallback,
	parseAgyLine,
	parseAgyModels,
	runAgyText,
} from "../src/backend.ts";

const settings = { model: "gemini-3.7-flash", effort: "low" } as const;

test("Agy input uses stdin NDJSON and never puts the prompt in argv", () => {
	const prompt = "x".repeat(100_000);
	const frame = JSON.parse(agyInputFrame(prompt));
	assert.equal(frame.event, "user");
	assert.equal(frame.message.content, prompt);
	assert.equal(agyArgs(settings).some((argument) => argument.includes(prompt)), false);
	assert.deepEqual(agyArgs(settings).slice(0, 6), ["--sandbox", "--disable-slash-commands", "--input-format", "stream-json", "--output-format", "stream-json"]);
	assert.doesNotMatch(agyArgs({ model: "fixed-model", effort: "default" }).join(" "), /--effort/);
	assert.deepEqual(parseAgyModels("model-low\tModel (Low)\nmodel-high\tModel (High)\nfixed\tFixed"), [
		{ id: "model", label: "Model", efforts: ["low", "high"], variants: [{ id: "model-low", effort: "low" }, { id: "model-high", effort: "high" }] },
		{ id: "fixed", label: "Fixed", efforts: [], variants: [{ id: "fixed", effort: undefined }] },
	]);
});

test("Agy stream parser accepts deltas and final results and rejects malformed framing", () => {
	assert.deepEqual(parseAgyLine('{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"hi"}}'), { delta: "hi" });
	assert.deepEqual(parseAgyLine('{"event":"result","result":{"status":"SUCCESS","response":"done"}}'), { result: "done" });
	assert.throws(() => parseAgyLine("not json"), /invalid streaming/);
	assert.throws(() => parseAgyLine('{"event":"result","result":{"status":"ERROR","error":"quota"}}'), /quota/);
});

test("Agy stream parser prefers schema-validated structured_output over the raw final text", () => {
	// Verified against agy 1.2.2: on a structured (--json-schema) call, `response` is the
	// model's raw final text and may carry extra keys the schema forbids (e.g. toolAction,
	// toolSummary) or, after a tool-validation retry, concatenated text from every turn.
	// `structured_output` is the value agy itself validated against the schema.
	const line = '{"event":"result","result":{"status":"SUCCESS","response":"{\\"title\\":\\"t\\",\\"summary\\":\\"s\\",\\"sections\\":[],\\"toolAction\\":\\"Finishing task\\"}","structured_output":{"title":"t","summary":"s","sections":[]}}}';
	assert.deepEqual(parseAgyLine(line), { result: JSON.stringify({ title: "t", summary: "s", sections: [] }) });
});

test("only spawn ENOENT falls back; auth, quota, timeout, malformed, and cancel errors do not", async () => {
	let fallbacks = 0;
	assert.equal(await inferWithFallback(
		async () => { throw new AgyUnavailableError(); },
		async () => { fallbacks++; return "fallback"; },
	), "fallback");
	for (const error of [new Error("quota"), new Error("timeout"), new Error("malformed"), new DOMException("Canceled", "AbortError")]) {
		await assert.rejects(inferWithFallback(async () => { throw error; }, async () => { fallbacks++; return "wrong"; }), new RegExp(error.message));
	}
	assert.equal(fallbacks, 1);
});

test("structured output progress never exposes raw JSON while Ask and Steer stay human-streamed", () => {
	const json = '{"title":"raw"}';
	assert.doesNotMatch(inferenceProgress("index", json), /raw/);
	assert.doesNotMatch(inferenceProgress("edit", json), /raw/);
	assert.equal(inferenceProgress("ask", "human answer"), "human answer");
	assert.equal(inferenceProgress("steer", "human prompt"), "human prompt");
});

test("Agy runner consumes a fake offline stream and returns its validated final frame", async () => {
	const directory = await mkdtemp(join(tmpdir(), "buddy-memory-fake-agy-"));
	const executable = join(directory, "fake-agy.sh");
	try {
		await writeFile(executable, `#!/bin/sh\nread frame\nprintf '%s\\n' '{"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"hello"}}'\nprintf '%s\\n' '{"event":"result","result":{"status":"SUCCESS","response":"hello"}}'\n`, "utf8");
		await chmod(executable, 0o700);
		const progress: string[] = [];
		const result = await runAgyText({ kind: "ask", systemPrompt: "system", userPrompt: "question" }, settings, (text) => progress.push(text), executable);
		assert.equal(result, "hello");
		assert.equal(progress.at(-1), "hello");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("Agy cancellation terminates the subprocess group promptly", async () => {
	const directory = await mkdtemp(join(tmpdir(), "buddy-memory-slow-agy-"));
	const executable = join(directory, "slow-agy.sh");
	try {
		await writeFile(executable, "#!/bin/sh\nread frame\nsleep 30\n", "utf8");
		await chmod(executable, 0o700);
		const controller = new AbortController();
		const started = Date.now();
		const result = runAgyText({ kind: "ask", systemPrompt: "system", userPrompt: "question", signal: controller.signal }, settings, undefined, executable);
		setTimeout(() => controller.abort(), 25);
		await assert.rejects(result, /cancel/i);
		assert.ok(Date.now() - started < 2_000);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

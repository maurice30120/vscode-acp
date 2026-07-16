import * as assert from "node:assert/strict";
import { test } from "node:test";

import { PipelineRunRegistry } from "../dist/index.js";

function makeMockState(): any {
	return {
		cancelled: false,
		abortController: new AbortController(),
	};
}

test("set and get a run", () => {
	const registry = new PipelineRunRegistry();
	const state = makeMockState();
	registry.set("session-1", state);
	assert.equal(registry.get("session-1"), state);
});

test("delete removes a run", () => {
	const registry = new PipelineRunRegistry();
	registry.set("session-1", makeMockState());
	assert.equal(registry.delete("session-1"), true);
	assert.equal(registry.get("session-1"), undefined);
});

test("clear removes all runs", () => {
	const registry = new PipelineRunRegistry();
	registry.set("s1", makeMockState());
	registry.set("s2", makeMockState());
	registry.clear();
	assert.equal(registry.get("s1"), undefined);
	assert.equal(registry.get("s2"), undefined);
});

test("markCancelled sets cancelled and aborts controller", () => {
	const registry = new PipelineRunRegistry();
	const state = makeMockState();
	registry.set("session-1", state);
	const returned = registry.markCancelled("session-1");
	assert.equal(returned, state);
	assert.equal(state.cancelled, true);
	assert.equal(state.abortController.signal.aborted, true);
});

test("markCancelled on missing session returns undefined", () => {
	const registry = new PipelineRunRegistry();
	assert.equal(registry.markCancelled("missing"), undefined);
});

test("throwIfCancelled throws when cancelled", () => {
	const registry = new PipelineRunRegistry();
	const state = makeMockState();
	state.cancelled = true;
	assert.throws(
		() => registry.throwIfCancelled(state),
		/Pipeline cancelled\./,
	);
});

test("throwIfCancelled does not throw when not cancelled", () => {
	const registry = new PipelineRunRegistry();
	const state = makeMockState();
	registry.throwIfCancelled(state);
	assert.equal(state.cancelled, false);
});

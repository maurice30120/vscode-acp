import * as assert from "node:assert/strict";
import { test } from "node:test";

import { renderTemplate } from "../dist/index.js";

test("renderTemplate substitutes userPrompt", () => {
	const result = renderTemplate("Hi {{userPrompt}}", {
		userPrompt: "world",
		stepOutputs: {},
		events: [],
		approvalRejected: false,
		lastOutput: "",
	});
	assert.equal(result, "Hi world");
});

test("renderTemplate substitutes step output", () => {
	const result = renderTemplate("Plan: {{steps.plan.output}}", {
		userPrompt: "",
		stepOutputs: {
			plan: { output: "the plan" },
		},
		events: [],
		approvalRejected: false,
		lastOutput: "",
	});
	assert.equal(result, "Plan: the plan");
});

test("renderTemplate substitutes branch output", () => {
	const result = renderTemplate("Repo: {{steps.p.branches.repo.output}}", {
		userPrompt: "",
		stepOutputs: {
			p: {
				branches: {
					repo: { output: "repo result" },
				},
			},
		},
		events: [],
		approvalRejected: false,
		lastOutput: "",
	});
	assert.equal(result, "Repo: repo result");
});

test("renderTemplate leaves unknown variables as empty string", () => {
	const result = renderTemplate("X: {{steps.missing.output}}", {
		userPrompt: "",
		stepOutputs: {},
		events: [],
		approvalRejected: false,
		lastOutput: "",
	});
	assert.equal(result, "X: ");
});

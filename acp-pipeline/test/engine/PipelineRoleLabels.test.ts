import * as assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildRevisionPrompt,
	getPipelineStepPhase,
	getPipelineStepRole,
	findPlannerStepId,
} from "../../dist/index.js";

function makePipeline(): any {
	return {
		version: 2,
		id: "demo",
		title: "Demo",
		primitives: {
			planner: {
				agent: "Codex",
				prompt: "Plan",
				output: "proposed_plan",
				sideEffects: "none",
				permissions: "allowAll",
			},
			implementer: {
				agent: "Vibe",
				prompt: "Implement {{steps.approval.output}}",
				output: "markdown",
				sideEffects: "workspace",
				permissions: "ask",
			},
			verifier: {
				agent: "Codex",
				prompt: "Verify",
				output: "markdown",
				sideEffects: "none",
				permissions: "ask",
			},
		},
		steps: [
			{ id: "plan", use: "planner" },
			{ id: "approval", type: "approval", input: "{{steps.plan.output}}" },
			{ id: "implement", use: "implementer" },
			{ id: "verify", use: "verifier" },
		],
	};
}

test("getPipelineStepRole maps planner step to planner", () => {
	assert.equal(getPipelineStepRole(makePipeline(), "plan"), "planner");
});

test("getPipelineStepRole maps implement step to implementer", () => {
	assert.equal(getPipelineStepRole(makePipeline(), "implement"), "implementer");
});

test("getPipelineStepRole maps verify step to reviewer", () => {
	assert.equal(getPipelineStepRole(makePipeline(), "verify"), "reviewer");
});

test("getPipelineStepPhase for planner before approval is planning", () => {
	assert.equal(getPipelineStepPhase(makePipeline(), "plan"), "planning");
});

test("getPipelineStepPhase for implementer after approval is implementing", () => {
	assert.equal(getPipelineStepPhase(makePipeline(), "implement"), "implementing");
});

test("getPipelineStepPhase for verifier/reviewer is reviewing", () => {
	assert.equal(getPipelineStepPhase(makePipeline(), "verify"), "reviewing");
});

test("findPlannerStepId returns first proposed_plan step before approval", () => {
	assert.equal(findPlannerStepId(makePipeline()), "plan");
});

test("buildRevisionPrompt contains original, plan and feedback", () => {
	const prompt = buildRevisionPrompt(
		"Fix bug",
		"<proposed_plan>plan</proposed_plan>",
		"More tests",
	);
	assert.ok(prompt.includes("Original user request:"));
	assert.ok(prompt.includes("Fix bug"));
	assert.ok(prompt.includes("Current proposed plan:"));
	assert.ok(prompt.includes("<proposed_plan>plan</proposed_plan>"));
	assert.ok(prompt.includes("User revision request:"));
	assert.ok(prompt.includes("More tests"));
});

test("findPlannerStepId throws when no planner step exists", () => {
	const pipeline = makePipeline();
	pipeline.steps = [{ id: "approval", type: "approval", input: "x" }];
	assert.throws(() => findPlannerStepId(pipeline), /no planner step/);
});

test("getPipelineStepRole returns stepId for unknown roles", () => {
	assert.equal(getPipelineStepRole(makePipeline(), "unknown-step"), "unknown-step");
});

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function createTempWorkspace(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "acp-pipeline-test-"));
}

export function writeFile(
	workspace: string,
	relativePath: string,
	content: string,
): void {
	const filePath = path.join(workspace, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf8");
}

export function minimalAgentConfigs(): Record<string, unknown> {
	return {
		Codex: {},
		Vibe: {},
	};
}

export function validPlanExecuteVerifyDefinition(): Record<string, unknown> {
	return {
		version: 2,
		id: "plan-exec-verify",
		title: "Plan-Execute-Verify Pipeline",
		primitives: {
			planner: {
				agent: "Codex",
				prompt: "Plan this: {{userPrompt}}",
				output: "proposed_plan",
				sideEffects: "none",
				permissions: "allowAll",
			},
			implementer: {
				agent: "Vibe",
				prompt: "Implement: {{steps.planner.output}}",
				output: "markdown",
				sideEffects: "workspace",
				permissions: "ask",
			},
			verifier: {
				agent: "Codex",
				prompt: "Verify: {{steps.implementer.output}}",
				output: "markdown",
				sideEffects: "none",
				permissions: "ask",
			},
		},
		steps: [
			{ id: "planner", use: "planner" },
			{ id: "approval", type: "approval", input: "{{steps.planner.output}}" },
			{ id: "implementer", use: "implementer" },
			{ id: "verifier", use: "verifier" },
		],
	};
}

import * as fs from "node:fs";
import * as path from "node:path";

const SKILLS_DIR = path.join(".agents", "skills");
const SKILL_FILE = "SKILL.md";

export interface SkillCatalogEntry {
	name: string;
	description: string;
	disableModelInvocation: boolean;
	filePath: string;
}

export interface SkillCatalogOptions {
	workspaceCwd: string;
	logger?: (message: string, error?: unknown) => void;
}

/**
 * Scans `.agents/skills/<name>/SKILL.md` and parses YAML frontmatter
 * (`name`, `description`, `disable-model-invocation`). Skills missing a
 * `name` or `description`, or that fail to parse, are skipped.
 */
export function loadSkillCatalog(
	options: SkillCatalogOptions,
): SkillCatalogEntry[] {
	const dir = path.join(options.workspaceCwd, SKILLS_DIR);
	if (!fs.existsSync(dir)) {
		return [];
	}

	let entries: string[];
	try {
		entries = fs.readdirSync(dir);
	} catch (e: unknown) {
		options.logger?.(`Failed to read skills directory ${dir}`, e);
		return [];
	}

	const catalog: SkillCatalogEntry[] = [];
	for (const entry of entries.sort()) {
		const skillDir = path.join(dir, entry);
		const filePath = path.join(skillDir, SKILL_FILE);
		if (!fs.existsSync(filePath)) {
			continue;
		}

		let text: string;
		try {
			text = fs.readFileSync(filePath, "utf8");
		} catch (e: unknown) {
			options.logger?.(`Failed to read skill ${filePath}`, e);
			continue;
		}

		const parsed = parseSkillFrontmatter(text);
		if (!parsed) {
			continue;
		}

		catalog.push({
			name: parsed.name,
			description: parsed.description,
			disableModelInvocation: parsed.disableModelInvocation,
			filePath,
		});
	}

	return catalog;
}

interface ParsedSkillFrontmatter {
	name: string;
	description: string;
	disableModelInvocation: boolean;
}

function parseSkillFrontmatter(text: string): ParsedSkillFrontmatter | null {
	const frontmatter = extractFrontmatter(text);
	if (!frontmatter) {
		return null;
	}

	const name = readScalar(frontmatter, "name");
	const description = readScalar(frontmatter, "description");
	if (!name || !description) {
		return null;
	}

	const disable = readScalar(frontmatter, "disable-model-invocation");
	return {
		name,
		description,
		disableModelInvocation: disable === "true",
	};
}

function extractFrontmatter(text: string): string | null {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
	return match ? match[1] : null;
}

function readScalar(frontmatter: string, key: string): string {
	const re = new RegExp(
		`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*(.*)$`,
		"m",
	);
	const match = re.exec(frontmatter);
	if (!match) {
		return "";
	}
	return match[1].trim().replace(/^["']|["']$/g, "");
}

/**
 * Builds the filtered `<available_skills>` catalog block for a step. Only
 * skills listed in `allowList` are included, and skills with
 * `disable-model-invocation: true` are excluded. Returns an empty string when
 * nothing is eligible, so the runner can skip injection entirely.
 */
export function renderSkillsCatalog(
	catalog: SkillCatalogEntry[],
	allowList: string[] | undefined,
	workspaceCwd: string,
): string {
	if (!allowList || allowList.length === 0) {
		return "";
	}

	const allowed = new Set(allowList);
	const entries = catalog.filter(
		(entry) => allowed.has(entry.name) && !entry.disableModelInvocation,
	);
	if (entries.length === 0) {
		return "";
	}

	const lines = entries.map((entry) => {
		const relativePath = path
			.relative(workspaceCwd, entry.filePath)
			.replace(/\\/g, "/");
		return `- name: ${entry.name}\n  description: ${entry.description}\n  location: ${relativePath}`;
	});

	return `<available_skills>\n${lines.join("\n")}\n</available_skills>`;
}

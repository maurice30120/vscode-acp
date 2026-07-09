import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "@acp-client/pi-extension";

export function getPiPluginRoot(): string {
	const startDir = path.dirname(fileURLToPath(import.meta.url));
	let current = startDir;

	for (;;) {
		const packagePath = path.join(current, "package.json");
		if (fs.existsSync(packagePath)) {
			try {
				const parsed = JSON.parse(fs.readFileSync(packagePath, "utf8")) as {
					name?: unknown;
				};
				if (parsed.name === PACKAGE_NAME) {
					return current;
				}
			} catch {
				// Keep walking upward; a malformed parent package should not mask
				// a valid plugin package root.
			}
		}

		const parent = path.dirname(current);
		if (parent === current) {
			throw new Error(`Unable to locate ${PACKAGE_NAME} package root.`);
		}
		current = parent;
	}
}

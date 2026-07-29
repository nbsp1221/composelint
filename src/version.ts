import packageJson from "../package.json" with { type: "json" };

/** The published version, reported by the CLI and embedded in machine output. */
export const VERSION: string = packageJson.version;

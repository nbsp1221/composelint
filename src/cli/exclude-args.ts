/** Citty keeps only the last value of a string option. Collect each occurrence. */
export function extractExcludes(
  args: string[],
  otherValueOptions: readonly string[],
): string[] {
  const patterns: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") break;
    if (otherValueOptions.includes(arg)) {
      i++;
      continue;
    }

    let pattern: string | undefined;
    if (arg === "--exclude") {
      pattern = args[++i];
      if (pattern?.startsWith("-")) pattern = undefined;
    } else if (arg.startsWith("--exclude=")) {
      pattern = arg.slice("--exclude=".length);
    } else continue;

    const trimmed = pattern?.trim();
    if (!trimmed || trimmed === "!") {
      throw new Error("--exclude requires a non-empty glob pattern.");
    }
    patterns.push(trimmed);
  }

  return patterns;
}

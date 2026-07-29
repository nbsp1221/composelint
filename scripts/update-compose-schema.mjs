#!/usr/bin/env node
/**
 * Refreshes the vendored Compose Specification JSON Schema.
 *
 *   pnpm schema:update
 *
 * The schema is vendored (rather than fetched at runtime) so linting stays
 * offline and deterministic. Provenance is recorded in compose-spec.meta.json
 * so it is obvious how stale the copy is.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "compose-spec/compose-spec";
const SCHEMA_PATH = "schema/compose-spec.json";
const SCHEMA_URL = `https://raw.githubusercontent.com/${REPO}/main/${SCHEMA_PATH}`;
const COMMITS_URL = `https://api.github.com/repos/${REPO}/commits?path=${SCHEMA_PATH}&per_page=1`;

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), "../schemas");

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }
  return response.json();
}

async function main() {
  const schemaResponse = await fetch(SCHEMA_URL);
  if (!schemaResponse.ok) {
    throw new Error(`${SCHEMA_URL} responded ${schemaResponse.status}`);
  }
  const raw = await schemaResponse.text();

  // Fail loudly instead of writing a broken schema into the package.
  JSON.parse(raw);

  let commit = { sha: "unknown", date: "unknown" };
  try {
    const [latest] = await fetchJson(COMMITS_URL);
    commit = { sha: latest.sha, date: latest.commit.committer.date };
  } catch (error) {
    console.warn(`Could not read upstream commit metadata: ${error.message}`);
  }

  const meta = {
    source: `https://github.com/${REPO}/blob/main/${SCHEMA_PATH}`,
    upstreamCommit: commit.sha,
    upstreamCommitDate: commit.date,
    license: "Apache-2.0",
    sha256: createHash("sha256").update(raw).digest("hex"),
    bytes: Buffer.byteLength(raw),
    updateWith: "pnpm schema:update",
  };

  await mkdir(schemaDir, { recursive: true });
  await writeFile(join(schemaDir, "compose-spec.json"), raw, "utf-8");
  await writeFile(
    join(schemaDir, "compose-spec.meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf-8",
  );

  console.log(
    `Updated compose-spec.json (${meta.bytes} bytes, upstream ${meta.upstreamCommit.slice(0, 12)} from ${meta.upstreamCommitDate})`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

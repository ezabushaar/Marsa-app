#!/usr/bin/env node
/**
 * Copies the wholesale portal's API contracts from Marsa ERP (`packages/contracts/src`) into `vendor/contracts`,
 * so the app calls the same routes, with the same zod schemas and types, as the web portal.
 *
 * Only the portal route modules, the typed client and the files they import are copied (the transitive closure),
 * never the staff-only routes. Run it after the ERP's portal contracts change, then typecheck:
 *
 *   node scripts/sync-contracts.mjs [path/to/marsa-erp]     # default: ../marsa-erp
 *   npx tsc --noEmit
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const erp = resolve(process.argv[2] ?? join(import.meta.dirname, "..", "..", "marsa-erp"));
const src = join(erp, "packages", "contracts", "src");
const out = join(import.meta.dirname, "..", "vendor", "contracts");

if (!existsSync(src)) {
  console.error(`No contracts at ${src}. Pass the marsa-erp checkout's path.`);
  process.exit(1);
}

const entries = [
  "client.ts",
  "http.ts",
  "portal.ts",
  "routes/portal/auth.ts",
  "routes/portal/shop.ts",
  "routes/portal/pay.ts",
  "routes/portal/account.ts",
  "routes/portal/history.ts",
  "routes/portal/team.ts",
];

const seen = new Set();
const queue = entries.map((e) => join(src, e));
while (queue.length) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  if (!existsSync(file)) throw new Error(`Missing ${relative(src, file)}`);
  seen.add(file);
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
    queue.push(resolve(dirname(file), m[1].replace(/\.js$/, ".ts")));
  }
}

rmSync(out, { recursive: true, force: true });
for (const file of [...seen].sort()) {
  const target = join(out, relative(src, file));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(file, target);
}

let rev = "unknown";
try {
  const head = readFileSync(join(erp, ".git", "HEAD"), "utf8").trim();
  rev = head.startsWith("ref: ") ? readFileSync(join(erp, ".git", head.slice(5)), "utf8").trim() : head;
} catch {}
writeFileSync(
  join(out, "SOURCE.md"),
  `Copied from marsa-erp \`packages/contracts/src\` at ${rev} by \`scripts/sync-contracts.mjs\`.\nDo not edit here: change the ERP, then sync again.\n`,
);
console.log(`Copied ${seen.size} contract files from ${rev.slice(0, 12)} into vendor/contracts.`);

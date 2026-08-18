import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const contracts = resolve(root, "deploy/qualification/contracts");
const expected = new Map(
  readFileSync(resolve(contracts, "CANONICAL-SHA256.txt"), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(/\s+/))
    .map(([hash, name]) => [name, hash])
);
for (const [name, hash] of expected) {
  const actual = createHash("sha256").update(readFileSync(resolve(contracts, name))).digest("hex");
  if (actual !== hash) throw new Error(`canonical contract hash mismatch: ${name}`);
}
console.log(`verified ${expected.size} canonical qualification contract hashes`);

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const value = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
};
const dir = resolve(value("--dir"));
const output = resolve(value("--output"));
const records = [
  ["amd64", value("--amd64-digest")],
  ["arm64", value("--arm64-digest")],
].map(([architecture, expectedDigest]) => {
  const path = resolve(dir, `runtime-smoke-${architecture}.json`);
  const contents = readFileSync(path, "utf8");
  const record = JSON.parse(contents);
  if (record.platform !== `linux/${architecture}` || record.digest !== expectedDigest || record.runtimeSmoke !== "pass") {
    throw new Error(`runtime smoke record does not prove ${architecture}`);
  }
  return { path: `runtime-smoke-${architecture}.json`, sha256: createHash("sha256").update(contents).digest("hex") };
});
writeFileSync(output, `${JSON.stringify({ records }, null, 2)}\n`);

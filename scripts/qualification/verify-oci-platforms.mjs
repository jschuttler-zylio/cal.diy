import { readFileSync } from "node:fs";

const requested = [];
for (let index = 2; index < process.argv.length; index += 1) {
  if (process.argv[index] !== "--platform" || !process.argv[index + 1]) {
    throw new Error(`unknown or incomplete argument: ${process.argv[index]}`);
  }
  requested.push(process.argv[index + 1]);
  index += 1;
}
if (requested.length === 0) throw new Error("at least one --platform is required");

let imageIndex;
try {
  imageIndex = JSON.parse(readFileSync(0, "utf8"));
} catch {
  throw new Error("stdin is not a valid OCI index");
}
if (!Array.isArray(imageIndex.manifests)) throw new Error("OCI index has no manifest descriptors");

for (const requestedPlatform of requested) {
  const [os, architecture, variant, ...extra] = requestedPlatform.split("/");
  if (!os || !architecture || extra.length > 0) throw new Error(`invalid platform: ${requestedPlatform}`);
  const found = imageIndex.manifests.some((manifest) =>
    manifest?.platform?.os === os &&
    manifest?.platform?.architecture === architecture &&
    (!variant || manifest?.platform?.variant === variant));
  if (!found) throw new Error(`OCI index does not contain ${requestedPlatform}`);
}

console.log(`verified OCI index platforms: ${requested.join(", ")}`);

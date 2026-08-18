import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");

test("remote Trivy outputs are retried, complete, and atomically published", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/zylio-qualification-image.yml"), "utf8");
  const scanStart = workflow.indexOf("- name: Scan the published digest without exposing the Docker socket");
  const sbomStart = workflow.indexOf("- name: Export a downloadable CycloneDX SBOM");
  const collectStart = workflow.indexOf("- name: Collect raw evidence before applying scan policy");

  assert.ok(scanStart >= 0 && sbomStart > scanStart && collectStart > sbomStart);
  const sections = [workflow.slice(scanStart, sbomStart), workflow.slice(sbomStart, collectStart)];
  for (const section of sections) {
    assert.equal((section.match(/while \[ "\$attempt" -le 3 \]; do/g) ?? []).length, 1);
    assert.match(section, /rm -f "\$final" "\$temp"/);
    assert.match(section, /test -s "\$temp"/);
    assert.match(section, /mv "\$temp" "\$final"/);
    assert.match(section, /if \[ "\$attempt" -eq 3 \]; then[\s\S]*?exit 1/);
    assert.match(section, /--timeout 20m/);
    assert.match(section, /--image-src remote/);
    assert.match(section, /\.tmp/);
    assert.doesNotMatch(section, /\|\| true/);
  }
});

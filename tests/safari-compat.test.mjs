import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(
  await readFile(new URL("../manifest.safari.json", import.meta.url), "utf8")
);

test("Safari manifest removes Chrome-only side panel declarations", () => {
  assert.equal(manifest.side_panel, undefined);
  assert.equal(manifest.permissions.includes("sidePanel"), false);
  assert.equal(manifest.minimum_chrome_version, undefined);
  assert.equal(manifest.action.default_popup, undefined);
});

test("Safari manifest keeps the extension's required execution worlds", () => {
  const worlds = manifest.content_scripts.map((script) => script.world);
  assert.deepEqual(worlds, ["MAIN", "MAIN", "ISOLATED"]);
});

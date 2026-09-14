import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "build", "safari-extension");
const manifest = path.join(root, "manifest.safari.json");

if (!output.startsWith(`${root}${path.sep}`)) {
  throw new Error("Safari 构建目录必须位于项目内");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await Promise.all(
  ["background", "content", "icons", "sidepanel"].map((dir) =>
    cp(path.join(root, dir), path.join(output, dir), { recursive: true })
  )
);
await writeFile(path.join(output, "manifest.json"), await readFile(manifest));

console.log(output);

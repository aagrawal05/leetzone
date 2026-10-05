#!/usr/bin/env node
// Builds the Chrome Web Store upload: dist/leetzone-<version>.zip.
//
// extension/ stays the development copy, loadable unpacked against
// localhost:8787 with a stable id. The store build differs in two ways:
// - no "key": the store assigns the id itself and refuses a manifest with one;
// - no localhost origins: a published extension talks to production only.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = join(root, "extension");
const dist = join(root, "dist");
const out = join(dist, "extension");

const isDev = (pattern) => /^https?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(pattern);

const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
delete manifest.key;
manifest.host_permissions = manifest.host_permissions.filter((p) => !isDev(p));
for (const script of manifest.content_scripts) script.matches = script.matches.filter((p) => !isDev(p));

const problems = [];
if (manifest.manifest_version !== 3) problems.push("manifest_version must be 3");
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) problems.push(`bad version "${manifest.version}"`);
if (manifest.description.length > 132) problems.push("description is over 132 characters");
if (manifest.content_scripts.some((s) => s.matches.length === 0)) problems.push("a content script has no matches left");
if (JSON.stringify(manifest).match(/localhost|127\.0\.0\.1/)) problems.push("a development origin is still in the manifest");
for (const [size, file] of Object.entries(manifest.icons)) {
  const png = readFileSync(join(source, file));
  const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  if (w !== Number(size) || h !== Number(size)) problems.push(`${file} is ${w}x${h}, not ${size}x${size}`);
}
if (problems.length) {
  console.error("pack-extension: " + problems.join("; "));
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(source, out, { recursive: true, filter: (path) => !/(^|\/)\./.test(path.slice(source.length)) });
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const zip = join(dist, `leetzone-${manifest.version}.zip`);
if (existsSync(zip)) rmSync(zip);
execFileSync("zip", ["-qrX", zip, "."], { cwd: out });
console.log(`pack-extension: ${zip}`);

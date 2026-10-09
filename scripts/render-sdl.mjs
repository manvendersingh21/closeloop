#!/usr/bin/env node
// Fill <PLACEHOLDER> tokens in an Akash SDL template from .env (or the process env).
// Usage: node scripts/render-sdl.mjs <template> [output-path-or-dir]   (default dir: /tmp)
// Refuses to write inside the repo. Prints only the output path and placeholder NAMES.
import { readFileSync, writeFileSync, existsSync, statSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [templateArg, outArg = "/tmp"] = process.argv.slice(2);
if (!templateArg) {
  console.error("usage: node scripts/render-sdl.mjs <template.sdl.yaml> [output path or dir, default /tmp]");
  process.exit(2);
}

const envFile = path.join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const template = path.resolve(templateArg);
let out = path.resolve(outArg);
if (existsSync(out) && statSync(out).isDirectory()) out = path.join(out, path.basename(template));

// Resolve symlinks (e.g. /tmp -> /private/tmp) on the nearest existing ancestor before the inside-repo check.
const real = (p) => {
  let dir = p;
  const rest = [];
  while (!existsSync(dir)) {
    rest.unshift(path.basename(dir));
    dir = path.dirname(dir);
  }
  return path.join(realpathSync(dir), ...rest);
};
const rel = path.relative(realpathSync(repoRoot), real(out));
if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
  console.error(`refusing to write inside the repo: ${out}`);
  process.exit(1);
}

const filled = new Set();
const missing = new Set();
// Inside a double-quoted YAML scalar, escape the value so "#", ":", quotes or backslashes cannot break the SDL.
const fillLine = (line) => {
  const quoted = /^\s*-?\s*"/.test(line);
  return line.replace(/<([A-Z][A-Z0-9_]*)>/g, (m, name) => {
    const v = process.env[name];
    if (v === undefined || v === "") {
      missing.add(name);
      return m;
    }
    filled.add(name);
    return quoted ? JSON.stringify(v).slice(1, -1) : v;
  });
};
const rendered = readFileSync(template, "utf8").split("\n").map(fillLine).join("\n");

writeFileSync(out, rendered, { mode: 0o600 });
console.log(`wrote ${out}`);
console.log(`filled (${filled.size}): ${[...filled].join(", ") || "-"}`);
console.log(`missing (${missing.size}): ${[...missing].join(", ") || "-"}`);
if (missing.size) process.exitCode = 3;

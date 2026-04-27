/**
 * build-cli.js — Post-process CLI binary after cargo build.
 *
 * Renames `workerbee-cli.exe` → `workerbee.exe` and copies it to
 * a convenient location for PATH access.
 */

const fs = require("fs");
const path = require("path");

const targetDir = path.join(__dirname, "..", "src-tauri", "target", "release");
const srcName = "workerbee-cli.exe";
const dstName = "workerbee.exe";

const src = path.join(targetDir, srcName);

if (!fs.existsSync(src)) {
  console.error(`Error: ${src} not found. Run 'cargo build --release --bin workerbee-cli' first.`);
  process.exit(1);
}

// Copy to project root as workerbee.exe for easy access
const dst = path.join(__dirname, "..", dstName);
fs.copyFileSync(src, dst);

const stats = fs.statSync(dst);
console.log(`✓ ${dstName} (${(stats.size / 1024 / 1024).toFixed(1)} MB) → ${dst}`);

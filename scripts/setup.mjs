#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function exists(path) {
  try { lstatSync(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
function setValue(contents, name, value) {
  const withoutExisting = contents.replace(new RegExp(`^${name}=.*(?:\\n|$)`, "gm"), "").trimEnd();
  return `${withoutExisting}\n${name}=${value}\n`;
}

try {
  if (process.argv.length > 2) throw new Error("unsupported_arguments");
  const destination = resolve(process.cwd(), ".env.local");
  if (exists(destination)) {
    console.log("Existing .env.local preserved. No values were changed.");
  } else {
    let contents = readFileSync(resolve(process.cwd(), ".env.example"), "utf8").replaceAll("\r\n", "\n");
    contents = setValue(contents, "OVERSKILL_MOCK", "1");
    contents = setValue(contents, "OVERSKILL_LIVE_ENABLED", "0");
    contents = setValue(contents, "OPEN_OVERSKILL_OPERATOR_TOKEN", randomBytes(32).toString("hex"));
    try {
      // Exclusive creation also protects against concurrent setup runs and symlinks.
      writeFileSync(destination, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
      console.log("Created .env.local for demo mode with a private local operator token.");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      console.log("Existing .env.local preserved. No values were changed.");
    }
  }
  console.log("Next: npm run doctor. Shell variables and more-specific Next environment files can override .env.local.");
} catch {
  console.error("Setup could not create .env.local. Run from the project directory, check .env.example and file permissions, and pass no arguments. No existing file was overwritten.");
  process.exitCode = 1;
}

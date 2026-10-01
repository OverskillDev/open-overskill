import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

// Reuse the actual server guard without importing routes, loading Next, writing
// compiled artifacts, or changing a running server. TypeScript is already a
// development dependency; setup and doctor are developer commands after npm ci.
export function loadPilotRules(env) {
  const filename = fileURLToPath(new URL("../lib/pilot-security.ts", import.meta.url));
  const source = readFileSync(filename, "utf8");
  const compiled = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  const require = createRequire(import.meta.url);
  vm.runInNewContext(compiled, {
    module, exports: module.exports, process: { env }, URL, Buffer,
    require(name) {
      if (name !== "node:crypto") throw new Error("Unexpected server guard dependency");
      return require(name);
    },
  }, { filename, timeout: 1_000 });
  return module.exports;
}

// Only the pure customer configuration module is evaluated. Importing the
// customer auth/store modules here could discover a provider or initialize disk.
export function loadCustomerRules(env, pilotRules = loadPilotRules(env)) {
  const filename = fileURLToPath(new URL("../lib/customer-configuration.ts", import.meta.url));
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, process: { env }, URL, Buffer,
    require(name) {
      if (name !== "./pilot-security") throw new Error("Unexpected customer configuration dependency");
      return pilotRules;
    },
  }, { filename, timeout: 1_000 });
  return module.exports;
}

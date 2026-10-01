#!/usr/bin/env node
// Read-only diagnostics. Never log environment values or raw loader errors.
try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--production") || args.length > 1) throw new Error("unsupported_arguments");
  const { default: nextEnv } = await import("@next/env");
  const { loadPilotRules } = await import("./load-pilot-rules.mjs");
  if (args.includes("--production")) process.env.NODE_ENV = "production";
  else process.env.NODE_ENV ||= "development";
  if (!["development", "production", "test"].includes(process.env.NODE_ENV)) throw new Error("invalid_node_env");
  let environmentLoadFailed = false;
  const { combinedEnv } = nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development", {
    info() {}, error() { environmentLoadFailed = true; },
  }, true);
  if (environmentLoadFailed) throw new Error("environment_load_failed");
  const rules = loadPilotRules(combinedEnv);
  const demo = rules.isDemoMode(combinedEnv);
  const missing = [];
  const invalid = [];
  const hints = [];
  const rawMode = (combinedEnv.OVERSKILL_MOCK || "1").toLowerCase();
  if (!["0", "false", "1", "true", "auto"].includes(rawMode)) invalid.push("OVERSKILL_MOCK");
  let guardReady = true;
  try { rules.requireLiveConfiguration(combinedEnv); }
  catch { guardReady = false; }
  if (!demo) {
    // Probe each field against the same server guard and a valid baseline. This
    // keeps its token-length, explicit opt-in and URL rules authoritative.
    const validBaseline = {
      OVERSKILL_MOCK: "0", OVERSKILL_LIVE_ENABLED: "1",
      OVERSKILL_PARTNER_API_KEY: "diagnostic-placeholder",
      OPEN_OVERSKILL_OPERATOR_TOKEN: "0".repeat(64),
      OVERSKILL_API_BASE: "https://www.overskill.com",
    };
    for (const name of ["OVERSKILL_LIVE_ENABLED", "OVERSKILL_PARTNER_API_KEY", "OPEN_OVERSKILL_OPERATOR_TOKEN", "OVERSKILL_API_BASE"]) {
      try { rules.requireLiveConfiguration({ ...validBaseline, [name]: combinedEnv[name] }); }
      catch { (combinedEnv[name] ? invalid : missing).push(name); }
    }
    const email = combinedEnv.OPEN_OVERSKILL_CREATOR_EMAIL;
    try {
      const value = rules.inputString(email, "creator email", 254);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("invalid_email");
    } catch { (email ? invalid : missing).push("OPEN_OVERSKILL_CREATOR_EMAIL"); }
    try { rules.requireExternalCreatorId(combinedEnv); }
    catch { (combinedEnv.OVERSKILL_CREATOR_ID ? invalid : missing).push("OVERSKILL_CREATOR_ID"); }
    if (!combinedEnv.OVERSKILL_API_BASE) hints.push("OVERSKILL_API_BASE is unset; the server defaults to its local development API.");
    hints.push("Live settings only: credential validity, scopes, reachability, creator identity backend support, credits and approved embed origins were not checked.");
  } else {
    hints.push("Demo mode requires no partner key and makes no paid API calls.");
    if (rawMode === "auto") hints.push("OVERSKILL_MOCK=auto stays in demo mode; it does not enable live calls.");
  }
  if (!guardReady && !missing.length && !invalid.length) invalid.push("live_configuration");
  if (invalid.includes("OVERSKILL_MOCK")) hints.push("Use OVERSKILL_MOCK=1 for demo or OVERSKILL_MOCK=0 for deliberate live setup.");
  hints.push("Next environment precedence is applied, including shell overrides. No network, provisioning or file writes were performed.");
  const ready = guardReady && missing.length === 0 && invalid.length === 0;
  console.log(JSON.stringify({ ready, demo, environment: process.env.NODE_ENV, missing, invalid, hints }, null, 2));
  if (!ready) process.exitCode = 1;
} catch {
  console.log(JSON.stringify({
    ready: false, missing: [], invalid: ["doctor_environment"],
    hints: ["Run npm ci from the project first. Use npm run doctor or npm run doctor -- --production. Check NODE_ENV and environment-file readability. No configuration values were printed."],
  }, null, 2));
  process.exitCode = 1;
}

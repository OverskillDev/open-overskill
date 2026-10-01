#!/usr/bin/env node
// Read-only diagnostics. Never log environment values or raw loader errors.
try {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--production", "--customer"].includes(arg)) || new Set(args).size !== args.length) throw new Error("unsupported_arguments");
  const customerCheck = args.includes("--customer");
  const { default: nextEnv } = await import("@next/env");
  const { loadPilotRules, loadCustomerRules } = await import("./load-pilot-rules.mjs");
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
    if (!customerCheck) {
      const email = combinedEnv.OPEN_OVERSKILL_CREATOR_EMAIL;
      try {
        const value = rules.inputString(email, "creator email", 254);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("invalid_email");
      } catch { (email ? invalid : missing).push("OPEN_OVERSKILL_CREATOR_EMAIL"); }
      try { rules.requireExternalCreatorId(combinedEnv); }
      catch { (combinedEnv.OVERSKILL_CREATOR_ID ? invalid : missing).push("OVERSKILL_CREATOR_ID"); }
    }
    if (!combinedEnv.OVERSKILL_API_BASE) hints.push("OVERSKILL_API_BASE is unset; the server defaults to its local development API.");
    hints.push("Live settings only: credential validity, scopes, reachability, creator identity backend support, credits and approved embed origins were not checked.");
  } else {
    hints.push("Demo mode requires no partner key and makes no paid API calls.");
    if (rawMode === "auto") hints.push("OVERSKILL_MOCK=auto stays in demo mode; it does not enable live calls.");
  }
  if (customerCheck) {
    const customer = loadCustomerRules(combinedEnv, rules);
    const { isBuiltin } = await import("node:module");
    const { isAbsolute, resolve, join } = await import("node:path");
    const { lstatSync, accessSync, constants } = await import("node:fs");
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (!(major > 22 || (major === 22 && minor >= 23)) || !isBuiltin("node:sqlite")) {
      invalid.push("node_sqlite_runtime");
      hints.push("Customer storage requires Node 22.23 or newer with the node:sqlite built-in. No SQLite database was opened.");
    }
    const rawOrigin = combinedEnv.OPEN_OVERSKILL_ORIGIN;
    if (!demo && !combinedEnv.OVERSKILL_API_BASE) missing.push("OVERSKILL_API_BASE");
    if (!demo && !rawOrigin) missing.push("OPEN_OVERSKILL_ORIGIN");
    try {
      // Probe origin syntax separately from hosted opt-in so both problems can
      // be reported by field name, using the same runtime origin validator.
      const origin = customer.customerOrigin({ ...combinedEnv, OPEN_OVERSKILL_HOSTED: "1" });
      if (rawOrigin && (rawOrigin !== rawOrigin.trim() || /[\u0000-\u001f\u007f]/.test(rawOrigin))) throw new Error("invalid_origin");
      if (!rules.isLoopback(origin.hostname) && combinedEnv.OPEN_OVERSKILL_HOSTED !== "1") {
        (combinedEnv.OPEN_OVERSKILL_HOSTED ? invalid : missing).push("OPEN_OVERSKILL_HOSTED");
      }
    } catch { invalid.push("OPEN_OVERSKILL_ORIGIN"); }
    if (demo) hints.push("Customer demo requires a loopback origin; public hosting cannot use simulated identities.");
    else {
      const oidcBaseline = {
        OVERSKILL_MOCK: "0", OPEN_OVERSKILL_OIDC_ISSUER: "https://issuer.example.invalid",
        OPEN_OVERSKILL_OIDC_CLIENT_ID: "diagnostic-client", OPEN_OVERSKILL_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
      };
      for (const name of ["OPEN_OVERSKILL_OIDC_ISSUER", "OPEN_OVERSKILL_OIDC_CLIENT_ID"]) {
        const value = combinedEnv[name];
        try {
          if (value && (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value))) throw new Error("invalid_oidc_setting");
          customer.customerOidcSettings({ ...oidcBaseline, [name]: value });
        } catch { (value ? invalid : missing).push(name); }
      }
      if (!combinedEnv.OPEN_OVERSKILL_ENCRYPTION_KEY) missing.push("OPEN_OVERSKILL_ENCRYPTION_KEY");
      if (!combinedEnv.OPEN_OVERSKILL_DATA_DIR) missing.push("OPEN_OVERSKILL_DATA_DIR");
    }
    if (combinedEnv.OPEN_OVERSKILL_ENCRYPTION_KEY) {
      try { customer.parseCustomerEncryptionKey(combinedEnv.OPEN_OVERSKILL_ENCRYPTION_KEY); }
      catch { invalid.push("OPEN_OVERSKILL_ENCRYPTION_KEY"); }
    }
    const dataDirectory = combinedEnv.OPEN_OVERSKILL_DATA_DIR || resolve(process.cwd(), ".data");
    try {
      if (!isAbsolute(dataDirectory)) throw new Error("invalid_directory");
      let info;
      try { info = lstatSync(dataDirectory); }
      catch (error) { if (error.code !== "ENOENT" || !demo) throw error; }
      if (info) {
        if (info.isSymbolicLink() || !info.isDirectory() || (info.mode & 0o077) !== 0) throw new Error("unsafe_directory");
        accessSync(dataDirectory, constants.R_OK | constants.W_OK | constants.X_OK);
        let database;
        const filename = join(dataDirectory, `customers-${demo ? "demo" : "live"}.sqlite`);
        try { database = lstatSync(filename); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        if (database) {
          if (database.isSymbolicLink() || !database.isFile() || (database.mode & 0o077) !== 0) throw new Error("unsafe_database");
          accessSync(filename, constants.R_OK | constants.W_OK);
        }
      } else hints.push("The demo data directory does not exist yet. Doctor did not create it or verify future writes.");
    } catch {
      if (!missing.includes("OPEN_OVERSKILL_DATA_DIR")) invalid.push("OPEN_OVERSKILL_DATA_DIR");
      hints.push("Use an existing private writable data directory for live customers: absolute path, directory mode 0700, private regular database file, and no directory/database symlink. Doctor never creates or changes these files.");
    }
    hints.push("Customer configuration only: live mode requires an explicit origin and existing private data directory; legacy creator email/ID fixtures are not required.");
    hints.push("OIDC provider registration, callback/scopes, issuer ownership, client-secret requirements and real sign-in were not checked. Only the configured encryption key's encoding/length is checked, not entropy, key custody, demo key files or stored credential decryption.");
    hints.push("Directory metadata is checked as the current OS user; durable volumes, backups, database integrity, deployed core capabilities, approved customer access, funding/caps, payments and merchant/publication gates were not checked.");
  }
  if (!guardReady && !missing.length && !invalid.length) invalid.push("live_configuration");
  if (invalid.includes("OVERSKILL_MOCK")) hints.push("Use OVERSKILL_MOCK=1 for demo or OVERSKILL_MOCK=0 for deliberate live setup.");
  hints.push("Next environment precedence is applied, including shell overrides. No network, provisioning or file writes were performed.");
  const ready = guardReady && missing.length === 0 && invalid.length === 0;
  console.log(JSON.stringify({ ready, demo, environment: process.env.NODE_ENV, ...(customerCheck ? { target: "customer" } : {}), missing, invalid, hints }, null, 2));
  if (!ready) process.exitCode = 1;
} catch {
  console.log(JSON.stringify({
    ready: false, missing: [], invalid: ["doctor_environment"],
    hints: ["Run npm ci from the project first. Use npm run doctor, optionally with --customer and/or --production after --. Check NODE_ENV and environment-file readability. No configuration values were printed."],
  }, null, 2));
  process.exitCode = 1;
}

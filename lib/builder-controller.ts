import type { Creator } from "./creator-context";
import { hasUsableCreditSnapshot, type CreditAccountSnapshot } from "./credit-account";
import type { ChatMessage, StatusResponse } from "./types";
import type { BuilderClient, BuilderConfig, RequestOptions } from "./builder-client";

export interface BuilderState {
  config: BuilderConfig | null;
  creator: Creator | null;
  brief: string;
  suggestions: string[];
  ready: boolean;
  locked: boolean;
  unlocking: boolean;
  error: string;
  prompt: string;
  submitted: string;
  busy: boolean;
  stage: string;
  provisioned: boolean;
  needsKeyRecovery: boolean;
  recoveringKey: boolean;
  creditAccount: CreditAccountSnapshot | null;
  creditAccountLoading: boolean;
  creditAccountBlocked: boolean;
  creditAccountError: string;
  status: StatusResponse | null;
  appId: string | null;
  messages: ChatMessage[];
  deploying: boolean;
  deployState: "idle" | "queued" | "demo";
  publishedUrl: string | null;
}
export interface BuilderControllerOptions { pollIntervalMs?: number; pollTimeoutMs?: number }
const initialState = (): BuilderState => ({
  config: null, creator: null, brief: "", suggestions: [], ready: false, locked: false,
  unlocking: false, error: "", prompt: "", submitted: "", busy: false,
  stage: "Ready when you are", provisioned: false, status: null, appId: null,
  needsKeyRecovery: false, recoveringKey: false, creditAccount: null, creditAccountLoading: false, creditAccountBlocked: false, creditAccountError: "",
  messages: [], deploying: false, deployState: "idle", publishedUrl: null,
});
const emptyWorkspace = {
  provisioned: false, appId: null, status: null, messages: [], publishedUrl: null,
  deployState: "idle", busy: false, deploying: false, submitted: "",
  needsKeyRecovery: false, recoveringKey: false, creditAccount: null, creditAccountLoading: false, creditAccountBlocked: false, creditAccountError: "",
} as const;

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return; }
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/** Browser state controller. Credentials and app authorization stay on your server. */
export function createBuilderController(client: BuilderClient, { pollIntervalMs = 1500, pollTimeoutMs = 30 * 60 * 1000 }: BuilderControllerOptions = {}) {
  let state = initialState();
  let active = false;
  let epoch = 0;
  const listeners = new Set<() => void>();
  const requests = new Set<AbortController>();
  const current = (run: number) => active && epoch === run;
  function update(patch: Partial<BuilderState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }
  function invalidate() {
    epoch += 1;
    requests.forEach((request) => request.abort());
    requests.clear();
  }
  async function task(operation: (run: number, options: RequestOptions & { signal: AbortSignal }) => Promise<void>) {
    if (!active) return;
    const run = epoch;
    const request = new AbortController();
    requests.add(request);
    try { await operation(run, { signal: request.signal }); }
    catch {
      // A custom transport may throw. Do not echo exception text or credentials.
      if (current(run)) update({ error: "The request may have reached the server. Check its state before retrying.", busy: false, deploying: false, unlocking: false, recoveringKey: false });
    } finally { requests.delete(request); }
  }
  async function authenticate(run: number, options: RequestOptions) {
    const result = await client.authenticate(options);
    if (!current(run)) return;
    update({ ready: result.ok && result.json.authenticated, locked: result.status === 401,
      ...(!result.ok && result.status !== 401 ? { error: result.json.error || "Could not initialize the builder." } : {}),
    });
  }
  function resetExpiredSession() {
    invalidate();
    update({ ...emptyWorkspace, messages: [], ready: false, unlocking: false, stage: "Session ended" });
    if (state.config?.mock) {
      update({ error: "The demo session ended. Reconnecting; submit your prompt again." });
      void task(authenticate);
    } else update({ locked: true, error: "Your local session ended. Unlock the builder to continue." });
  }
  async function readCreditAccount(run: number, options: RequestOptions) {
    update({ creditAccountLoading: true, creditAccountError: "" });
    try {
      const result = await client.creditAccount(options);
      if (!current(run)) return false;
      if (result.status === 401) { resetExpiredSession(); return false; }
      const usable = result.ok && hasUsableCreditSnapshot(result.json);
      update({ ...(!usable ? { stage: "Builds paused: usage unavailable" } : {}), creditAccountLoading: false, creditAccountBlocked: !usable, creditAccount: result.ok ? result.json : null,
        creditAccountError: result.ok ? "" : "Credit information is unavailable. Builds are paused until a successful refresh. This does not mean the balance is zero.",
      });
      return usable;
    } catch {
      if (current(run)) update({ stage: "Builds paused: usage unavailable", creditAccountLoading: false, creditAccountBlocked: true, creditAccount: null,
        creditAccountError: "Credit information is unavailable. Builds are paused until a successful refresh. This does not mean the balance is zero.",
      });
    }
    return false;
  }

  return {
    getSnapshot: (): Readonly<BuilderState> => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start() {
      if (active) return;
      active = true;
      invalidate();
      void task(async (run, options) => {
        const [config, context] = await Promise.all([client.config(options), client.creator(options)]);
        if (!current(run)) return;
        if (!config.ok || !context.ok) {
          update({ error: "Could not load the builder. Check the local server and reload." });
          return;
        }
        update({ config: config.json, creator: context.json.creator, brief: context.json.contextMarkdown, suggestions: context.json.suggestions });
        await authenticate(run, options);
      });
    },
    stop() { active = false; invalidate(); },
    setPrompt(prompt: string) { update({ prompt }); },
    async refreshCreditAccount() {
      if (!active || !state.ready || !state.provisioned || state.needsKeyRecovery || state.recoveringKey || state.creditAccountLoading || state.busy) return;
      const wasBlocked = state.creditAccountBlocked;
      await task(async (run, options) => {
        if (await readCreditAccount(run, options) && current(run) && wasBlocked) update({ error: "", stage: "Usage is available. Submit your prompt to build." });
      });
    },
    async recoverCreatorKey() {
      if (!active || !state.ready || !state.needsKeyRecovery || state.recoveringKey || state.busy || state.deploying) return;
      invalidate();
      update({ recoveringKey: true, error: "", creditAccount: null, creditAccountError: "" });
      await task(async (run, options) => {
        const result = await client.recoverCreatorKey(options);
        if (!current(run)) return;
        update({ recoveringKey: false });
        if (!result.ok) {
          if (result.status === 401) { resetExpiredSession(); return; }
          const message = result.json.error || "Creator access could not be recovered.";
          update({ error: result.status === 409
            ? `${message} Reconcile the stored creator credentials before retrying. Lock and unlock this pilot to reload the binding, then recover explicitly if needed.`
            : message });
          return;
        }
        if (result.json.recoveryRequired) {
          update({ error: "Creator access still requires recovery. Check its state before requesting another replacement." });
          return;
        }
        update({ provisioned: true, needsKeyRecovery: false, stage: "Creator access restored. Submit your prompt to build." });
        await readCreditAccount(run, options);
      });
    },
    async unlock(token: string) {
      if (!active || state.unlocking) return;
      invalidate();
      update({ ...emptyWorkspace, messages: [], ready: false, unlocking: true, error: "" });
      await task(async (run, options) => {
        const result = await client.unlock(token, options);
        if (!current(run)) return;
        update({ unlocking: false });
        if (!result.ok) { update({ error: result.json.error || "Could not unlock this pilot." }); return; }
        await authenticate(run, options);
      });
    },
    async lock() {
      if (!active) return;
      invalidate();
      update({ ...emptyWorkspace, messages: [], ready: false, locked: false, unlocking: false, prompt: "", error: "" });
      await task(async (run, options) => {
        const result = await client.lock(options);
        if (!current(run)) return;
        update({ locked: true });
        if (!result.ok) update({ error: result.json.error || "Could not lock the session." });
      });
    },
    async build() {
      if (!active || !state.ready || state.busy || state.deploying || state.needsKeyRecovery || state.recoveringKey || state.creditAccountBlocked || state.creditAccountLoading || !state.prompt.trim()) return;
      const prompt = state.prompt.trim();
      const appId = state.appId;
      invalidate();
      update({ busy: true, error: "", submitted: prompt, stage: "Preparing your workspace", deployState: "idle", publishedUrl: null });
      await task(async (run, options) => {
        if (!state.provisioned) {
          const provision = await client.provision(options);
          if (!current(run)) return;
          if (!provision.ok) {
            if (provision.status === 401) { resetExpiredSession(); return; }
            update({ error: provision.json.error || "Workspace setup failed.", busy: false });
            return;
          }
          update({ provisioned: true });
          if (provision.json.recoveryRequired) {
            update({ needsKeyRecovery: true, busy: false, stage: "Recover creator access to continue" });
            return;
          }
        }
        update({ stage: "Checking the creator credit account" });
        const verifiedAccount = await readCreditAccount(run, options);
        if (!current(run)) return;
        if (!verifiedAccount) {
          update({ busy: false, stage: "Builds paused: usage unavailable", error: "The creator credit account could not be verified. No build was requested." });
          return;
        }
        update({ stage: "Starting your build", messages: [] });
        const generated = await client.generate({ prompt, ...(appId ? { appId } : {}), creditResponsibility: "creator_workspace" }, options);
        if (!current(run)) return;
        if (!generated.ok) {
          if (generated.status === 401) { resetExpiredSession(); return; }
          update({ error: generated.json.error || "The build could not start.", busy: false,
            ...(generated.json.code === "credit_usage_unavailable" ? { creditAccountBlocked: true, creditAccount: null } : {}),
          });
          return;
        }
        const id = generated.json.job_id || (generated.json.message_id ? String(generated.json.message_id) : "");
        if (!generated.json.app_id || !id) {
          update({ error: "The server did not return a usable app and job identifier.", busy: false });
          return;
        }
        update({ appId: generated.json.app_id, prompt: "", status: null });
        let failures = 0;
        const deadline = Date.now() + pollTimeoutMs;
        while (current(run) && Date.now() < deadline) {
          const [status, messages] = await Promise.all([client.status(id, options), client.messages(id, options)]);
          if (!current(run)) return;
          if (status.status === 401 || messages.status === 401) { resetExpiredSession(); return; }
          if (!status.ok) {
            failures += 1;
            if (failures >= 3 || status.status === 403) {
              update({ error: status.json.error || "Could not read build progress. The server build may still be running.", busy: false });
              return;
            }
          } else {
            failures = 0;
            update({ status: status.json, stage: status.json.message || status.json.status,
              ...(messages.ok && Array.isArray(messages.json.messages) ? { messages: messages.json.messages } : {}),
            });
            if (status.json.status === "completed") {
              update({ busy: false, stage: state.config?.mock ? "Demo preview ready" : "Preview ready" });
              await readCreditAccount(run, options);
              return;
            }
            if (["failed", "cancelled"].includes(status.json.status)) {
              update({ busy: false, error: status.json.message || "The build stopped." });
              await readCreditAccount(run, options);
              return;
            }
          }
          await pause(Math.max(1, pollIntervalMs), options.signal);
        }
        if (current(run)) update({ busy: false, error: "Progress tracking timed out. The build may still be running on Overskill." });
      });
    },
    async deploy() {
      if (!active || !state.ready || !state.appId || state.status?.status !== "completed" || state.busy || state.deploying || state.deployState !== "idle") return;
      const appId = state.appId;
      update({ deploying: true, error: "" });
      await task(async (run, options) => {
        const result = await client.deploy(appId, options);
        if (!current(run)) return;
        update({ deploying: false });
        if (!result.ok) {
          if (result.status === 401) { resetExpiredSession(); return; }
          update({ error: result.json.error || "Deployment could not be requested." });
          return;
        }
        update({ publishedUrl: result.json.production_url || null, deployState: state.config?.mock ? "demo" : "queued" });
      });
    },
  };
}
export type BuilderController = ReturnType<typeof createBuilderController>;

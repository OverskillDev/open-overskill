import type { Creator } from "./creator-context";
import type { CreditAccountSnapshot } from "./credit-account";
import type { ChatMessage, DeployResponse, GenerateResponse, ProvisionResponse, StatusResponse } from "./types";

export interface BuilderConfig {
  mock: boolean;
  hasKey: boolean;
  partnerSlug: string;
}
export interface CreatorContext {
  creator: Creator;
  contextMarkdown: string;
  suggestions: string[];
}
export interface BuilderApiError { error: string; code?: string }
export type BuilderApiResult<T> =
  | { ok: true; status: number; json: T }
  | { ok: false; status: number; json: BuilderApiError };
export interface RequestOptions { signal?: AbortSignal }
export interface BuilderClient {
  config(options?: RequestOptions): Promise<BuilderApiResult<BuilderConfig>>;
  creator(options?: RequestOptions): Promise<BuilderApiResult<CreatorContext>>;
  authenticate(options?: RequestOptions): Promise<BuilderApiResult<{ authenticated: boolean }>>;
  unlock(token: string, options?: RequestOptions): Promise<BuilderApiResult<{ authenticated: boolean }>>;
  lock(options?: RequestOptions): Promise<BuilderApiResult<{ authenticated: boolean }>>;
  provision(options?: RequestOptions): Promise<BuilderApiResult<ProvisionResponse>>;
  recoverCreatorKey(options?: RequestOptions): Promise<BuilderApiResult<ProvisionResponse>>;
  creditAccount(options?: RequestOptions): Promise<BuilderApiResult<CreditAccountSnapshot>>;
  generate(input: { prompt: string; appId?: string; creditResponsibility?: "creator_workspace" }, options?: RequestOptions): Promise<BuilderApiResult<GenerateResponse>>;
  status(id: string, options?: RequestOptions): Promise<BuilderApiResult<StatusResponse>>;
  messages(id: string, options?: RequestOptions): Promise<BuilderApiResult<{ messages: ChatMessage[] }>>;
  deploy(appId: string, options?: RequestOptions): Promise<BuilderApiResult<DeployResponse>>;
}
export interface BuilderClientOptions {
  /** A same-origin path to your authenticated adapter. Never a remote API URL. */
  basePath?: string;
  /** Optional same-origin browser transport, useful for controlled test fixtures. */
  fetch?: typeof globalThis.fetch;
}

export function createBuilderClient({ basePath = "/api", fetch: fetcher = globalThis.fetch }: BuilderClientOptions = {}): BuilderClient {
  if (!/^\/(?![\/\\])[^?#\\\s]*$/.test(basePath)) {
    throw new Error("Builder API basePath must be a same-origin absolute path.");
  }
  const base = basePath.replace(/\/+$/, "");
  async function request<T>(path: string, method: string, body: unknown, options?: RequestOptions): Promise<BuilderApiResult<T>> {
    const mutation = method !== "GET" && method !== "HEAD";
    const uncertain = (message: string) => mutation
      ? `${message} The request may have reached the server. Check its state before retrying.`
      : message;
    try {
      const response = await fetcher(`${base}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store", credentials: "same-origin", redirect: "error",
        signal: options?.signal,
      });
      let json: unknown;
      try { json = await response.json(); }
      catch { return { ok: false, status: 502, json: { error: uncertain("The server returned an unreadable response."), code: "invalid_response" } }; }
      if (!json || typeof json !== "object" || Array.isArray(json)) {
        return { ok: false, status: 502, json: { error: uncertain("The server returned an unreadable response."), code: "invalid_response" } };
      }
      if (response.ok) return { ok: true, status: response.status, json: json as T };
      const error = json as Record<string, unknown>;
      const message = typeof error.error === "string" ? error.error : "The server could not complete this request.";
      return { ok: false, status: response.status, json: {
        error: response.status >= 500 || response.status === 408 ? uncertain(message) : message,
        ...(typeof error.code === "string" ? { code: error.code } : {}),
      } };
    } catch {
      return { ok: false, status: 0, json: {
        error: uncertain(options?.signal?.aborted ? "Request stopped." : "Connection lost. Check the local server connection."),
        code: options?.signal?.aborted ? "request_aborted" : "network_error",
      } };
    }
  }
  return {
    config: (options) => request("/config", "GET", undefined, options),
    creator: (options) => request("/creator", "GET", undefined, options),
    authenticate: (options) => request("/auth", "GET", undefined, options),
    unlock: (token, options) => request("/session", "POST", { token }, options),
    lock: (options) => request("/session", "DELETE", undefined, options),
    provision: (options) => request("/provision", "POST", {}, options),
    recoverCreatorKey: (options) => request("/creator/recover", "POST", {}, options),
    creditAccount: (options) => request("/credit-account", "GET", undefined, options),
    generate: (input, options) => request("/generate", "POST", input, options),
    status: (id, options) => request(`/status?id=${encodeURIComponent(id)}`, "GET", undefined, options),
    messages: (id, options) => request(`/messages?id=${encodeURIComponent(id)}`, "GET", undefined, options),
    deploy: (appId, options) => request("/deploy", "POST", { appId }, options),
  };
}

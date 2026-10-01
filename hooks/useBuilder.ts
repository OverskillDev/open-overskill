"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { createBuilderClient, type BuilderClient } from "@/lib/builder-client";
import { createBuilderController, type BuilderControllerOptions } from "@/lib/builder-controller";

export interface UseBuilderOptions extends BuilderControllerOptions {
  /** Same-origin adapter path; defaults to /api. Never put a provider URL here. */
  basePath?: string;
  /** Keep a custom typed client stable across renders (for example, useMemo). */
  client?: BuilderClient;
}

/** Compose your own UI while retaining the starter's build/session behavior. */
export function useBuilder({ basePath = "/api", client, pollIntervalMs, pollTimeoutMs }: UseBuilderOptions = {}) {
  const controller = useMemo(() => createBuilderController(client ?? createBuilderClient({ basePath }), { pollIntervalMs, pollTimeoutMs }), [basePath, client, pollIntervalMs, pollTimeoutMs]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  return { ...state, setPrompt: controller.setPrompt, build: controller.build, deploy: controller.deploy, unlock: controller.unlock, lock: controller.lock,
    recoverCreatorKey: controller.recoverCreatorKey, refreshCreditAccount: controller.refreshCreditAccount };
}

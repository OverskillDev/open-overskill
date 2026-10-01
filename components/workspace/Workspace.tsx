"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronRight, Circle,
  CircleAlert, Code2, Coins, Folder, Globe2, LayoutGrid, Loader2, LogOut,
  MessageSquare, Plus, RefreshCw, Rocket, ShieldCheck, Sparkles, UserRound,
} from "lucide-react";
import { BrandMark, BrandName } from "@/components/BrandMark";
import { builderConfig } from "@/lib/builder-config";
import { ThemeToggle } from "@/components/ThemeToggle";
import { PreviewPanel, safePreviewUrl } from "@/components/builder/PreviewPanel";
import { CreditAccountNotice } from "@/components/builder/CreditAccountNotice";
import { hasUsableCreditSnapshot, type CreditAccountSnapshot } from "@/lib/credit-account";
import type { ChatMessage, StatusResponse } from "@/lib/types";
import styles from "./workspace.module.css";

type Customer = { id: string; name: string; email: string; simulated: boolean };
type Identity = { authenticated: boolean; user?: Customer; loginAvailable: boolean; demoAvailable: boolean };
type WorkspaceApp = {
  id: string; name: string; prompt: string; jobId: string | null;
  status: StatusResponse | null; messages: ChatMessage[]; publishedUrl: string | null;
  deployState: "idle" | "queued" | "demo" | "published";
  createdAt: string; updatedAt: string; simulated: boolean;
  submissionState?: "confirmed" | "unknown" | "pending";
  attention?: string;
};
type WorkspaceData = { user: Customer; apps: WorkspaceApp[]; provisioned: boolean; mode: "demo" | "live" };
type CreditPack = { id: string; name: string; credits: number; priceCents: number; currency: string; description?: string };
type Packs = { packs: CreditPack[]; checkoutAvailable: boolean; simulated: boolean; message?: string };
type Purchase = {
  id: string; packId: string; checkoutState: "submitting" | "open" | "unknown" | "resolved" | "rejected";
  purchaseStatus: string | null; credits: number | null; priceCents: number | null; currency: "USD";
  checkoutUrl: string | null; creditsGranted: boolean; readAvailable: boolean; updatedAt: string; message: string;
};

const ideas = [
  { title: "A client portal", icon: Folder, prompt: "Build a client portal for a creative agency. Include projects, a project status timeline, shared files, and a feedback form. Use a clean, warm design." },
  { title: "A course companion", icon: Code2, prompt: "Build a course companion for an online photography class. Include a lesson library, weekly assignments, and a progress dashboard with a welcoming editorial design." },
  { title: "A service estimator", icon: Coins, prompt: "Build an interactive service estimator for a home cleaning business. Let visitors choose rooms, cleaning frequency, and extras, then show an estimate and a request form." },
];

class RequestError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

async function request<T>(path: string, body?: unknown, signal?: AbortSignal, expectedCustomer?: string): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin", cache: "no-store", signal,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(expectedCustomer ? { "X-Open-Overskill-Customer": expectedCustomer } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload: Record<string, unknown>;
  try { payload = await response.json(); }
  catch { throw new RequestError("The workspace could not read this response. Refresh to check its current state.", response.status); }
  if (!response.ok) {
    // A fresh page discards customer-specific app, draft, and credit state.
    // Never replay the rejected action under the new account.
    if (response.status === 401 || payload.code === "customer_session_changed") window.location.assign("/workspace");
    throw new RequestError(typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error : "That request did not complete. Refresh to check the current state before trying again.", response.status, typeof payload.code === "string" ? payload.code : undefined);
  }
  return payload as T;
}

function problem(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Refresh to check the current state."; }
function working(app: WorkspaceApp | null) { return app?.status?.status === "queued" || app?.status?.status === "processing"; }
function needsAttention(app: WorkspaceApp) { return app.submissionState === "unknown" || app.submissionState === "pending" || Boolean(app.attention); }
function appStatus(app: WorkspaceApp) {
  if (needsAttention(app)) return "Needs review";
  if (working(app)) return "Building";
  if (app.status?.status === "failed") return "Needs attention";
  if (app.status?.status === "cancelled") return "Build cancelled";
  if (app.deployState === "demo") return "Demo published";
  if (app.deployState === "published") return "Published";
  if (app.deployState === "queued") return "Publish requested";
  return "Draft";
}
function money(pack: { priceCents: number; currency: string }) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: pack.currency.toUpperCase(), maximumFractionDigits: 2 }).format(pack.priceCents / 100); }
  catch { return "Price unavailable"; }
}
function pendingPurchase(purchase: Purchase | null) {
  return Boolean(purchase && ["submitting", "open", "unknown"].includes(purchase.checkoutState));
}
function safeCheckoutUrl(value: string | null | undefined) {
  if (!value || !/^https:\/\/whop\.com(?:\/|$)/i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "whop.com" && !url.port && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function purchaseLabel(purchase: Purchase | null) {
  if (!purchase) return "Checking checkout";
  return { submitting: "Preparing checkout", open: "Checkout ready", unknown: "Needs confirmation", resolved: "Purchase updated", rejected: "Checkout unavailable" }[purchase.checkoutState];
}
function relativeDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Saved" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function Workspace() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [action, setAction] = useState("");
  const [view, setView] = useState<"apps" | "credits">("apps");
  const [activeApp, setActiveApp] = useState<WorkspaceApp | null>(null);
  const [prompt, setPrompt] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [account, setAccount] = useState<CreditAccountSnapshot | null>(null);
  const [creditLoading, setCreditLoading] = useState(false);
  const [creditError, setCreditError] = useState("");
  const [packs, setPacks] = useState<Packs | null>(null);
  const [packsError, setPacksError] = useState("");
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [purchaseLoaded, setPurchaseLoaded] = useState(false);
  const [purchaseLoading, setPurchaseLoading] = useState(false);
  const [purchaseError, setPurchaseError] = useState("");
  const [purchaseUncertain, setPurchaseUncertain] = useState(false);
  const [purchasePollPaused, setPurchasePollPaused] = useState(false);
  const [purchasePollRevision, setPurchasePollRevision] = useState(0);
  const [pollError, setPollError] = useState("");
  const [pollRevision, setPollRevision] = useState(0);
  const [appLoading, setAppLoading] = useState(false);
  const [uncertainWrite, setUncertainWrite] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef(0);
  const mounted = useRef(true);
  const writePending = useRef(false);
  const customerIdRef = useRef<string | undefined>(undefined);
  const purchaseRequestRef = useRef(0);
  const purchaseDeadlineRef = useRef(0);
  const purchaseCreditSignalRef = useRef("");

  const refreshCredits = useCallback(async () => {
    setCreditLoading(true); setCreditError("");
    try { setAccount(await request<CreditAccountSnapshot>("/api/workspace/credits", undefined, undefined, customerIdRef.current)); }
    catch (error) { setAccount(null); setCreditError(problem(error)); }
    finally { setCreditLoading(false); }
  }, []);

  const refreshPacks = useCallback(async () => {
    setPacksError("");
    try { setPacks(await request<Packs>("/api/workspace/packs", undefined, undefined, customerIdRef.current)); }
    catch (error) { setPacks(null); setPacksError(problem(error)); }
  }, []);

  const acceptPurchase = useCallback((next: Purchase | null) => {
    setPurchase(next); setPurchaseLoaded(true); setPurchaseUncertain(false);
    if (pendingPurchase(next)) {
      if (!purchaseDeadlineRef.current) purchaseDeadlineRef.current = Date.now() + 120_000;
    } else { purchaseDeadlineRef.current = 0; setPurchasePollPaused(false); }
    const creditSignal = next ? `${next.id}:${next.creditsGranted}:${next.purchaseStatus}:${next.checkoutState}` : "";
    if (next?.readAvailable === true && creditSignal !== purchaseCreditSignalRef.current && (next.creditsGranted || next.checkoutState === "resolved")) void refreshCredits();
    if (!next || next.readAvailable === true) purchaseCreditSignalRef.current = creditSignal;
  }, [refreshCredits]);

  const refreshPurchase = useCallback(async (signal?: AbortSignal) => {
    const revision = ++purchaseRequestRef.current;
    const customer = customerIdRef.current;
    setPurchaseLoading(true); setPurchaseError("");
    try {
      const result = await request<{ purchase: Purchase | null }>("/api/workspace/purchases", undefined, signal, customer);
      if (!mounted.current || signal?.aborted || revision !== purchaseRequestRef.current || customer !== customerIdRef.current) return undefined;
      acceptPurchase(result.purchase);
      return result.purchase;
    } catch (error) {
      if (mounted.current && !signal?.aborted && revision === purchaseRequestRef.current) setPurchaseError(problem(error));
      return undefined;
    } finally { if (mounted.current && revision === purchaseRequestRef.current) setPurchaseLoading(false); }
  }, [acceptPurchase]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const nextIdentity = await request<Identity>("/api/customer/me");
      if (!mounted.current) return;
      if (customerIdRef.current && nextIdentity.user?.id !== customerIdRef.current) {
        window.location.assign("/workspace");
        return;
      }
      setIdentity(nextIdentity);
      if (nextIdentity.authenticated) {
        const data = await request<WorkspaceData>("/api/workspace", undefined, undefined, nextIdentity.user?.id);
        if (!mounted.current) return;
        customerIdRef.current = data.user.id;
        setWorkspace(data);
        setUncertainWrite(false);
        if (data.provisioned) await Promise.all([refreshCredits(), refreshPacks(), refreshPurchase()]);
      } else { customerIdRef.current = undefined; setWorkspace(null); setAccount(null); setPacks(null); setPurchase(null); setPurchaseLoaded(false); }
    } catch (error) { if (mounted.current) setError(problem(error)); }
    finally { if (mounted.current) setLoading(false); }
  }, [refreshCredits, refreshPacks, refreshPurchase]);

  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; selectionRef.current += 1; }; }, [load]);
  useEffect(() => {
    // Returning from checkout selects this pane only. The query cannot identify
    // a purchase, prove payment, or grant credits; authenticated reads do that.
    if (new URLSearchParams(window.location.search).has("purchase_id")) setView("credits");
  }, []);

  const purchasePending = pendingPurchase(purchase) || purchaseUncertain;
  const purchaseWriting = action.startsWith("purchase:");
  useEffect(() => {
    if (!workspace?.provisioned || workspace.mode === "demo" || !purchasePending || purchaseWriting) return;
    const controller = new AbortController();
    const deadline = purchaseDeadlineRef.current || (purchaseDeadlineRef.current = Date.now() + 120_000);
    let timer: ReturnType<typeof setTimeout>;
    const pause = () => { controller.abort(); clearTimeout(timer); setPurchasePollPaused(true); };
    if (Date.now() >= deadline) { setPurchasePollPaused(true); return; }
    const stop = setTimeout(pause, deadline - Date.now());
    const poll = async () => {
      if (Date.now() >= deadline || controller.signal.aborted) return;
      const next = await refreshPurchase(controller.signal);
      if (controller.signal.aborted) return;
      if (next === undefined) { clearTimeout(stop); setPurchasePollPaused(true); return; }
      if (pendingPurchase(next)) timer = setTimeout(poll, Math.min(5000, Math.max(0, deadline - Date.now())));
      else clearTimeout(stop);
    };
    timer = setTimeout(poll, Math.min(5000, deadline - Date.now()));
    return () => { controller.abort(); clearTimeout(timer); clearTimeout(stop); };
  }, [workspace?.provisioned, workspace?.mode, purchasePending, purchase?.id, purchaseWriting, purchasePollRevision, refreshPurchase]);

  const updateApp = useCallback((app: WorkspaceApp) => {
    setActiveApp(current => current?.id === app.id ? app : current);
    setWorkspace(current => current ? { ...current, apps: [app, ...current.apps.filter(item => item.id !== app.id)] } : current);
  }, []);

  const activeId = activeApp?.id;
  const isBuilding = working(activeApp) && !Boolean(activeApp && needsAttention(activeApp));
  const awaitingPublish = activeApp?.deployState === "queued";
  const activeAttention = Boolean(activeApp && needsAttention(activeApp));
  const reviewRequired = workspace?.apps.find(needsAttention);
  useEffect(() => {
    if (!activeId || activeAttention || (!isBuilding && !awaitingPublish)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let polls = 0;
    setPollError("");
    const poll = async () => {
      try {
        const result = await request<{ app: WorkspaceApp }>(`/api/workspace/apps/${encodeURIComponent(activeId)}`, undefined, controller.signal, customerIdRef.current);
        if (controller.signal.aborted) return;
        updateApp(result.app);
        polls += 1;
        if (working(result.app) || result.app.deployState === "queued") {
          if (polls < 100) timer = setTimeout(poll, 3000);
          else setPollError("This is taking longer than expected. Refresh the app to check the latest progress.");
        } else void refreshCredits();
      } catch (error) { if (!controller.signal.aborted) setPollError(problem(error)); }
    };
    timer = setTimeout(poll, 1800);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [activeId, isBuilding, awaitingPublish, activeAttention, pollRevision, refreshCredits, updateApp]);

  async function sessionAction(kind: "alice" | "bob" | "logout") {
    if (writePending.current) return;
    writePending.current = true; setAction(kind); setError("");
    try {
      await request(kind === "logout" ? "/api/customer/logout" : "/api/customer/demo", kind === "logout" ? {} : { persona: kind });
      // A full navigation clears all in-memory app and credit state between customers.
      window.location.assign("/workspace");
    } catch (error) { setError(problem(error)); setAction(""); writePending.current = false; }
  }

  async function provision() {
    if (writePending.current) return;
    writePending.current = true; setAction("provision"); setError("");
    try { await request("/api/workspace/provision", {}, undefined, workspace?.user.id); await load(); }
    catch (error) { setError(problem(error)); }
    finally { setAction(""); writePending.current = false; }
  }

  async function openApp(app: WorkspaceApp) {
    const selection = ++selectionRef.current;
    if (activeApp?.id !== app.id) setEditPrompt("");
    setActiveApp(app); setView("apps"); setPollError(""); setError(""); setAppLoading(true);
    try {
      const result = await request<{ app: WorkspaceApp }>(`/api/workspace/apps/${encodeURIComponent(app.id)}`, undefined, undefined, workspace?.user.id);
      if (selectionRef.current === selection) { updateApp(result.app); setUncertainWrite(false); }
    } catch (error) { if (selectionRef.current === selection) setPollError(problem(error)); }
    finally { if (selectionRef.current === selection) setAppLoading(false); }
  }

  async function generate(event: FormEvent) {
    event.preventDefault();
    const text = (activeApp ? editPrompt : prompt).trim();
    if (!text || writePending.current || isBuilding || uncertainWrite || reviewRequired) return;
    writePending.current = true; setAction("generate"); setError(""); setPollError("");
    try {
      const { app } = await request<{ app: WorkspaceApp }>("/api/workspace/generate", { prompt: text, ...(activeApp ? { appId: activeApp.id } : {}) }, undefined, workspace?.user.id);
      updateApp(app); setActiveApp(app); setEditPrompt(""); setPrompt("");
      void refreshCredits();
    } catch (error) {
      const uncertain = !(error instanceof RequestError) || error.status >= 500;
      setUncertainWrite(uncertain);
      setError(problem(error) + (uncertain ? " Refresh state before sending another build; the first request may have been accepted." : ""));
    }
    finally { setAction(""); writePending.current = false; }
  }

  async function publish() {
    if (!activeApp || writePending.current || uncertainWrite || reviewRequired) return;
    writePending.current = true; setAction("publish"); setError("");
    try {
      const { app } = await request<{ app: WorkspaceApp }>(`/api/workspace/apps/${encodeURIComponent(activeApp.id)}/deploy`, {}, undefined, workspace?.user.id);
      updateApp(app);
    } catch (error) {
      const uncertain = !(error instanceof RequestError) || error.status >= 500;
      setUncertainWrite(uncertain);
      setError(problem(error) + (uncertain ? " Refresh state before publishing again; the request may have been accepted." : ""));
    }
    finally { setAction(""); writePending.current = false; }
  }

  async function buyPack(pack: CreditPack) {
    if (writePending.current || !workspace || workspace.mode === "demo" || !packs?.checkoutAvailable || packs.simulated ||
      !purchaseLoaded || purchaseLoading || purchaseError || purchasePending || purchase?.readAvailable === false || !packs.packs.some(item => item.id === pack.id)) return;
    writePending.current = true;
    const revision = ++purchaseRequestRef.current;
    setAction(`purchase:${pack.id}`); setPurchase(null); setPurchaseError(""); setPurchaseUncertain(true); setPurchasePollPaused(false);
    purchaseDeadlineRef.current = Date.now() + 120_000;
    try {
      // The server selects the creator, price, quantity, return URL and durable
      // idempotency key. This action is never replayed automatically.
      const result = await request<{ purchase: Purchase }>("/api/workspace/purchases", { packId: pack.id }, undefined, workspace.user.id);
      if (!mounted.current) return;
      if (revision === purchaseRequestRef.current) acceptPurchase(result.purchase);
      else void refreshPurchase();
    } catch (error) {
      if (mounted.current && revision === purchaseRequestRef.current) {
        setPurchaseError(`${problem(error)} Refresh purchase before trying another pack.`);
        setPurchaseUncertain(true);
      }
    } finally { if (mounted.current) setAction(""); writePending.current = false; }
  }

  async function checkPurchase() {
    purchaseDeadlineRef.current = Date.now() + 120_000;
    setPurchasePollPaused(false);
    const next = await refreshPurchase();
    if (next === undefined) setPurchasePollPaused(true);
    else setPurchasePollRevision(value => value + 1);
  }

  function dashboard() { selectionRef.current += 1; setActiveApp(null); setView("apps"); setEditPrompt(""); setError(""); setPollError(""); setAppLoading(false); }
  const demo = workspace?.mode === "demo";
  const canGenerate = Boolean(workspace?.provisioned && !uncertainWrite && !reviewRequired && !creditLoading && !creditError && hasUsableCreditSnapshot(account));
  const busy = Boolean(action);
  const customerName = workspace?.user.name?.split(" ")[0] || "there";
  const previewUrl = activeApp?.status?.app?.preview_url;
  const publishedUrl = safePreviewUrl(activeApp?.publishedUrl);
  const purchaseReadUnavailable = purchase?.readAvailable === false;
  const checkoutUrl = purchase?.checkoutState === "open" && !purchase.creditsGranted && !purchaseReadUnavailable ? safeCheckoutUrl(purchase.checkoutUrl) : null;
  const canBuyPack = Boolean(!demo && packs?.checkoutAvailable && !packs.simulated && purchaseLoaded && !purchaseLoading && !purchaseError && !purchasePending && !purchaseReadUnavailable && !busy);

  return <main className={styles.shell}>
    <a href="#workspace-main" className={styles.skipLink}>Skip to workspace</a>
    <header className={styles.header}>
      <a href="/" className={styles.logo} aria-label={`${builderConfig.name} home`}><BrandMark size={30} /><span><BrandName lightClassName={styles.logoLight} /></span></a>
      <span className={styles.headerLabel}>THE REFERENCE BUILDER</span>
      <div className={styles.headerActions}><a href="/guide" className={styles.guideLink}>Build your own <ArrowUpRight size={14} /></a><ThemeToggle /></div>
    </header>

    {loading ? <div className={styles.loading} id="workspace-main" role="status"><Loader2 size={22} className={styles.spinner} /><h1>Opening your workspace</h1><p>Finding your apps and account.</p></div>
      : !workspace ? <section className={styles.signIn} id="workspace-main">
        <div className={styles.signInStory}>
          <span className={styles.eyebrow}><span /> FROM YOUR FIRST IDEA TO YOUR NEXT APP</span>
          <h1>Build software<br />with words.</h1>
          <p>A place for your ideas to become working apps. Describe what you need, shape the details, and make it yours.</p>
          <div className={styles.productSketch} aria-hidden="true">
            <div className={styles.sketchToolbar}><span /><span /><span /><small>YOUR NEXT IDEA</small></div>
            <div className={styles.sketchPrompt}><Sparkles size={17} /> A client portal that feels like our brand.</div>
            <div className={styles.sketchApp}><div className={styles.sketchSidebar}><span /><span /><span /><span /></div><div><div className={styles.sketchTitle}>Good things, in progress.</div><div className={styles.sketchCards}><span><Folder size={18} />Projects</span><span><MessageSquare size={18} />Feedback</span><span><Check size={18} />Milestones</span></div><div className={styles.sketchLine} /><div className={styles.sketchLine} /></div></div>
            <div className={styles.sketchFoot}><Check size={13} /> Your idea. Your app.</div>
          </div>
          <span className={styles.powered}>POWERED BY OVERSKILL</span>
        </div>
        <div className={styles.signInCard}>
          <div className={styles.cardIcon}><UserRound size={23} /></div>
          <h2>Your ideas live here.</h2><p>Sign in to create apps and pick up where you left off.</p>
          {error && <ErrorNotice message={error} onRefresh={() => void load()} />}
          {identity?.loginAvailable ? <a className={styles.primaryButton} href="/api/customer/login">Continue to sign in <ArrowRight size={16} /></a> : <div className={styles.availabilityNote}>Customer sign-in is not connected in this installation yet.</div>}
          {identity?.demoAvailable && <>
            <div className={styles.divider}><span>EXPLORE THE LOCAL DEMO</span></div>
            <div className={styles.personas}>
              <button onClick={() => void sessionAction("alice")} disabled={busy}><span className={styles.personaAvatar}>A</span><span><strong>Continue as Alice</strong><small>Fictional demo customer</small></span>{action === "alice" ? <Loader2 size={17} className={styles.spinner} /> : <ChevronRight size={17} />}</button>
              <button onClick={() => void sessionAction("bob")} disabled={busy}><span className={styles.personaAvatar}>B</span><span><strong>Continue as Bob</strong><small>A separate demo workspace</small></span>{action === "bob" ? <Loader2 size={17} className={styles.spinner} /> : <ChevronRight size={17} />}</button>
            </div>
            <p className={styles.demoFootnote}>Demo apps are saved locally for each persona. Generation, credits and publishing are simulated. No payments or provider calls.</p>
          </>}
          {!identity && !error && <button className={styles.secondaryButton} onClick={() => void load()}>Refresh sign-in options</button>}
          <div className={styles.accountPromise}><ShieldCheck size={16} /><span>Your apps belong in your own workspace.</span></div>
        </div>
      </section> : <>
        {demo && <div className={styles.demoBanner}><span className={styles.demoTag}>LOCAL DEMO</span><span>Fictional customers. Saved demo apps. No real generation, payments or publication.</span></div>}
        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            <div className={styles.customer}><span className={styles.customerAvatar}>{customerName[0]?.toUpperCase()}</span><div><strong>{workspace.user.name}</strong><span>{demo ? "Demo workspace" : "Personal workspace"}</span></div></div>
            <button className={styles.newButton} onClick={dashboard} disabled={busy}><Plus size={17} /> New app</button>
            <nav className={styles.navigation} aria-label="Workspace">
              <button aria-current={view === "apps" ? "page" : undefined} onClick={dashboard} disabled={busy}><LayoutGrid size={17} /> Your apps <span>{workspace.apps.length}</span></button>
              <button aria-current={view === "credits" ? "page" : undefined} onClick={() => { selectionRef.current += 1; setView("credits"); setActiveApp(null); setError(""); }} disabled={busy}><Coins size={17} /> Credits & account</button>
            </nav>
            <div className={styles.sidebarBottom}>
              <div className={styles.balanceCard}><span>{demo ? "DEMO BALANCE" : "WORKSPACE BALANCE"}</span><strong>{creditLoading ? "Reading…" : account?.balance.credits == null || creditError ? "Unavailable" : account.balance.credits.toLocaleString()}<small>{!creditLoading && account?.balance.credits != null && !creditError ? " credits" : ""}</small></strong><button onClick={() => { setView("credits"); setActiveApp(null); }} disabled={busy}>View account <ArrowRight size={13} /></button></div>
              <button className={styles.signOut} onClick={() => void sessionAction("logout")} disabled={busy}>{action === "logout" ? <Loader2 size={15} className={styles.spinner} /> : <LogOut size={15} />} Sign out</button>
            </div>
          </aside>

          <section className={styles.main} id="workspace-main">
            {error && <ErrorNotice message={error} onRefresh={() => { if (activeApp) void openApp(activeApp); else void load(); }} />}
            {!workspace.provisioned ? <div className={styles.onboarding}>
              <span className={styles.cardIcon}><Folder size={24} /></span><span className={styles.eyebrow}>ONE SMALL STEP</span>
              <h1>Make room for your ideas.</h1><p>Create your {demo ? "demo " : ""}workspace to start building. Your apps, build conversations and credits will stay together here.</p>
              <button className={styles.primaryButton} onClick={() => void provision()} disabled={busy}>{action === "provision" ? <Loader2 size={17} className={styles.spinner} /> : <Plus size={17} />} {action === "provision" ? "Creating workspace…" : `Create ${demo ? "demo " : ""}workspace`}</button>
              {demo && <small>This creates local demo data only.</small>}
            </div> : view === "credits" ? <div className={styles.accountPage}>
              <span className={styles.eyebrow}>YOUR WORKSPACE</span><h1>Credits & account</h1><p className={styles.pageDescription}>Credits for the apps you build here. Everything stays with your workspace.</p>
              <div className={styles.accountGrid}><section className={styles.accountDetails}><CreditAccountNotice account={account} loading={creditLoading} error={creditError} demo={demo} provisioned={workspace.provisioned} disabled={busy} onRefresh={() => void refreshCredits()} /></section><section className={styles.identityCard}><ShieldCheck size={22} /><h2>Your account</h2><dl><div><dt>Name</dt><dd>{workspace.user.name}</dd></div><div><dt>Email</dt><dd>{workspace.user.email}</dd></div><div><dt>Workspace</dt><dd>{account?.creditAccount.teamId ? `#${account.creditAccount.teamId}` : "Not reported"}</dd></div></dl><p>Apps and access are tied to this signed-in account.</p></section></div>
              {!demo && (purchase || purchaseUncertain || purchaseError || !purchaseLoaded) && <section className={styles.purchaseCard} aria-labelledby="purchase-heading">
                <div className={styles.purchaseHeading}><span className={styles.packIcon}><Coins size={21} /></span><div><span className={styles.eyebrow}>LATEST CREDIT-PACK PURCHASE</span><h2 id="purchase-heading">{action.startsWith("purchase:") ? "Preparing your checkout" : purchaseReadUnavailable ? "Purchase status unavailable" : purchaseLabel(purchase)}</h2></div>{purchaseLoading && <Loader2 size={17} className={styles.spinner} aria-label="Refreshing purchase" />}</div>
                <div aria-live="polite" aria-atomic="true">
                  {purchaseReadUnavailable && <p className={styles.purchaseStale}><CircleAlert size={15} />Showing the last confirmed status. Refresh purchase before starting another checkout.</p>}
                  <p>{purchase?.message || (purchaseUncertain ? "We are checking whether your checkout was created. Refresh this purchase before starting another one." : "Checking for an existing purchase before creating a checkout.")}</p>
                  {purchase && <dl className={styles.purchaseDetails}>
                    {purchase.credits != null && <div><dt>Credit pack</dt><dd>{purchase.credits.toLocaleString()} credits</dd></div>}
                    {purchase.priceCents != null && <div><dt>Pack price</dt><dd>{money({ priceCents: purchase.priceCents, currency: purchase.currency })}</dd></div>}
                    <div><dt>{purchaseReadUnavailable ? "Last confirmed payment status" : "Payment status"}</dt><dd>{purchase.purchaseStatus || "Not reported"}</dd></div>
                  </dl>}
                  {purchase?.creditsGranted && <p className={purchaseReadUnavailable ? styles.purchaseFootnote : styles.purchaseCreditNote}>{!purchaseReadUnavailable && <Check size={14} />}{purchaseReadUnavailable ? "A credit grant was previously reported for this purchase. This is not a fresh confirmation." : "A credit grant is recorded for this purchase. Your current available balance is shown above."}</p>}
                  {purchaseError && <p className={styles.purchaseError} role="alert"><CircleAlert size={15} />{purchaseError}</p>}
                  {purchasePending && <p className={styles.purchaseFootnote}>{purchasePollPaused ? "Automatic status checks have paused. Refresh purchase to check again." : "Checking status for up to two minutes. A checkout return does not confirm payment or add credits."}</p>}
                </div>
                <div className={styles.purchaseActions}>{checkoutUrl && <a className={styles.primaryButton} href={checkoutUrl} target="_blank" rel="noopener noreferrer">Continue on Whop <ArrowUpRight size={15} /></a>}<button className={styles.secondaryButton} onClick={() => void checkPurchase()} disabled={busy || purchaseLoading}><RefreshCw size={14} className={purchaseLoading ? styles.spinner : undefined} />Refresh purchase</button></div>
                {purchase?.checkoutState === "open" && !purchase.creditsGranted && !checkoutUrl && <p className={styles.purchaseFootnote}>A valid Whop checkout link is not available yet. Refresh this purchase to check again.</p>}
              </section>}
              <div className={styles.sectionHeading}><div><h2>Credit packs</h2><p>{packs?.simulated ? "This demo uses a simulated balance. No purchase is needed." : "Existing Overskill packs, when available to this workspace."}</p></div><button className={styles.iconButton} aria-label="Refresh credit packs" onClick={() => void refreshPacks()} disabled={busy}><RefreshCw size={16} /></button></div>
              {packsError && <ErrorNotice message={packsError} onRefresh={() => void refreshPacks()} />}
              {packs && <div className={styles.packGrid}>{packs.packs.map(pack => <article className={styles.packCard} key={pack.id}><span className={styles.packIcon}><Coins size={20} /></span><h3>{pack.name}</h3><strong>{pack.credits.toLocaleString()} <small>credits</small></strong><p>{pack.description || "Credits for building and editing apps."}</p>{!demo && !packs.simulated && <div className={styles.packPrice}>{money(pack)}</div>}<button className={canBuyPack ? styles.primaryButton : styles.secondaryButton} onClick={() => void buyPack(pack)} disabled={!canBuyPack}>{action === `purchase:${pack.id}` && <Loader2 size={14} className={styles.spinner} />}{demo || packs.simulated ? "Demo · no purchase" : action === `purchase:${pack.id}` ? "Preparing checkout…" : !packs.checkoutAvailable ? "Checkout not connected" : purchaseReadUnavailable ? "Refresh purchase first" : purchasePending ? "Check current purchase" : "Buy existing pack"}</button></article>)}</div>}
              {packs?.packs.length === 0 && <div className={styles.emptyPacks}><Coins size={25} /><div><h3>{packs.simulated ? "Try the builder with demo credits." : "No packs are available to this workspace yet."}</h3><p>{packs.simulated ? "The live builder will display the existing Overskill catalog here. Demo credits have no cash value." : "Refresh later to check the catalog. Your existing balance is shown above."}</p></div></div>}
              <div className={styles.billingNote}><CircleAlert size={17} /><p>{packs?.message || (packs?.checkoutAvailable && !demo && !packs.simulated ? "Review and pay on Whop. Credits become available when Overskill confirms the purchase and updates your workspace balance." : "Pack checkout is not connected in this reference installation. No purchase or automatic top-up can be started from this page.")}</p></div>
            </div> : activeApp ? <div className={styles.editor}>
              <div className={styles.editorHeader}><button className={styles.backButton} onClick={dashboard} disabled={busy}><ArrowLeft size={16} /><span>Your apps</span></button><div className={styles.editorTitle}><h1>{activeApp.name}</h1><span className={styles.statusPill} data-working={isBuilding}>{isBuilding ? <Loader2 size={12} className={styles.spinner} /> : <Circle size={8} fill="currentColor" />} {appStatus(activeApp)}</span></div><div className={styles.editorHeaderActions}><button className={styles.iconButton} aria-label="Refresh app" onClick={() => { setPollRevision(value => value + 1); void openApp(activeApp); }} disabled={busy || appLoading}><RefreshCw size={16} className={appLoading ? styles.spinner : undefined} /></button><button className={styles.primaryButton} onClick={() => void publish()} disabled={busy || uncertainWrite || Boolean(reviewRequired) || appLoading || isBuilding || activeApp.status?.status !== "completed" || activeApp.deployState !== "idle"}>{action === "publish" ? <Loader2 size={16} className={styles.spinner} /> : <Rocket size={15} />}{action === "publish" ? "Requesting…" : activeApp.deployState === "demo" ? "Demo published" : activeApp.deployState === "published" ? "Published" : awaitingPublish ? "Publishing…" : demo ? "Publish demo" : "Publish"}</button></div></div>
              {activeAttention && <ErrorNotice message={activeApp.attention || "This app has an unconfirmed submission. It needs review before another build or publication can start."} onRefresh={() => void openApp(activeApp)} />}
              {pollError && <ErrorNotice message={pollError} onRefresh={() => { setPollRevision(value => value + 1); void openApp(activeApp); }} />}
              {(activeApp.deployState === "demo" || activeApp.deployState === "queued" || activeApp.deployState === "published") && <div className={styles.publishNotice}><Check size={16} /><span>{activeApp.deployState === "demo" ? "Demo publishing complete. This is a local preview, not a public website." : activeApp.deployState === "published" ? "Your app is published." : "Publishing was requested. Refresh to check its status."}</span>{publishedUrl && <a href={publishedUrl} target="_blank" rel="noreferrer">{demo ? "Open demo" : "Open app"}<ArrowUpRight size={14} /></a>}</div>}
              <div className={styles.editorGrid}><section className={styles.conversation}>
                <div className={styles.conversationHeading}><MessageSquare size={16} /><h2>Build conversation</h2><span>{demo ? "SIMULATED" : "OVERSKILL"}</span></div>
                <div className={styles.messages} aria-busy={isBuilding || action === "generate"}>
                  {activeApp.messages.length ? activeApp.messages.map(message => <Message key={message.id} message={message} busy={isBuilding} />) : <div className={styles.userMessage}><span>YOU</span><p>{activeApp.prompt}</p></div>}
                  {isBuilding && <div className={styles.buildProgress} role="status"><Loader2 size={16} className={styles.spinner} /><span>{activeApp.status?.message || "Your app is taking shape…"}</span></div>}
                </div>
                <form className={styles.editComposer} onSubmit={generate}><label htmlFor="edit-prompt">What would you like to change?</label><textarea id="edit-prompt" value={editPrompt} onChange={event => setEditPrompt(event.target.value)} placeholder="Add a contact form and make the header green…" maxLength={12000} rows={3} disabled={busy || isBuilding || appLoading} /><div><span>{demo ? "Simulated edit" : "Uses workspace credits"}</span><button aria-label="Send app changes" type="submit" disabled={!editPrompt.trim() || busy || isBuilding || appLoading || !canGenerate}>{action === "generate" ? <Loader2 size={17} className={styles.spinner} /> : <ArrowUp size={17} />}</button></div></form>
                {!canGenerate && !creditLoading && <div className={styles.inlineNote}>{reviewRequired ? <>An earlier request needs review before another build. <button onClick={() => void openApp(reviewRequired)} disabled={busy}>Review app</button></> : uncertainWrite ? <>Check the latest app state before sending another request. <button onClick={() => void openApp(activeApp)} disabled={busy}>Refresh app</button></> : <>Builds are paused while credits are unavailable. <button onClick={() => void refreshCredits()} disabled={busy}>Refresh credits</button></>}</div>}
              </section><div className={styles.preview}><PreviewPanel url={previewUrl} busy={isBuilding || action === "generate"} demo={demo} /></div></div>
            </div> : <div className={styles.dashboard}>
              <div className={styles.welcome}><span className={styles.eyebrow}>YOUR IDEAS START HERE</span><h1>What will you build, {customerName}?</h1><p>Describe it. Shape it. Make it yours.</p></div>
              <form className={styles.newComposer} onSubmit={generate}><label className={styles.visuallyHidden} htmlFor="new-app-prompt">Describe your new app</label><textarea ref={promptRef} id="new-app-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="An app for my business that…" rows={3} maxLength={12000} disabled={busy} /><div className={styles.composerFooter}><span><Sparkles size={14} />{demo ? "Local demo · simulated generation" : "Powered by Overskill"}</span><button className={styles.primaryButton} type="submit" disabled={!prompt.trim() || busy || !canGenerate}>{action === "generate" ? <Loader2 size={16} className={styles.spinner} /> : <ArrowUp size={16} />}{action === "generate" ? "Starting…" : "Build app"}</button></div></form>
              {!canGenerate && <div className={styles.inlineNote}>{creditLoading ? "Checking your workspace credits…" : <>{reviewRequired ? <>An earlier request needs review before another build. <button onClick={() => void openApp(reviewRequired)} disabled={busy}>Review app</button></> : uncertainWrite ? <>Check the latest workspace state before sending another request. <button onClick={() => void load()} disabled={busy}>Refresh workspace</button></> : <>Builds are paused until your credit balance is available. <button onClick={() => void refreshCredits()} disabled={busy}>Refresh credits</button></>}</>}</div>}
              <div className={styles.ideas}>{ideas.map(idea => <button key={idea.title} onClick={() => { setPrompt(idea.prompt); promptRef.current?.focus(); }} disabled={busy}><idea.icon size={14} />{idea.title}<Plus size={13} /></button>)}</div>
              <div className={styles.sectionHeading}><div><h2>Your apps <span>{workspace.apps.length}</span></h2><p>Come back to an idea and keep going.</p></div><button className={styles.iconButton} aria-label="Refresh saved apps" onClick={() => void load()} disabled={busy}><RefreshCw size={16} /></button></div>
              {workspace.apps.length ? <div className={styles.appsGrid}>{workspace.apps.map((app, index) => <button className={styles.appCard} key={app.id} onClick={() => void openApp(app)} disabled={busy}><div className={styles.appArtwork} data-tone={index % 3}><div className={styles.artworkWindow}><div><span /><span /><span /></div><Globe2 size={28} /><span /><span /></div><span className={styles.appOpen}>Open app <ArrowUpRight size={15} /></span></div><div className={styles.appCardBody}><div><h3>{app.name}</h3><ArrowUpRight size={16} /></div><p>{app.prompt}</p><div><span className={styles.statusPill}>{appStatus(app)}</span><time dateTime={app.updatedAt}>{relativeDate(app.updatedAt)}</time></div></div></button>)}</div> : <div className={styles.emptyApps}><div><Folder size={23} /></div><h3>Your next idea belongs here.</h3><p>Build your first app above. It will be saved here so you can return, edit and publish.</p></div>}
              <footer className={styles.workspaceFooter}><span>BUILD SOFTWARE WITH WORDS.</span><a href="/guide">Make this builder your own <ArrowUpRight size={13} /></a></footer>
            </div>}
          </section>
        </div>
      </>}
  </main>;
}

function ErrorNotice({ message, onRefresh }: { message: string; onRefresh: () => void }) {
  return <div className={styles.error} role="alert"><CircleAlert size={17} /><span>{message}</span><button onClick={onRefresh}><RefreshCw size={13} />Refresh state</button></div>;
}

function Message({ message, busy }: { message: ChatMessage; busy: boolean }) {
  const user = message.role === "user";
  return <article className={user ? styles.userMessage : styles.assistantMessage}><span>{user ? "YOU" : "OVERSKILL"}</span>{message.content && <p>{message.content}</p>}{message.flow?.map((block, index) => block.type === "message" ? block.content !== message.content && <p key={index}>{block.content}</p> : <div key={index} className={styles.tools}>{block.tools?.map((tool, toolIndex) => <span key={toolIndex}>{["completed", "complete"].includes(tool.status || "") ? <Check size={12} /> : tool.status === "running" && busy ? <Loader2 size={12} className={styles.spinner} /> : <Circle size={10} />}{tool.name?.replaceAll("_", " ") || "Build step"}</span>)}</div>)}</article>;
}

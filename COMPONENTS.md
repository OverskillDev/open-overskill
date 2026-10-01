# Compose a builder in your own interface

This guide covers the original local operator sandbox at `/builder` and `/examples/minimal`. The complete customer reference is `/workspace`, implemented in `components/workspace/Workspace.tsx` with the durable `/api/workspace` routes. Its verified identity, persistent app ownership and checkout contract are described in [CUSTOMER_AUTH.md](CUSTOMER_AUTH.md). The operator hook below does not provide those customer services by itself.

Use `useBuilder` to keep the starter's authenticated build flow while replacing its layout. The hook handles configuration, creator context, provisioning, explicit key recovery, credit-account snapshots, generation, polling, iteration, session errors and deploy requests. `components/Editor.tsx` composes the shipped UI from this same hook.

`components/examples/MinimalBuilder.tsx` is a complete, typechecked example. Open `/examples/minimal` in the running starter to try its local unlock form, prompt, conversation, preview and deploy controls. The guide links to this route under Components. To use that composition in another page:

```tsx
"use client";
import { MinimalBuilder } from "@/components/examples/MinimalBuilder";

export default function MyBuilderPage() {
  return <MinimalBuilder />;
}
```

Keep the existing `app/globals.css` if you want the starter's component styling. This is source code for integration into a React application; it is not a published npm package or a remotely embeddable authenticated builder.

## Hook contract

```tsx
"use client";
import { useBuilder } from "@/hooks/useBuilder";
import { PromptComposer } from "@/components/builder/PromptComposer";

export function PromptOnly() {
  const builder = useBuilder();
  return (
    <PromptComposer
      value={builder.prompt}
      onChange={builder.setPrompt}
      onSubmit={builder.build}
      suggestions={builder.suggestions}
      disabled={!builder.ready || builder.needsKeyRecovery || builder.recoveringKey || builder.creditAccountBlocked || builder.creditAccountLoading}
      busy={builder.busy}
      hasApp={Boolean(builder.appId)}
    />
  );
}
```

The prompt-only example assumes a ready demo or already unlocked session. Use the complete example to support live operator unlocking and to present errors, progress and deploy status.

| Return value | Purpose |
| --- | --- |
| `config`, `creator`, `brief`, `suggestions` | Server-provided mode, branding/context and starter prompts |
| `ready`, `locked`, `unlocking`, `error` | Connection/session state and a safe error message |
| `prompt`, `setPrompt(value)`, `submitted` | Controlled prompt and the submitted text |
| `build()` | Provision once in this session, then generate; later prompts target the same `appId` |
| `needsKeyRecovery`, `recoveringKey`, `recoverCreatorKey()` | Explicitly replace a lost creator key; never runs automatically or submits a prompt afterward |
| `creditAccount`, `creditAccountLoading`, `creditAccountBlocked`, `creditAccountError`, `refreshCreditAccount()` | Read-only usage, balance and holds with provenance; unavailable data remains unknown |
| `busy`, `stage`, `status`, `messages`, `appId` | Build progress, transcript and current app identity |
| `unlock(token)`, `lock()` | Local operator session actions; the hook does not store the token |
| `deploy()`, `deploying`, `deployState`, `publishedUrl` | A deploy request; `queued` does not mean verified publication |

Options are `{ basePath?, client?, pollIntervalMs?, pollTimeoutMs? }`. The default same-origin adapter prefix is `/api`, polling interval is 1,500 ms, and polling stops after 30 minutes. To use an adapter mounted elsewhere on your own server, pass `useBuilder({ basePath: "/api/my-builder" })`. You must implement/mount the corresponding server routes; this option does not move routes automatically.

A `client` can implement the exported `BuilderClient` interface for an existing authenticated adapter. Keep that object stable across renders, for example with `useMemo`. Changing the client or options creates a fresh controller and stops tracking the previous view. `createBuilderClient` in `lib/builder-client.ts` provides the typed browser transport; it rejects remote base URLs, uses same-origin credentials and refuses redirects. Provider keys belong on the server, never in a hook option.

## Components

- `PromptComposer`: `value`, `onChange`, `onSubmit`, `suggestions`, optional `suggestionLabels`, `disabled`, `busy`, `hasApp`.
- `BuildTranscript`: `messages`, `busy`.
- `PreviewPanel`: `url`, `publishedUrl`, `busy`, `demo`. It validates link/frame URLs and offers a new-tab link when an external preview cannot be embedded.
- `CreditAccountNotice`: `account`, `loading`, `error`, `demo`, `provisioned`, optional `needsKeyRecovery`, `disabled`, and `onRefresh`.
- `CreatorAccessRecovery`: `recovering`, `onRecover`. Explains key replacement before offering the explicit action. Exported alongside `CreditAccountNotice`.

Each component controls presentation only. `useBuilder` supplies their data and actions; the authenticated server remains responsible for creator identity, allowed app IDs and credits.

## Session and lifecycle behavior

Unmounting, changing the client, locking, or expiring a session stops polling and invalidates late responses. A late generation, deploy or authentication response cannot restore the previous session's UI. Stopping a browser request does **not** cancel a build or deployment already accepted by Overskill.

Expired demo sessions reconnect, retaining any unsubmitted prompt for resubmission. Live sessions require unlocking again. Actions are not automatically retried after an authentication failure. The current app is held in hook state; refreshing the page does not restore that selection, and this local pilot's server session remains process-local.

The live server configures a stable `OVERSKILL_CREATOR_ID`, scoped to its partner. Reusing that identity resolves the existing creator workspace on a compatible Overskill backend. The local pilot does not persist raw creator keys across sessions: if provisioning returns `recoveryRequired`, the hook stops before generation and retains the prompt. `recoverCreatorKey()` is an explicit mutation that replaces the previous builder key. It does not submit the prompt. A conflict requires reconciling stored credentials; lock and unlock to reload the binding before explicitly recovering again if needed. Neither the hook nor a normal provisioning replay rotates keys automatically.

This integration does not add durable multi-user authentication, billing policy, Whop onboarding or tenant management. Live provisioning first checks the backend's creator-identity capability and refuses unsupported backends without creating a workspace.

## Credit account contract

The typed client exposes `creditAccount()` as a same-origin `GET /api/credit-account`. That route requires a creator session, reads Overskill usage with the creator key, and compares the returned team to the server's creator workspace. Browser callers cannot choose a payer team. The hook sends `creditResponsibility: "creator_workspace"` when requesting a build. Partner sponsorship is unsupported; selecting it is rejected before generation.

`CreditAccountSnapshot` in `lib/credit-account.ts` separates the responsible workspace from read-only telemetry. The adapter first requests the draft versioned `GET /api/v1/creator_usage?period=30d` contract with the creator key. The meter reports recorded gross generation debits for its UTC window, spendable credits, pending reservations, and available credits for admission. These are separate measures, not net charges, a price quote, a spending cap, or a promise that the next build will be admitted. Refunds/net charges are not reported; trial credits require app context. Reads are request-local, not an atomic ledger snapshot.

The details panel includes cached Whop balance and pending sync deductions separately: it never adds these to the balance or subtracts pending sync a second time. Neither the cache nor the meter proves an authoritative provider wallet balance, Whop onboarding, or separate wallet isolation. Reported auto-billing flags describe existing settings and do not change them. Existing workspace billing policy and Overskill admission enforcement still apply.

This core endpoint is a draft dependency, not a deployed/public availability claim. **Only an upstream 404** permits fallback to `/api/v1/usage`. That fallback is labeled `partial_legacy`, excludes pending reservations, and reports no generation meter, Whop balance or auto-billing flags. Authentication, rate-limit, network and server failures do not trigger fallback or automatic retries. A valid versioned `503` response can carry explicitly unknown metrics. Version, team, metric statuses, numeric ranges and provenance are validated; arbitrary provider fields are never forwarded. Demo telemetry is marked `simulated` and cannot fund live builds.

Missing or malformed balances remain `null` with `status: "unavailable"`; they never become zero. The hook refreshes before generation and after terminal build status. A fully unavailable snapshot or failed read pauses generation in both the controller and server adapter. The generation button stays disabled until an explicit successful refresh; refreshing never submits a prompt. Ready/partial versioned snapshots and known legacy balances remain supported, without inferring affordability from the displayed number. Overskill remains responsible for credit enforcement and the pilot requires an approved hard funding cap. A mismatched or unverifiable returned account stops the hook before it requests generation. No snapshot operation creates an account, tops it up, changes billing settings, or reconciles a provider ledger.

Run `node --test tests/builder-client-controller.test.cjs tests/credit-account.test.cjs` for the transport, controller and credit-contract tests. They use simulated clients and make no provider requests.

# Open Overskill

An example AI app builder powered by the Overskill partner API. Customize the interface for your agency, integrate it into an existing product, or use it as the starting point for your own branded builder.

**Build software with words.**

The customer workspace MVP runs locally. The original interface, examples and server adapter are prepared for public release under MIT. Public repository publication and the hosted paid experience are still pending. Overskill's generation pipelines remain a managed service.

## Run the customer demo

Use **Node 22.23 or newer** and a writable, persistent local directory:

```sh
npm ci
npm run setup
npm run doctor -- --customer
npm run dev
# Open http://127.0.0.1:3577/workspace
```

Use the exact configured origin: `127.0.0.1` and `localhost` are different origins. The included server scripts bind to loopback. `setup` creates a demo `.env.local` without overwriting an existing file or printing secrets.

In `/workspace`:

1. Continue as fictional customer Alice and create a demo workspace.
2. Describe an app, follow its simulated build, and open the preview.
3. Edit the app or choose **Publish demo** to exercise the publication UI.
4. Return to **Your apps**, sign out, and sign in again to reopen the saved app.
5. Sign in as Bob to explore a separate customer workspace.

Demo app metadata and account bindings persist in SQLite across sign-out and server restart. The preview uses a fixed template; no LLM creates its contents. Generation, credits, and publication are simulated. The demo exposes no credit-pack offers or prices, creates no purchases, makes no provider calls, and does not publish a public website. Demo customers are available only on loopback.

## What's included

| Route | Purpose |
| --- | --- |
| `/workspace` | Primary customer flow: sign-in, workspace setup, saved apps, build/edit conversation, preview, publication state, credits/account, and gated existing-pack checkout |
| `/builder` | Original local operator sandbox for inspecting the single-creator API flow |
| `/examples/minimal` | Small component-composition example |
| `/guide` | Overview of the original builder components and adapter |
| `/` | Project overview |

The customer flow has persistent app ownership and server-held credentials. The older operator sandbox keeps credentials and app ownership in process memory; its sessions disappear on restart. Do not use its operator token as customer authentication.

See [CUSTOMER_AUTH.md](CUSTOMER_AUTH.md) for verified sign-in, storage, sessions, and operational limits. See [COMPONENTS.md](COMPONENTS.md) for the original reusable builder components.

## Customize the reference

| Surface | File |
| --- | --- |
| Customer dashboard, account pane, and app editor | `components/workspace/Workspace.tsx` |
| Customer layout, theme treatment, and motion | `components/workspace/workspace.module.css` |
| Shared theme and original builder styles | `app/globals.css` |
| Shared brand name, original studio label, page metadata and public docs link | `lib/builder-config.ts` |
| Original operator fixture and starter prompts | `lib/creator-context.ts` |
| Shared preview component | `components/builder/PreviewPanel.tsx` |
| Verified customer identity and sessions | `lib/customer-auth.ts` |
| Persistent customer/app storage | `lib/customer-store.ts` |
| Customer-scoped application operations | `lib/customer-workspace.ts` |
| Customer purchase transport journal and reconciliation | `lib/customer-purchases.ts` |
| Server-to-server Overskill API adapter | `lib/overskill.ts` |

Edit `builderConfig` in `lib/builder-config.ts` to set one installation's public `name`, original sandbox `studioName` label, `tagline`, metadata `description` and header `docsUrl`. The name is shared by the customer and original headers, homepage footer and page titles; the default retains the Open Overskill wordmark. Rebuild the app after changing this source configuration. Starter ideas, product copy, colors and the generic code mark remain editable in their own components/styles; this is not a runtime theme or tenant-management system.

These settings are public, so never add credentials or private commercial terms. A custom name may appear in app attribution as a display name; it does not change the server's partner slug, customer identity, creator workspace, API destination or payer. Managed **Powered by Overskill** attribution and its `overskillLinks` remain separate from the operator's brand and documentation link. Replace fictional content with authorized customer data before offering a real service.

## Identity, apps, and billing

```text
Customer browser
    → your authenticated Node server
        → that customer's isolated Overskill workspace
            → managed generation, deployment, and credit services
```

Live customer sign-in uses OpenID Connect Authorization Code flow with PKCE. A trusted issuer and subject identify the customer; matching email addresses never merge accounts. Each customer gets an immutable external creator ID. The server holds the partner key for provisioning and an encrypted creator key for that customer's app operations. The browser cannot choose another customer, payer, or backend workspace.

**Stage one uses existing Overskill packs and creator-workspace billing.** Each customer's builds use that customer's Overskill workspace balance. The live adapter reads that creator's effective canonical offers and can request checkout through the gated `creator-credit-packs-v1` core contract. The customer selects only an existing pack; the server determines the creator, offer and idempotency key. The UI presents an explicit Whop checkout link and reads purchase status from Overskill. It does not infer payment from a checkout return or add credits optimistically.

The starter saves a durable purchase intent before its one checkout dispatch. This is a transport journal for recovery and status display, **not a credit ledger**: Overskill remains responsible for payment fulfillment, refunds and available balance. An uncertain result is recovered through authenticated status reads using the saved core purchase ID or idempotency key. Failed status reads preserve the last confirmed facts, hide checkout links and block another purchase until a successful refresh. The starter adds no shared operator wallet, operator-controlled packs, merchant enrollment flow or affiliate commission system. Customers do not supply model API keys.

Whop checkout links can be reused. Preventing duplicate checkout creation in this app is not a guarantee of only one payment through a link. Unknown or abandoned purchases need manual reconciliation; there is no automatic cancellation, expiration recovery or blind retry. See [CUSTOMER_AUTH.md](CUSTOMER_AUTH.md#creator-credit-pack-checkout) for the contract and operational boundaries.

Balances and recorded gross usage are observations, not invoices, spending caps, or proof of an isolated provider wallet. Unknown values remain unknown. Generation pauses when no usable credit snapshot is available. Existing core workspace billing and auto-top-up policies still apply to live activity.

## Live readiness

The local demo is usable now. A hosted paid pilot still depends on the following integration work and acceptance evidence:

| Area | Implemented in the reference | Remaining for a hosted pilot |
| --- | --- | --- |
| Identity and saved apps | OIDC adapter, encrypted server credentials, SQLite ownership, durable operation locks | Configure and verify a real identity provider, persistent host, backups, rate limits, monitoring, and recovery procedure |
| Creator provisioning | Stable external identity and read-only capability check before creation | Deploy and verify the compatible Overskill core contract and approved partner access |
| Usage and credits | Creator-scoped read adapter; unavailable telemetry stops new generation | Deploy and verify the core gross-usage/current-balance contract and the pilot's actual funding/cap policy |
| Existing packs | Gated creator-bound offers, durable checkout intent, read-by-key recovery, purchase/refund status and explicit Whop link | Deploy and review the exact compatible core contract and its stable creator-identity dependency; keep the core feature gate OFF until configured real purchase, fulfillment and refund acceptance passes |
| Publication | Preflight compatibility check, tracked request receipt and exact-deployment status read | Deploy and verify compatible core support and a real production deployment; a request or an old app URL is not publication proof |

The core creator-pack feature gate defaults to OFF. The starter exposes checkout only when the reviewed backend explicitly advertises the exact supported version as available for that creator. Neither a generic catalog endpoint nor an older checkout route is a fallback.

Do not infer production readiness from a successful local demo, fixture checkout, unit test, sign-in or catalog read. Live calls can create workspaces, start real checkout sessions, consume credits and request deployments. Live provisioning can also invoke core account-setup jobs. Confirm the approved customer, spending policy and relevant backend support before enabling live writes. A real end-to-end payment and refund acceptance run remains required; fixture status changes are not payment evidence.

No merge of all customers into one Team is required for this model. Operator-funded usage and partner-specific purchase attribution are possible future contracts, not capabilities shipped in this reference.

## Configuration

Start from [.env.example](.env.example). All API keys, encryption material, client secrets, and operator tokens stay server-side. Customer identity configuration is described in [CUSTOMER_AUTH.md](CUSTOMER_AUTH.md).

For a live customer adapter, configure the canonical application origin, trusted OIDC issuer/client, stable encryption key, persistent data directory, and approved Overskill partner access. The shared API adapter also requires explicit `OVERSKILL_LIVE_ENABLED=1` and a server-side operator token of at least 32 characters. That compatibility setting does not make the operator token a customer credential.

For the original `/builder` operator sandbox, additionally set `OPEN_OVERSKILL_CREATOR_EMAIL` and a durable `OVERSKILL_CREATOR_ID`. In `/workspace`, both the verified email and immutable creator ID come from the authenticated customer record instead; do not put a shared creator ID into browser requests.

Use `npm run doctor -- --customer` for `/workspace`. It checks configuration shape with the runtime's origin, OIDC and encryption rules, the Node/SQLite runtime requirement, and existing storage permissions without opening a database, contacting providers, creating files, or printing configuration values. Live customer readiness requires an explicit API base and application origin, OIDC issuer/client ID, a canonical 32-byte base64 encryption key, and an existing private writable absolute data directory; hosted HTTPS origins also require explicit opt-in. It does not require the operator creator email/ID fixtures.

`npm run doctor -- --customer --production` selects production environment-file precedence. A passing report cannot prove provider registration, credentials/scopes, real sign-in, persistent-volume durability, backups, deployed core support, approved funding/caps or checkout acceptance. Without `--customer`, `doctor` retains the original operator checks. Neither mode certifies a production release.

## Hosting and data boundaries

The customer backend targets **one Node process with persistent disk**. It uses `node:sqlite`, which is experimental in Node 22. It is not an edge-worker or ephemeral-filesystem deployment. Several instances require a shared transactional store that preserves identity, ownership, locking, and credential protections.

Customer state defaults to `.data/`, with separate demo and live databases. Creator keys and pending OIDC secrets are encrypted; profiles, prompts, transcripts and purchase journal entries still require protected disk and backups. Never publish databases, environment files, encryption keys, backups, private briefs, or old Git history with a source release.

Public customer sign-in requires an explicitly configured HTTPS origin and reverse proxy. The original operator routes remain loopback-only. Preview embedding needs an approved HTTPS origin; a sandboxed preview may not support every authenticated app feature, so use its external preview link when needed. Incoming webhook routes remain disabled; this reference polls authenticated status reads instead.

Ambiguous build or publication submissions remain held for reconciliation. Restarting the server does not clear those locks or justify repeating a potentially accepted operation. The UI labels unresolved app submissions **Needs review** and does not automatically retry writes. Purchase intent state also persists across restart; pending or uncertain checkout requests prevent another checkout and offer read-only status refresh. Automatic purchase checks stop after two minutes; manual refresh remains available.

## Checks

```sh
npm run typecheck
npm run test:security
npm run test:cli
npm run test:builder
npm run test:credits
npm run test:customers
npm run build
```

Tests use local fixtures and temporary stores. Customer tests cover identity verification, session boundaries, restart persistence, customer isolation, encrypted credentials, pending-operation locks, app-state concurrency and purchase-intent recovery. Browser fixture acceptance also exercises catalog selection, checkout status, simulated completion/refund balance reads and recovery after a lost checkout response, without following a real Whop checkout link. These checks are not evidence of real identity-provider onboarding, paid generation, payment settlement or public deployment. Exercise the configured customer journey in a browser as well.

## License and service boundary

The original code and documentation in the public source export are licensed under the standard MIT text included as `LICENSE`. In the development repository, that release-specific file is `release/LICENSE`; the export maps it to `LICENSE`. This grant covers the exported originals and does not relicense private source history or files outside the export. Third-party dependencies retain their own licenses and notices, summarized in the exported `THIRD_PARTY_NOTICES.md`.

API access, hosted generation pipelines, credits and other managed Overskill services are separate from the source license. Brand and trademark permissions are separate as well. The MIT release does not provide access to private core code or imply that the hosted paid service has launched.

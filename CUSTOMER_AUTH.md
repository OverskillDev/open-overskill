# Customer authentication and durable workspaces

The `/workspace` reference is the primary customer flow: sign in, provision a workspace, create or reopen an app, edit, preview, request publication and, when the compatible core contract is enabled, buy an existing credit pack. Its accounts are separate from the older `/builder` operator sandbox. The customer APIs run on Node, persist identity, app metadata and purchase transport records to SQLite, and retain each creator key on the server. They do not create another credit ledger.

## Local demonstration

Use Node 22.23 or newer. Node's `node:sqlite` is experimental on Node 22; this reference deliberately targets one instance with persistent local disk, not an edge worker or ephemeral serverless filesystem.

Set `OVERSKILL_MOCK=1` and open the configured loopback origin (default `http://127.0.0.1:3577`). Alice and Bob are fixed fictional identities. Their customer IDs and app lists persist across sign-out and server restart. The demo never creates real provider accounts or calls an identity provider. Their example.invalid email addresses are not verified and must not be used for live provisioning.

Demo mode is unavailable on a public host. Switching into live mode uses a separate database and cannot turn a simulated session into a live session.

The demo balance is illustrative and does not fund generation. Demo mode offers no credit-pack catalog, prices or purchases. **Publish demo** saves local publication state and opens an authenticated local preview; it does not create a public website. The original `/builder` simulator still uses process-local state, so its restart behavior differs from `/workspace`.

## Configuring verified sign-in

The live adapter uses standard OpenID Connect Authorization Code flow with PKCE. Configure an identity provider separately and register this exact callback:

```text
https://your-builder.example/api/customer/callback
```

Configure these server-only variables:

| Variable | Purpose |
| --- | --- |
| `OVERSKILL_MOCK=0` | Select live identity storage. This alone does not authorize generation or charges. |
| `OPEN_OVERSKILL_ORIGIN` | Exact application origin; no path, query or credentials. |
| `OPEN_OVERSKILL_HOSTED=1` | Explicit opt-in for a non-loopback HTTPS origin. |
| `OPEN_OVERSKILL_OIDC_ISSUER` | Exact trusted HTTPS OIDC issuer, matching the provider's issuer metadata. |
| `OPEN_OVERSKILL_OIDC_CLIENT_ID` | Registered OIDC application ID. |
| `OPEN_OVERSKILL_OIDC_CLIENT_SECRET` | Client secret when required; the default client authentication uses client_secret_post. |
| `OPEN_OVERSKILL_ENCRYPTION_KEY` | A stable, securely generated 32-byte key encoded as base64. Required for live storage. |
| `OPEN_OVERSKILL_DATA_DIR` | Absolute directory on persistent private disk, mode 0700. Defaults to `.data` in the project directory. |

The identity provider must issue an ID token containing `sub`, `email`, and `email_verified: true`. The OIDC library verifies issuer, audience, expiry, nonce and signature. Identity is keyed by **trusted issuer plus subject**. Email is profile data; accounts are never merged or relinked because their emails match. An immutable random `externalCreatorId` maps that customer to the partner API.

The identity implementation is exercised with a protocol fixture. It does not establish that a real provider or a public deployment has been configured. Live workspace provisioning, verified core API support, and paid pack checkout have their own readiness requirements; do not infer those from successful sign-in.

### Read-only configuration check

Run `npm run doctor -- --customer` for the customer workspace, or `npm run doctor -- --customer --production` to use production environment-file precedence. This mode uses the runtime's pure origin, OIDC and encryption validators, checks the Node/SQLite runtime requirement, and inspects existing directory/database metadata as the current OS user. It does not open SQLite, contact an identity provider or core API, write files, create directories, change permissions or print configuration values.

In live mode, this diagnostic requires an explicit `OVERSKILL_API_BASE`, `OPEN_OVERSKILL_ORIGIN` and `OPEN_OVERSKILL_DATA_DIR`, plus the live API settings and identity/encryption settings above. The data directory must already exist, be private and writable, and use an absolute path; the directory and any existing database must not be symlinks. This is deliberately stricter than the runtime's default data path. An absent default demo directory is allowed and left absent. Legacy `OPEN_OVERSKILL_CREATOR_EMAIL` and `OVERSKILL_CREATOR_ID` are not customer requirements; omit `--customer` to check the original operator sandbox instead.

Passing means the inspected local configuration is shaped correctly. It does not prove issuer ownership, provider registration/callback/scopes, client-secret requirements, real sign-in, encryption-key entropy or recovery, durable volumes/backups, database integrity, deployed core capabilities, approved customers, spending caps or paid acceptance. Complete those operational checks separately before enabling real operations.

## Core API and billing requirements

The shared API adapter needs approved server-side partner credentials, `OVERSKILL_LIVE_ENABLED=1`, and a server-side `OPEN_OVERSKILL_OPERATOR_TOKEN` of at least 32 characters. This token is a compatibility requirement of the shared live guard; customer authentication uses the OIDC session. `/workspace` gets the verified email and immutable creator ID from its authenticated record, so the original operator fixture variables do not select its customer or payer.

Before it creates a live creator workspace, the adapter reads the core stable-identity capability. A missing or incompatible contract blocks creation. Core support for that identity mapping and the gross-usage/current-balance meter must be deployed and verified for the intended pilot. A local capability fixture does not establish live support.

Each customer's app operations use that customer's creator key and Overskill Team. Generation debits that workspace under existing core billing settings. The reference supports existing-pack checkout and purchase-status reconciliation through the gated creator-bound core contract described below. Payment fulfillment, refund handling and balance accounting remain in Overskill's existing core services. The reference does not automatically enroll merchants, create affiliate arrangements or move usage to the operator's wallet.

Publication remains a separate compatibility and acceptance gate. The customer adapter requires the `request-v1` deployment-tracking capability before dispatch, records the tracked deployment ID and must see that exact deployment reported as deployed in production, with a production URL, before it says **Published**. Deploy and verify that compatible contract against core before enabling a hosted pilot; sign-in or a prior production URL cannot substitute for it.

## Creator credit-pack checkout

The core creator-pack feature gate defaults to OFF. Checkout requires the reviewed `creator-credit-packs-v1` contract, its stable creator-identity dependency, approved partner configuration and an existing authenticated creator workspace. A live host must also meet the identity, gross-usage/current-balance and operational acceptance requirements above. Local fixtures do not establish that any of those backend capabilities are deployed or enabled.

The server adapter uses these creator-authenticated core endpoints:

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/creator_credit_pack_checkouts/capabilities` | Require the exact contract version and `available: true`; read the creator's effective canonical offers |
| `POST /api/v1/creator_credit_pack_checkouts` | Submit an existing `pack_id` with the server's durable `Idempotency-Key` |
| `GET /api/v1/creator_credit_pack_checkouts/by_key/:key` | Recover the existing purchase when a checkout response was lost |
| `GET /api/v1/creator_credit_pack_checkouts/:id` | Read the known purchase's authoritative status |

The browser sends only `{ packId }` to `POST /api/workspace/purchases`. It cannot supply a payer, price, credit quantity, redirect URL or idempotency key. The server first checks the creator-scoped capability and offer, saves a customer-owned intent and random key, and only then dispatches the checkout request once. `GET /api/workspace/purchases` reads that customer's latest local intent and refreshes it from core by saved purchase ID or key. It does not create or repeat checkout.

The local intent table is a **durable transport journal, not a ledger**. It tracks request identity and last observed purchase state so sign-out, lost responses and restart do not cause blind retries. A pending or uncertain intent holds further checkout creation. A definite pre-submission rejection can be shown as rejected. Unknown outcomes, failed or expired payments, and abandoned checkouts require manual reconciliation; there is no automatic cancellation or operator recovery screen. Preserve the journal and reconcile with core before releasing a held intent.

The UI presents only an explicit HTTPS `whop.com` checkout link. It does not open checkout automatically or treat a `purchase_id` return query as a purchase selector, proof of payment or permission to grant credits. That query only opens the account pane; authenticated server reads establish state. Automatic read-only polling lasts at most two minutes, followed by manual **Refresh purchase**. Whop checkout links can be reused: one starter dispatch does not guarantee only one payment through the resulting link.

Purchase state and read availability are separate. A failed status read preserves the last confirmed payment/refund facts and exposes `readAvailable: false`, hides the checkout link and blocks another purchase until a successful refresh. A fresh core response reporting a credit grant triggers a separate balance read; the browser never increments balances itself. Refund and partial-refund status are displayed from core, with current available credits shown independently. This starter does not implement a second fulfillment or refund writer.

Before a hosted paid pilot, review and configure the exact core contract, then verify a real customer checkout through payment, authoritative status, existing-core fulfillment, balance change and refund handling. Reusable-link behavior and manual recovery also need acceptance. Browser fixtures for completed/refunded states are not real payment evidence. Availability of the MIT-licensed reference source does not establish readiness for a hosted paid service.

## Browser and session boundaries

- Mutating customer APIs require the exact configured `Origin`. Cross-site and sibling-site requests fail closed.
- Workspace mutations also require `X-Open-Overskill-Customer` to match the authenticated customer. Reads enforce the same assertion when supplied. This detects a stale tab after another tab changes accounts; it never replaces session authentication, and the UI reloads without replaying the rejected action.
- Request host validation uses the canonical configured origin. Forwarded headers do not choose the origin. A reverse proxy must preserve the public Host header; the Node service should not be directly exposed.
- Login uses ten-minute, single-use state encrypted at rest and bound to an independent HttpOnly browser cookie. The state is consumed atomically before exchanging the code. PKCE and nonce are mandatory.
- The callback accepts the expected cross-site top-level GET but still validates host, browser binding, state, PKCE and nonce. It redirects only to `/workspace`.
- Customer sessions are random, stored only as SHA-256 hashes, and have an absolute eight-hour expiry. Cookies are host-only, HttpOnly and SameSite=Lax, with Secure for HTTPS origins. Login rotates the browser's previous session; logout deletes the server session and clears cookies.
- Live and demo sessions use separate databases. Invalid origins, credentials and upstream errors are never echoed with provider secrets.

## Durable data and credentials

SQLite stores identity profiles, session hashes, app metadata, operation records and customer-scoped purchase journal entries. Creator credentials and pending OIDC secrets use AES-256-GCM, with authenticated context binding encrypted records to their owner. Database files use mode 0600. The `.data` directory, database files, encryption material, environment files, backups and identity records must be excluded from Git and public exports.

The demo generates its own private local key under `.data`; live mode refuses to generate one automatically. Back up the database and live key securely as separate secrets. Losing the key requires explicit credential recovery. Replacing it without a migration fails decryption; it does not safely rotate existing records. Profile information, prompts and app transcripts are database content, not field-encrypted secrets, so storage/backups also need access controls and appropriate disk encryption.

The app table scopes every lookup by customer ID, keeps backend app bindings immutable after their first assignment, and rejects a backend app ID assigned to two customers. A compare-and-swap write prevents stale network polling from overwriting newer build/deploy state.

Provisioning and mutation locks persist across restart. An ambiguous provider outcome remains held for explicit reconciliation; restarting the process is never a reason to resend a possibly successful paid operation. A pending app row can exist before it receives its backend app ID. The API layer is responsible for explaining the held state and using the provider's authoritative status before resuming.

This reference does not include shared multi-instance database support, automated key rotation, account deletion/export operations, or provider-specific account-linking and recovery UX. Configure perimeter rate limits and monitoring before a public pilot. Moving to several instances requires a shared transactional store and retaining the same identity, locking, encryption and ownership invariants.

## Verification

Run:

```sh
npm run test:customers
```

The identity tests use real `openid-client` validation with an intercepted HTTPS protocol fixture and signed test ID tokens. They check PKCE, issuer/audience/nonce/expiry/signature rejection, verified email, browser binding, callback replay, same-origin and stale-tab mutation guards, session revocation, identity isolation, encrypted secrets, restart persistence, pending-operation locks and stale-write rejection. Workspace and purchase tests exercise customer-scoped app/credit adapters, durable intent identity, lost-response recovery, and unavailable reads that must not reactivate settled purchases. These suites use local fixtures rather than creating real provider accounts or payments.

The browser fixture flow covers catalog selection, a single checkout dispatch, an explicit checkout link, synthetic completion and refund with separately read balances, and GET recovery of an intent after a lost response. No real Whop link is followed during that fixture flow. Real end-to-end identity, generation, payment and deployment acceptance remains separate.

References: [openid-client Authorization Code Grant](https://github.com/panva/openid-client/blob/main/docs/functions/authorizationCodeGrant.md), [discovery](https://github.com/panva/openid-client/blob/main/docs/functions/discovery.md), [ID-token signature validation](https://github.com/panva/openid-client/blob/main/docs/functions/enableNonRepudiationChecks.md).

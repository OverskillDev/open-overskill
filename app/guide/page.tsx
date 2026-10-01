import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
export default function GuidePage() {
  return (
    <>
      <SiteHeader />
      <main className="guide">
        <div className="eyebrow">THE QUICKSTART</div>
        <h1>
          A working starting point.
          <br />
          <span>Then make it yours.</span>
        </h1>
        <p className="guide-lead">
          Start with the complete builder or bring individual components into
          your product. Both connect to the same managed Overskill API.
        </p>
        <section>
          <h2>01 / Run the starter</h2>
          <p>
            From your pilot checkout, install the dependencies and start the
            local server. Demo mode simulates generation and deployment without
            spending credits.
          </p>
          <pre>
            <code>{"npm ci\nnpm run setup\nnpm run doctor\nnpm run dev\n# Open http://localhost:3577"}</code>
          </pre>
          <p>
            Setup creates your local configuration in demo mode and keeps any
            existing configuration. Doctor checks readiness without calling
            Overskill or spending credits. The demo is self-serve; live partner
            access is currently arranged with the Overskill team.
          </p>
          <Link className="text-link" href="/builder">
            Try the demo here <ArrowRight size={16} />
          </Link>
        </section>
        <section>
          <h2>02 / Make the surface yours</h2>
          <div className="guide-files">
            <div>
              <code>lib/builder-config.ts</code>
              <span>Name and public links</span>
            </div>
            <div>
              <code>app/globals.css</code>
              <span>Colors, typography, and motion</span>
            </div>
            <div>
              <code>lib/creator-context.ts</code>
              <span>Example customer brief and starter prompts</span>
            </div>
            <div>
              <code>components/builder/</code>
              <span>Prompt, transcript, and preview elements</span>
            </div>
          </div>
          <p>
            The included creator is fictional. Replace the fixture with data
            authorized for the signed-in creator before a multi-user rollout.
          </p>
        </section>
        <section id="architecture">
          <h2>03 / Connect to Overskill</h2>
          <p>
            Your browser calls this starter’s server. The server holds the
            partner key and a separate creator key; Overskill handles
            generation, hosting, and credit enforcement.
          </p>
          <div className="architecture-strip">
            <span>Your UI</span>
            <ArrowRight />
            <span>Your server</span>
            <ArrowRight />
            <span>Overskill API</span>
          </div>
          <p>
            Partner access is provisioned with the Overskill team. Configure
            your server-only environment, keep it bound to localhost, and unlock
            the studio with your local operator token.
          </p>
          <pre>
            <code>
              {
                "OVERSKILL_MOCK=0\nOVERSKILL_LIVE_ENABLED=1\nOVERSKILL_API_BASE=https://www.overskill.com\nOVERSKILL_PARTNER_API_KEY=<partner-key>\nOPEN_OVERSKILL_OPERATOR_TOKEN=<random-32-or-more-characters>\nOVERSKILL_CREATOR_ID=<stable-internal-creator-id>\nOPEN_OVERSKILL_CREATOR_EMAIL=<your-pilot-creator-email>"
              }
            </code>
          </pre>
          <p>
            Use a stable internal creator ID from your own system, not an email
            address or a new random value on each restart. The server checks
            creator-identity support before creating a workspace; older backends
            are refused. An existing workspace can require explicit key recovery,
            which replaces its previous builder key before you submit a build.
          </p>
          <p>
            Live calls can consume credits and create workspaces or deployments.
            Live preview embedding requires an approved HTTPS partner origin;
            use the external preview link when localhost embedding is blocked.
            This local pilot uses expiring in-memory sessions; a server restart
            clears the session. It is not a hosted multi-user service.
          </p>
          <a
            className="text-link"
            href="https://www.overskill.com/developers/partners"
          >
            Read the partner API contract <ArrowUpRight size={16} />
          </a>
        </section>
        <section id="components">
          <h2>Bring the pieces into your product</h2>
          <p>
            Use the full Editor for the included build flow, or compose these
            React elements with useBuilder in your own layout. They live in the
            starter source today; there is no separate package to install.
          </p>
          <div className="guide-files">
            <div><code>PromptComposer</code><span>Prompt, suggestions, submission and busy state</span></div>
            <div><code>BuildTranscript</code><span>Build messages and tool progress</span></div>
            <div><code>PreviewPanel</code><span>Preview sizing, external link and embed copy</span></div>
            <div><code>CreditAccountNotice</code><span>Creator workspace, recorded usage, balance and holds</span></div>
          </div>
          <pre><code>{`import { Editor } from "@/components/Editor";

export default function BuilderPage() {
  return <Editor />;
}`}</code></pre>
          <p>
            Keep the starter’s server routes and styles when using Editor.
            Individual components only render the state you pass them; your
            server handles authentication, creator scope, API requests, and
            credit checks. See COMPONENTS.md in the checkout for the prop
            contracts and integration map.
          </p>
          <Link className="text-link" href="/examples/minimal">
            Try the minimal composition <ArrowRight size={16} />
          </Link>
          <p>
            Need help fitting the kit into an existing product? Implementation
            support can be scoped during the pilot. A fully branded service
            with custom onboarding is a separate partnership.
          </p>
        </section>
        <section id="credits">
          <h2>Know which workspace uses credits</h2>
          <p>
            Live builds use the creator workspace’s Overskill credits. Existing
            workspace billing settings apply. Partner sponsorship is not supported
            by this starter, and the demo’s example balance cannot fund live builds.
          </p>
          <p>
            On a compatible backend, the read-only notice shows recorded gross
            generation usage for a dated window, spendable credits and pending
            holds. Details distinguish cached Whop data and reported billing
            settings. The versioned meter is a draft backend dependency; an older
            API can show a labeled partial legacy balance instead. Refunds, net
            charges and app-specific trial coverage are not included. Unknown
            stays unknown. This is not a spending cap or a funding guarantee;
            credit enforcement stays in Overskill.
          </p>
        </section>
        <section>
          <h2>Before your first real customers</h2>
          <p>
            Replace the local operator login with verified customer identity,
            durable encrypted credential storage, workspace authorization,
            quotas, and audit records. Confirm creator credit responsibility
            with Overskill. Merchant onboarding is a separate step for enabling
            payments; this starter does not manage it or collect payments.
          </p>
          <p>
            The intended open layer is the interface and integration code.
            Overskill’s orchestration, prompts, runtime services, credit ledger,
            and payment infrastructure remain managed. Public release and
            license selection are pending.
          </p>
        </section>
      </main>
    </>
  );
}

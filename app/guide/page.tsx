import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { overskillLinks } from "@/lib/builder-config";
export const metadata = { title: "Quickstart" };
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
          Start with a customer workspace, make the interface yours, and
          connect it to the managed Overskill API.
        </p>
        <section>
          <h2>01 / Run the starter</h2>
          <p>
            Use Node 22.23 or newer. Install the dependencies and start the
            local server. Demo mode uses fictional customers and simulates
            generation, credits and publication without provider calls.
          </p>
          <pre>
            <code>{"npm ci\nnpm run setup\nnpm run doctor -- --customer\nnpm run dev\n# Open http://127.0.0.1:3577/workspace"}</code>
          </pre>
          <p>
            Continue as Alice, create an app, edit it, and reopen it after
            signing out. Bob has a separate workspace. App records persist in
            the local SQLite store; previews use a fixed template. Use the exact
            configured origin: localhost and 127.0.0.1 are different origins.
          </p>
          <Link className="text-link" href="/workspace">
            Open the customer demo <ArrowRight size={16} />
          </Link>
        </section>
        <section>
          <h2>02 / Make the surface yours</h2>
          <div className="guide-files">
            <div>
              <code>lib/builder-config.ts</code>
              <span>Shared brand name, studio label, page metadata and public docs link</span>
            </div>
            <div>
              <code>app/globals.css</code>
              <span>Colors, typography, and motion</span>
            </div>
            <div>
              <code>components/workspace/Workspace.tsx</code>
              <span>Customer dashboard, account view and app editor</span>
            </div>
            <div>
              <code>components/workspace/workspace.module.css</code>
              <span>Customer layout and styling</span>
            </div>
            <div>
              <code>components/builder/</code>
              <span>Prompt, transcript, and preview elements</span>
            </div>
          </div>
          <p>
            Change the public brand settings and rebuild. The shared name
            appears in the headers, footer and page titles. Managed-service
            attribution stays separate. Branding does not change partner
            identity, customer ownership or the workspace that pays for a build.
          </p>
        </section>
        <section id="architecture">
          <h2>03 / Connect to Overskill</h2>
          <p>
            Your browser calls this starter’s server. The server holds the
            partner key and each customer’s encrypted creator key. Each customer
            has an isolated creator workspace; Overskill handles generation,
            hosting and credit enforcement.
          </p>
          <div className="architecture-strip">
            <span>Your UI</span>
            <ArrowRight />
            <span>Your server</span>
            <ArrowRight />
            <span>Overskill API</span>
          </div>
          <p>
            Live partner access is arranged with the Overskill team. Configure
            a trusted OpenID Connect provider, a canonical HTTPS origin,
            server-side encryption and persistent storage. Verified issuer and
            subject identify each customer; matching email addresses do not
            merge accounts. See CUSTOMER_AUTH.md and .env.example for the
            server configuration.
          </p>
          <pre>
            <code>
              {
                "npm run doctor -- --customer --production\nnpm run build"
              }
            </code>
          </pre>
          <p>
            Customer identity, app ownership and pending operations persist
            across restart. The browser cannot select another customer’s
            workspace or payer. The server checks compatible core contracts
            before provisioning, checkout and publication. Keep API keys and
            encryption material out of browser code and source releases.
          </p>
          <p>
            Host one Node process with persistent disk and a TLS reverse proxy.
            The local doctor checks configuration and existing storage
            permissions without contacting providers. It cannot verify a real
            sign-in, payment or deployment. Preview embedding requires an
            approved HTTPS partner origin; the external preview link is also
            available.
          </p>
          <a
            className="text-link"
            href={overskillLinks.docsUrl}
          >
            Read the partner API contract <ArrowUpRight size={16} />
          </a>
        </section>
        <section id="components">
          <h2>Bring the pieces into your product</h2>
          <p>
            The original local operator sandbox provides Editor and useBuilder
            as a small composition example. These source components are useful
            when integrating into an existing product. The customer reference
            lives separately in components/workspace and uses its durable
            customer routes. There is no separate package to install.
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
            Keep the original server routes and styles when using Editor.
            Its operator session is local and expires on restart. Individual
            components render the state you pass them; your server handles
            authentication, creator scope, API requests and credit checks.
            See COMPONENTS.md for the prop contracts and integration map.
          </p>
          <Link className="text-link" href="/examples/minimal">
            Try the minimal composition <ArrowRight size={16} />
          </Link>
          <p>
            The customer workspace is the full reference for an agency or
            standalone builder. An existing software platform can adapt the
            interface and server integration to its own verified customer
            identity and product experience.
          </p>
        </section>
        <section id="credits">
          <h2>Know which workspace uses credits</h2>
          <p>
            Stage one uses existing Overskill packs. Each customer’s builds use
            that customer’s creator-workspace balance and existing billing
            settings. Model access is managed by Overskill; customers do not
            supply model API keys. Operator-funded usage, custom packs and
            partner commissions are future possibilities.
          </p>
          <p>
            On a compatible, explicitly enabled core backend, the account view
            shows the creator’s available packs and an explicit Whop checkout
            link. Overskill confirms payment, grants credits and handles
            refunds. Returning from checkout does not prove payment. The
            starter records purchase status for recovery; it does not maintain
            a second credit ledger. The local demo creates no purchases.
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
            Configure and verify the real identity provider, persistent host,
            backups, rate limits and recovery procedure. Release the compatible
            core contracts, agree the initial funding and spending limits, and
            test actual sign-in, purchase, fulfillment, refund, generation and
            publication. The hosted paid experience is pending those checks.
            Merchant onboarding remains a separate rollout.
          </p>
          <p>
            The original exported interface and integration code have an MIT
            license, with separate third-party notices. Publication of the
            reviewed repository is pending. Overskill’s generation pipelines,
            internal prompts, runtime services, credit ledger and payment
            infrastructure remain managed services. The source license does
            not grant access to private code or managed services.
          </p>
        </section>
      </main>
    </>
  );
}

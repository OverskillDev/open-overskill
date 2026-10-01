import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Code2,
  Layers3,
  Radio,
  PanelLeft,
  Braces,
  Globe2,
  Terminal,
} from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { builderConfig, overskillLinks } from "@/lib/builder-config";

export default function Page() {
  return (
    <>
      <SiteHeader />
      <main className="home-main">
        <section className="hero">
          <div className="eyebrow">
            <span className="status-dot" /> THE BUILDER BEHIND YOUR BUILDER
          </div>
          <h1>
            Your idea.
            <br />
            Your AI app builder.
            <br />
            <span>Built on Overskill.</span>
          </h1>
          <p className="hero-description">
            Start with a working builder. Make the interface yours.
            <br className="desktop-break" /> Connect to Overskill for
            generation, previews, and deployment.
          </p>
          <div className="hero-actions">
            <Link className="button primary" href="/workspace">
              Try the builder <ArrowRight size={17} />
            </Link>
            <Link className="button secondary" href="/guide">
              <Terminal size={17} /> Explore the quickstart
            </Link>
          </div>
          <p className="hero-note">
            Local demo included. No API key needed to explore.
          </p>
          <div
            className="hero-preview"
            aria-label="Illustration of a custom builder connected to Overskill"
          >
            <div className="preview-top">
              <div className="window-dots">
                <i />
                <i />
                <i />
              </div>
              <span>your-builder / workspace</span>
              <span className="preview-label">YOUR BRAND HERE</span>
            </div>
            <div className="preview-body">
              <div className="preview-conversation">
                <div className="small-label">YOUR BUILDER</div>
                <div className="sample-prompt">
                  Build a portal for my community. Give members a place to
                  learn, connect, and book a call.
                </div>
                <div className="sample-response">
                  <span className="mini-mark">✳</span>
                  <div>
                    From the first prompt
                    <br />
                    <span className="muted">to a working app.</span>
                  </div>
                </div>
                <div className="sample-task">
                  <Check size={14} /> App structure
                </div>
                <div className="sample-task">
                  <Check size={14} /> Pages and components
                </div>
                <div className="sample-task">
                  <Check size={14} /> Preview ready
                </div>
                <div className="sample-input">
                  What would you like to build?<span>↑</span>
                </div>
              </div>
              <div className="preview-app">
                <div className="sample-app-nav">
                  <strong>
                    Fieldwork<span>®</span>
                  </strong>
                  <span>My learning · Community</span>
                </div>
                <div className="sample-app-content">
                  <span className="small-label">
                    A LITTLE PROGRESS, EVERY DAY.
                  </span>
                  <h2>
                    Make room
                    <br />
                    for your next idea.
                  </h2>
                  <div className="sample-course-grid">
                    <div className="course-art art-one">
                      <span>01</span>
                      <strong>The starting point</strong>
                    </div>
                    <div className="course-art art-two">
                      <span>02</span>
                      <strong>Build your practice</strong>
                    </div>
                  </div>
                  <div className="sample-event">
                    <div>
                      <span className="small-label">NEXT UP</span>
                      <p>The weekly workshop</p>
                    </div>
                    <span>Thursday, 6pm ↗</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="preview-bottom">
              <span>
                <span className="status-dot" /> Your interface
              </span>
              <span>
                Overskill generation + runtime <ArrowUpRight size={12} />
              </span>
            </div>
          </div>
          <p className="caption">
            Example interface. Try the interactive demo to follow the full build
            flow.
          </p>
        </section>
        <section className="builder-paths" id="paths" aria-labelledby="paths-title">
          <div className="eyebrow">THREE WAYS TO BUILD ON OVERSKILL</div>
          <h2 id="paths-title">Start yourself. Add help where you need it.</h2>
          <p className="paths-intro">
            Start with the complete builder, bring the components into your
            product, or explore a custom partnership.
          </p>
          <div className="path-grid">
            <article className="path-card featured-path">
              <div className="small-label">01 / START HERE</div>
              <h3>Self-serve starter</h3>
              <p>
                Run the demo. Change your brand and prompts. Keep a working
                builder as your starting point.
              </p>
              <span className="path-status">Local demo ready · live access by arrangement</span>
              <Link className="button primary" href="/guide">
                Start with the kit <ArrowRight size={16} />
              </Link>
            </article>
            <article className="path-card">
              <div className="small-label">02 / FIT YOUR PRODUCT</div>
              <h3>Component integration</h3>
              <p>
                Use the composer, build conversation, and preview inside your
                own interface. Your team connects the experience.
              </p>
              <span className="path-status">Components included · implementation help in pilot</span>
              <Link className="button secondary" href="/guide#components">
                Explore the components <ArrowRight size={16} />
              </Link>
            </article>
            <article className="path-card">
              <div className="small-label">03 / BUILD TOGETHER</div>
              <h3>Custom partnership</h3>
              <p>
                A deeper branded builder for an established audience, with
                onboarding and integration scoped together.
              </p>
              <span className="path-status">Bespoke scope · by arrangement</span>
              <a className="button secondary" href="mailto:sales@overskill.com?subject=Custom%20builder%20partnership">
                Discuss a partnership <ArrowUpRight size={16} />
              </a>
            </article>
          </div>
        </section>
        <section className="section-intro">
          <div className="eyebrow">A STARTING POINT YOU CAN SHAPE</div>
          <h2>
            Build for the people
            <br />
            you already understand.
          </h2>
          <p>
            A community platform. A focused tool for your industry. An AI
            builder inside your existing product. Start with the surface your
            customers need.
          </p>
        </section>
        <section className="feature-grid" aria-label="Builder components">
          {[
            {
              icon: PanelLeft,
              title: "Your interface",
              text: "Shape the prompt composer, build conversation, preview, and publishing experience.",
            },
            {
              icon: Braces,
              title: "Your customer context",
              text: "Pass an approved brief into each build so the app starts with the right audience and brand.",
            },
            {
              icon: Globe2,
              title: "Overskill underneath",
              text: "Connect your server to the partner API for workspace provisioning, generation, previews, and deploys.",
            },
          ].map(({ icon: Icon, title, text }) => (
            <article className="feature" key={title}>
              <Icon size={24} />
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </section>
        <section className="boundary-section">
          <div>
            <div className="eyebrow">A CLEAR DIVISION OF WORK</div>
            <h2>
              Own the experience.
              <br />
              Connect to the engine.
            </h2>
            <p>
              Customize the starter without rebuilding an app generation
              platform.
            </p>
            <Link className="text-link" href="/guide#architecture">
              Explore the architecture <ArrowRight size={16} />
            </Link>
          </div>
          <div className="boundary-stack">
            <div className="boundary-card">
              <div className="small-label">
                <Code2 size={16} /> IN YOUR STARTER
              </div>
              <h3>Brand. Components. API adapter.</h3>
              <p>
                Your builder shell, prompt and transcript components, preview
                panel, and server integration.
              </p>
              <div className="tag-row">
                <span>Next.js</span>
                <span>React</span>
                <span>TypeScript</span>
              </div>
            </div>
            <div className="connection-line">
              <span /> Server-to-server API <span />
            </div>
            <div className="boundary-card managed">
              <div className="small-label">
                <Layers3 size={16} /> MANAGED BY OVERSKILL
              </div>
              <h3>Generation. Runtime. Credits.</h3>
              <p>
                Generation orchestration, model routing, hosted deployment, and
                usage enforcement stay on Overskill.
              </p>
            </div>
          </div>
        </section>
        <section className="steps-section">
          <div className="eyebrow">FROM DEMO TO YOUR BUILDER</div>
          <h2>Start small. Make it yours.</h2>
          <div className="steps-grid">
            {[
              [
                "01",
                "Explore the demo",
                "Follow a simulated build from prompt to preview. No setup or credits required.",
              ],
              [
                "02",
                "Shape the experience",
                "Change the brand settings, starter prompts, and customer context. Reuse the builder components.",
              ],
              [
                "03",
                "Connect with Overskill",
                "Work with the team to provision partner access, then test the live flow in a controlled pilot.",
              ],
            ].map(([n, t, d]) => (
              <article key={n}>
                <span className="step-number">{n}</span>
                <h3>{t}</h3>
                <p>{d}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="pilot-banner">
          <Radio size={26} />
          <div>
            <h3>Build alongside us.</h3>
            <p>
              Explore the starter locally. Stage one uses each creator
              workspace’s existing Overskill packs. Live access is arranged
              during the pilot; merchant rollout is separate.
            </p>
          </div>
          <a
            className="button secondary"
            href={overskillLinks.docsUrl}
          >
            Partner API <ArrowUpRight size={16} />
          </a>
        </section>
        <section className="closing">
          <div className="eyebrow">BUILD SOFTWARE WITH WORDS.</div>
          <h2>
            Let your customers
            <br />
            build with theirs.
          </h2>
          <Link className="button primary" href="/workspace">
            Open the builder <ArrowRight size={17} />
          </Link>
        </section>
      </main>
      <footer className="site-footer">
        <span>{builderConfig.name} · powered by Overskill</span>
        <div>
          <Link href="/guide">Quickstart</Link>
          <a href={overskillLinks.platformUrl}>
            Overskill <ArrowUpRight size={13} />
          </a>
        </div>
        <span>MIT-licensed starter · hosted pilot in preparation</span>
      </footer>
    </>
  );
}

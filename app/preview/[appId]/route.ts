import { getMockApp } from "@/lib/mock-engine";
import { creator } from "@/lib/creator-context";
import { apiError, PilotError, requireOwned, requireSession } from "@/lib/pilot-security";
import { isMock } from "@/lib/overskill";

export const dynamic = "force-dynamic";

// The rendered preview shown inside Open OverSkill's iframe (demo mode). It is a
// real, personalized mini-app built from the creator's sample creator context + the
// prompt — concrete proof that the injected context reached the build. In a live
// OverSkill wiring, the app's preview_url points at OverSkill's own preview host
// instead and this route is unused.
export async function GET(_req: Request, ctx: { params: Promise<{ appId: string }> }) {
  try {
  const session = requireSession(_req);
  if (!isMock()) throw new PilotError(404, "demo_preview_unavailable", "This preview route is for demo apps only.");
  const { appId } = await ctx.params;
  requireOwned(session, "app", appId);
  const app = getMockApp(appId);
  if (!app) throw new PilotError(404, "resource_not_found", "Demo app not found.");
  const isProd = new URL(_req.url).searchParams.get("env") === "production";

  const prompt = app?.prompt || "A members portal for your community";
  const accent = /^#[0-9a-f]{3,8}$/i.test(creator.brandKit.accent) ? creator.brandKit.accent : "#4b7bff";
  const courses = creator.courses;
  const community = creator.communities[0];
  const call = creator.calls[0];

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(creator.brand)}</title>
<style>
  :root { --accent: ${accent}; --ink:#1c1917; --muted:#78716c; --bg:#fffdf9; --card:#fff; --line:#f0e9df; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color:var(--ink); background:var(--bg); }
  .wrap { max-width: 720px; margin: 0 auto; padding: 0 20px 64px; }
  header { background: linear-gradient(135deg, var(--accent), #f4a259); color:#fff; padding: 40px 20px 48px; }
  header .inner { max-width:720px; margin:0 auto; }
  .kicker { text-transform:uppercase; letter-spacing:.12em; font-size:12px; opacity:.9; margin:0 0 6px; }
  h1 { margin:0 0 8px; font-size: 30px; line-height:1.1; }
  .lede { margin:0; font-size:16px; opacity:.95; max-width:52ch; }
  .cta { display:inline-block; margin-top:20px; background:#fff; color:var(--accent); font-weight:600; padding:11px 20px; border-radius:10px; text-decoration:none; }
  section { margin-top:32px; }
  h2 { font-size:18px; margin:0 0 14px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center; gap:12px; }
  .card h3 { margin:0 0 3px; font-size:15px; }
  .card p { margin:0; color:var(--muted); font-size:13px; }
  .price { font-weight:700; color:var(--accent); white-space:nowrap; }
  .pill { display:inline-block; background:#fff3e8; color:var(--accent); font-size:12px; font-weight:600; padding:5px 10px; border-radius:999px; }
  .track { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; }
  .bar { height:8px; background:#f0e9df; border-radius:999px; overflow:hidden; margin-top:8px; }
  .bar > i { display:block; height:100%; width:62%; background:var(--accent); }
  .brief { margin-top:32px; font-size:12px; color:var(--muted); border-top:1px dashed var(--line); padding-top:16px; }
  footer { text-align:center; color:var(--muted); font-size:12px; margin-top:40px; }
  .live { background:var(--card); border:1px solid var(--line); border-left:4px solid var(--accent); border-radius:12px; padding:14px 16px; }
</style>
</head>
<body>
  <header>
    <div class="inner">
      <p class="kicker">${isProd ? "Demo deployment" : "Simulated preview"} · Built for ${escapeHtml(creator.name)}</p>
      <h1>${escapeHtml(creator.brand)}</h1>
      <p class="lede">${escapeHtml(creator.niche)}. Your members portal — track your bakes, join the live call, and keep learning.</p>
      <a class="cta" href="#courses">Start baking →</a>
    </div>
  </header>
  <div class="wrap">
    <section id="track">
      <h2>Your bake tracker</h2>
      <div class="track">
        <strong>${escapeHtml(community.name)}</strong> · ${community.members.toLocaleString()} bakers
        <div class="bar"><i></i></div>
        <p style="margin:8px 0 0;color:var(--muted);font-size:13px;">You're 8 loaves into your sourdough journey. Next: an open crumb.</p>
      </div>
    </section>

    <section id="call">
      <h2>Next live call</h2>
      <div class="live">
        <strong>${escapeHtml(call.title)}</strong> — ${escapeHtml(call.cadence)}<br />
        <span style="color:var(--muted);font-size:13px;">${escapeHtml(call.format)} · reserve your spot below</span>
      </div>
    </section>

    <section id="courses">
      <h2>Continue your courses</h2>
      ${courses
        .map(
          (c) => `<div class="card">
        <div>
          <h3>${escapeHtml(c.title)}</h3>
          <p>${escapeHtml(c.level)} · ${c.lessons} lessons · ${c.students.toLocaleString()} students</p>
        </div>
        <span class="price">$${c.priceUsd}</span>
      </div>`,
        )
        .join("\n      ")}
    </section>

    <p class="brief"><strong>Prompt:</strong> ${escapeHtml(prompt)}<br />
    This local demo uses a fixed sample template and ${escapeHtml(creator.name)}'s fictional creator context.
    Live mode sends your prompt and creator context to Overskill to generate an app.</p>

    <footer>
      ${escapeHtml(creator.brand)} · powered by <strong>OverSkill</strong>
    </footer>
  </div>
</body>
</html>`;

  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; sandbox",
    "Referrer-Policy": "no-referrer",
  } });
  } catch (error) { return apiError(error); }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

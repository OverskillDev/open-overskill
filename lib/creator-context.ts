// Fictional creator fixture for the example builder.
// Replace with an authorized server-side customer context adapter for real use.

export interface Course {
  title: string;
  lessons: number;
  priceUsd: number;
  students: number;
  level: "Beginner" | "Intermediate" | "Advanced";
}
export interface Community {
  name: string;
  members: number;
  topic: string;
}
export interface Call {
  title: string;
  cadence: string;
  format: string;
}
export interface ContentItem {
  type: string;
  title: string;
  cadence?: string;
  subscribers?: number;
  downloads?: number;
}
export interface Creator {
  id: string;
  name: string;
  handle: string;
  brand: string;
  niche: string;
  bio: string;
  courses: Course[];
  communities: Community[];
  calls: Call[];
  content: ContentItem[];
  audience: {
    size: number;
    primaryDevice: string;
    segments: string[];
    topGoals: string[];
  };
  brandKit: {
    accent: string;
    voice: string;
  };
}

export const creator: Creator = {
  id: process.env.OVERSKILL_CREATOR_ID || "creator_demo_001",
  name: "Priya Nair",
  handle: "@priyabakes",
  brand: "Priya's Baking Studio",
  niche: "Home sourdough & artisan baking for beginners",
  bio:
    "Ex-pastry chef turned online educator. Teaches nervous beginners to bake " +
    "confidently at home. 40k email list, very engaged, mostly mobile.",
  courses: [
    { title: "Sourdough 101", lessons: 12, priceUsd: 89, students: 2140, level: "Beginner" },
    { title: "Artisan Bread Bootcamp", lessons: 24, priceUsd: 199, students: 860, level: "Intermediate" },
    { title: "Laminated Doughs (Croissants & More)", lessons: 9, priceUsd: 149, students: 410, level: "Advanced" },
  ],
  communities: [
    { name: "The Bread Club", members: 3800, topic: "Daily bakes, feedback, troubleshooting" },
    { name: "Starter Rescue", members: 1200, topic: "Sourdough starter help for beginners" },
  ],
  calls: [
    { title: "Weekly Live Bake-Along", cadence: "Thursdays 6pm", format: "Zoom, ~90 min" },
    { title: "Monthly Q&A", cadence: "First Sunday", format: "AMA" },
  ],
  content: [
    { type: "Newsletter", title: "The Weekly Rise", cadence: "weekly", subscribers: 40000 },
    { type: "YouTube", title: "Priya Bakes", subscribers: 128000 },
    { type: "Free guide", title: "The 7 Sourdough Mistakes", downloads: 22000 },
  ],
  audience: {
    size: 40000,
    primaryDevice: "mobile",
    segments: ["absolute beginners", "returning bakers", "gift-buyers"],
    topGoals: ["bake their first loaf", "fix a dead starter", "sell at a local market"],
  },
  brandKit: {
    accent: "#E8792B", // warm crust orange
    voice: "warm, encouraging, plain-spoken; never fussy or elitist",
  },
};

const fmt = (n: number) => n.toLocaleString("en-US");

// Render the creator context as a compact markdown brief. This is the exact
// string sent as `partner_context` (OverSkill also accepts a structured object;
// a pre-formatted brief keeps the injected layer predictable and readable).
export function contextAsMarkdown(c: Creator = creator): string {
  const courses = c.courses
    .map((x) => `- **${x.title}** (${x.level}, ${x.lessons} lessons, $${x.priceUsd}) — ${fmt(x.students)} students`)
    .join("\n");
  const communities = c.communities
    .map((x) => `- **${x.name}** — ${fmt(x.members)} members — ${x.topic}`)
    .join("\n");
  const calls = c.calls.map((x) => `- **${x.title}** — ${x.cadence} (${x.format})`).join("\n");
  const content = c.content
    .map(
      (x) =>
        `- **${x.type}: ${x.title}** — ${
          x.subscribers ? fmt(x.subscribers) + " subs" : x.downloads ? fmt(x.downloads) + " downloads" : x.cadence
        }`,
    )
    .join("\n");

  return `# Creator: ${c.name} (${c.handle}) — ${c.brand}

**Niche:** ${c.niche}
**About:** ${c.bio}
**Brand voice:** ${c.brandKit.voice}
**Brand accent color:** ${c.brandKit.accent}

## Courses
${courses}

## Communities
${communities}

## Live calls
${calls}

## Content & channels
${content}

## Audience
- Size: ${fmt(c.audience.size)} (primarily on ${c.audience.primaryDevice})
- Segments: ${c.audience.segments.join(", ")}
- Top goals: ${c.audience.topGoals.join(", ")}

_Build for THIS creator: match the brand voice and accent color, speak to
${c.audience.segments[0]}, and cross-link the courses and community above where
it makes sense._`;
}

// White-label attribution sent as `partner_attribution`. This is the "their
// surface, OverSkill the engine, light powered-by attribution" half of the bet.
export const attribution = {
  partner: process.env.OVERSKILL_PARTNER_SLUG || "open-overskill",
  display_name: process.env.OVERSKILL_PARTNER_NAME || "Your builder",
  powered_by: "Overskill",
  show_attribution: true,
};

// A few starter prompts, framed in the creator's own world, to make the demo
// one click from a good build.
export const suggestions: string[] = [
  "A members portal where my students track their bakes, book the weekly live call, and buy the next course",
  "A sourdough starter troubleshooter quiz that recommends one of my courses at the end",
  "A landing page for the Weekly Live Bake-Along with a countdown and email capture",
];

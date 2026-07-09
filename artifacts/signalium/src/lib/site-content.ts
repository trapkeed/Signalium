/**
 * Shape + built-in defaults for the admin-editable homepage/landing-page
 * content. The API transmits the override as a JSON string (see
 * routes/site-content.ts); this module owns the actual nested shape on the
 * frontend so admin/site-content.tsx and pages/home.tsx always agree on it.
 *
 * Every field here mirrors copy that used to be hardcoded directly in
 * home.tsx — nothing on the landing page is unreachable from this object.
 */

export interface SiteContentData {
  hero: {
    badge: string;
    headlineLine1: string;
    headlineLine2: string;
    subheadline: string;
    primaryCtaLabel: string;
    secondaryCtaLabel: string;
  };
  philosophy: {
    heading: string;
    body: string;
    bullets: string[];
  };
  howItWorks: {
    eyebrow: string;
    heading: string;
    steps: { title: string; desc: string }[];
  };
  tradingModes: {
    eyebrow: string;
    heading: string;
    manual: { title: string; desc: string; bullets: string[] };
    autonomous: { title: string; desc: string; bullets: string[] };
  };
  markets: {
    eyebrow: string;
    heading: string;
    items: { title: string; desc: string }[];
  };
  pillars: {
    eyebrow: string;
    heading: string;
    items: { title: string; desc: string }[];
  };
  stats: { label: string; value: string }[];
  security: {
    eyebrow: string;
    heading: string;
    body: string;
    bullets: string[];
    badges: string[];
  };
  faq: { q: string; a: string }[];
  cta: {
    heading: string;
    body: string;
    buttonLabel: string;
  };
}

export const DEFAULT_SITE_CONTENT: SiteContentData = {
  hero: {
    badge: "Institutional Trading Infrastructure",
    headlineLine1: "Capital precision.",
    headlineLine2: "Flawless execution.",
    subheadline:
      "Signalium provides the unshakeable foundation for professional traders. Direct market access, sub-millisecond execution routing, and rigorous capital protection protocols—built for those who treat trading as a business, not a game.",
    primaryCtaLabel: "Access Platform",
    secondaryCtaLabel: "Contact Sales",
  },
  philosophy: {
    heading: "Quietly confident. Loudly capable.",
    body: "We reject the noise of retail trading platforms. Signalium is designed for the serious capital allocator who requires stability, absolute discretion, and performance.",
    bullets: [
      "Direct integration with institutional liquidity pools",
      "Encrypted, isolated execution environments",
      "Granular risk management parameters",
      "Zero-latency internal routing architectures",
    ],
  },
  howItWorks: {
    eyebrow: "How it works",
    heading: "From account to execution in three steps.",
    steps: [
      { title: "Open your account", desc: "Select an access tier, connect your MT4 or MT5 terminal, and provision your dedicated execution environment in minutes." },
      { title: "Choose your mode", desc: "Trade manually with institutional-grade market intelligence at your fingertips, or deploy disciplined automated execution—your call." },
      { title: "Execute with confidence", desc: "Every order is routed, monitored, and protected by capital preservation protocols built for accounts that matter." },
    ],
  },
  tradingModes: {
    eyebrow: "Two ways to trade",
    heading: "Stay hands-on, or let discipline run the desk.",
    manual: {
      title: "Manual Trading Mode",
      desc: "Full discretionary control, backed by institutional-grade market intelligence. Place, manage, and close every position yourself while Signalium handles execution routing and capital protection in the background.",
      bullets: ["Real-time market intelligence at your fingertips", "Direct order placement with sub-millisecond routing", "Manual risk controls with hard capital limits"],
    },
    autonomous: {
      title: "Autonomous Trading Mode",
      desc: "Disciplined, rules-based execution that runs continuously across your connected terminals—no emotion, no hesitation, no missed sessions. You define the boundaries; the infrastructure enforces them.",
      bullets: ["Continuous execution across market sessions", "Hard-coded capital preservation protocols", "Full transparency into every automated decision"],
    },
  },
  markets: {
    eyebrow: "Supported markets",
    heading: "Trade across the venues that matter.",
    items: [
      { title: "Forex", desc: "Major, minor, and exotic currency pairs with deep liquidity and tight spreads." },
      { title: "Metals", desc: "Gold, silver, and precious metals execution with the same capital discipline." },
      { title: "Indices", desc: "Global equity indices for diversified exposure alongside your core strategy." },
    ],
  },
  pillars: {
    eyebrow: "Infrastructure capabilities",
    heading: "Engineered for absolute reliability under pressure.",
    items: [
      { title: "Precision Execution", desc: "Every order routed with deterministic exactness. We eliminate slippage vectors and optimize for optimal fill rates across major venues." },
      { title: "Capital Protection", desc: "Institutional-grade risk limits. Hard-stop equity preservation protocols guard your accounts against catastrophic market events." },
      { title: "Analytical Clarity", desc: "Unflinching metrics on portfolio performance. Clean, decisive reporting that focuses on risk-adjusted returns and drawdown profiles." },
      { title: "Dedicated Resources", desc: "Isolated server environments for your automated strategies. Zero resource contention ensures your algorithms execute exactly as designed." },
      { title: "Absolute Security", desc: "End-to-end encryption for all trade signals and account credentials. Your strategic intellectual property remains entirely yours." },
      { title: "Multi-Terminal Management", desc: "Govern an unlimited array of MT4 and MT5 instances from a single, unified command center without sacrificing granularity." },
    ],
  },
  stats: [
    { label: "Execution Latency", value: "<1ms" },
    { label: "System Uptime", value: "99.99%" },
    { label: "Daily Volume", value: "$4.2B+" },
    { label: "Active Institutions", value: "850+" },
  ],
  security: {
    eyebrow: "Security & Infrastructure",
    heading: "Built to withstand scrutiny.",
    body: "Every credential, order, and account balance is protected by redundant, encrypted infrastructure. We hold ourselves to the same standard your capital demands.",
    bullets: [
      "Bank-grade encryption across every connection",
      "Continuous uptime monitoring with automatic failover",
      "Independent capital preservation safeguards on every account",
      "Strict access controls and audited administrative actions",
    ],
    badges: ["End-to-end encryption", "Segregated capital protocols", "Redundant execution infrastructure"],
  },
  faq: [
    { q: "What's the difference between manual and autonomous trading mode?", a: "Manual mode gives you full discretionary control over every position while Signalium handles execution and protection in the background. Autonomous mode runs disciplined, rules-based execution continuously across your connected terminals, within boundaries you define." },
    { q: "Which terminals and markets are supported?", a: "Signalium connects to MT4 and MT5 terminals and supports execution across Forex, Metals, and Indices, with more venues added over time." },
    { q: "How is my capital protected?", a: "Every account runs behind hard-coded capital preservation protocols, redundant execution infrastructure, and end-to-end encryption on every credential and order." },
    { q: "Can I change or cancel my plan later?", a: "Yes. You can upgrade, downgrade, or cancel your access tier at any time from your account without long-term lock-in." },
  ],
  cta: {
    heading: "Ready to trade on infrastructure that matches your ambition?",
    body: "Open your account and provision your execution environment in minutes.",
    buttonLabel: "Open Account",
  },
};

// --- Runtime type guards -----------------------------------------------
// The override comes from a jsonb column round-tripped through JSON.parse
// on an API response — TypeScript can't verify its shape at compile time,
// and the value could in principle be stale/malformed (e.g. written by an
// older schema version). These guards make every field "fall back to the
// default if wrong-shaped" rather than letting `.map`/property access
// throw and crash the whole homepage render.
const isStr = (v: unknown): v is string => typeof v === "string";
const strOr = (v: unknown, fallback: string): string => (isStr(v) ? v : fallback);
const strArrOr = (v: unknown, fallback: string[]): string[] =>
  Array.isArray(v) && v.every(isStr) && v.length > 0 ? v : fallback;

function titledArrOr(
  v: unknown,
  fallback: { title: string; desc: string }[],
): { title: string; desc: string }[] {
  if (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((it) => it && typeof it === "object" && isStr((it as any).title) && isStr((it as any).desc))
  ) {
    return v as { title: string; desc: string }[];
  }
  return fallback;
}

/** Deep-merges a (possibly partial, malformed, or admin-edited) override on top of the defaults, field-by-field with type checks, so a partially-filled-in or corrupted CMS row never blanks out or crashes a section of the homepage. */
export function mergeSiteContent(override: unknown): SiteContentData {
  if (!override || typeof override !== "object" || Array.isArray(override)) return DEFAULT_SITE_CONTENT;
  const o = override as Partial<Record<keyof SiteContentData, any>>;
  const D = DEFAULT_SITE_CONTENT;

  return {
    hero: {
      badge: strOr(o.hero?.badge, D.hero.badge),
      headlineLine1: strOr(o.hero?.headlineLine1, D.hero.headlineLine1),
      headlineLine2: strOr(o.hero?.headlineLine2, D.hero.headlineLine2),
      subheadline: strOr(o.hero?.subheadline, D.hero.subheadline),
      primaryCtaLabel: strOr(o.hero?.primaryCtaLabel, D.hero.primaryCtaLabel),
      secondaryCtaLabel: strOr(o.hero?.secondaryCtaLabel, D.hero.secondaryCtaLabel),
    },
    philosophy: {
      heading: strOr(o.philosophy?.heading, D.philosophy.heading),
      body: strOr(o.philosophy?.body, D.philosophy.body),
      bullets: strArrOr(o.philosophy?.bullets, D.philosophy.bullets),
    },
    howItWorks: {
      eyebrow: strOr(o.howItWorks?.eyebrow, D.howItWorks.eyebrow),
      heading: strOr(o.howItWorks?.heading, D.howItWorks.heading),
      steps: titledArrOr(o.howItWorks?.steps, D.howItWorks.steps),
    },
    tradingModes: {
      eyebrow: strOr(o.tradingModes?.eyebrow, D.tradingModes.eyebrow),
      heading: strOr(o.tradingModes?.heading, D.tradingModes.heading),
      manual: {
        title: strOr(o.tradingModes?.manual?.title, D.tradingModes.manual.title),
        desc: strOr(o.tradingModes?.manual?.desc, D.tradingModes.manual.desc),
        bullets: strArrOr(o.tradingModes?.manual?.bullets, D.tradingModes.manual.bullets),
      },
      autonomous: {
        title: strOr(o.tradingModes?.autonomous?.title, D.tradingModes.autonomous.title),
        desc: strOr(o.tradingModes?.autonomous?.desc, D.tradingModes.autonomous.desc),
        bullets: strArrOr(o.tradingModes?.autonomous?.bullets, D.tradingModes.autonomous.bullets),
      },
    },
    markets: {
      eyebrow: strOr(o.markets?.eyebrow, D.markets.eyebrow),
      heading: strOr(o.markets?.heading, D.markets.heading),
      items: titledArrOr(o.markets?.items, D.markets.items),
    },
    pillars: {
      eyebrow: strOr(o.pillars?.eyebrow, D.pillars.eyebrow),
      heading: strOr(o.pillars?.heading, D.pillars.heading),
      items: titledArrOr(o.pillars?.items, D.pillars.items),
    },
    stats:
      Array.isArray(o.stats) &&
      o.stats.length > 0 &&
      o.stats.every((s: any) => s && isStr(s.label) && isStr(s.value))
        ? o.stats
        : D.stats,
    security: {
      eyebrow: strOr(o.security?.eyebrow, D.security.eyebrow),
      heading: strOr(o.security?.heading, D.security.heading),
      body: strOr(o.security?.body, D.security.body),
      bullets: strArrOr(o.security?.bullets, D.security.bullets),
      badges: strArrOr(o.security?.badges, D.security.badges),
    },
    faq:
      Array.isArray(o.faq) && o.faq.length > 0 && o.faq.every((f: any) => f && isStr(f.q) && isStr(f.a))
        ? o.faq
        : D.faq,
    cta: {
      heading: strOr(o.cta?.heading, D.cta.heading),
      body: strOr(o.cta?.body, D.cta.body),
      buttonLabel: strOr(o.cta?.buttonLabel, D.cta.buttonLabel),
    },
  };
}

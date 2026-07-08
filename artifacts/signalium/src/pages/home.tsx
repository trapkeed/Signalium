import { Link } from "wouter";
import { motion, type Variants } from "framer-motion";
import { Activity, Shield, Cpu, Download, ChevronRight, Zap, Lock, BarChart3 } from "lucide-react";
import { useListPlans } from "@workspace/api-client-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.1 } },
};

export default function Home() {
  const { data: plans } = useListPlans();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-primary font-bold text-lg tracking-tight">
            <Activity className="w-5 h-5" />
            SIGNALIUM
          </div>
          <div className="flex items-center gap-4">
            <Link href="/sign-in" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="text-sm bg-primary text-primary-foreground px-4 py-2 rounded-sm font-medium hover:bg-primary/90 transition-colors"
            >
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-32 pb-24 px-6 relative">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-primary/5 blur-3xl" />
        </div>
        <div className="max-w-7xl mx-auto relative">
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="show"
            className="max-w-3xl"
          >
            <motion.div variants={fadeUp} className="inline-flex items-center gap-2 text-xs font-mono text-primary border border-primary/30 bg-primary/5 px-3 py-1.5 rounded-sm mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              QDE RUNTIME HOST · v3.0 NOW LIVE
            </motion.div>
            <motion.h1 variants={fadeUp} className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.05] mb-6">
              The runtime layer for{" "}
              <span className="text-primary">serious traders.</span>
            </motion.h1>
            <motion.p variants={fadeUp} className="text-lg text-muted-foreground max-w-2xl mb-10 leading-relaxed">
              Signalium hosts the Quant Decision Engine runtime and distributes Expert Advisors to your terminals.
              Not a signal provider. Not a strategy builder. Infrastructure.
            </motion.p>
            <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-4">
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                Start your subscription
                <ChevronRight className="w-4 h-4" />
              </Link>
              <Link
                href="/sign-in"
                className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground text-sm transition-colors"
              >
                Sign in to dashboard
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-2 md:grid-cols-4 gap-8">
          {[
            { label: "Active Runtimes", value: "1,240+" },
            { label: "Trades Routed Today", value: "84,000+" },
            { label: "Uptime SLA", value: "99.9%" },
            { label: "EA Versions Hosted", value: "12" },
          ].map((s) => (
            <div key={s.label} className="text-center md:text-left">
              <div className="text-2xl font-bold text-foreground font-mono">{s.value}</div>
              <div className="text-xs text-muted-foreground mt-1 uppercase tracking-wider">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* What it is / isn't */}
      <section className="py-24 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
            className="grid md:grid-cols-2 gap-12 items-start"
          >
            <motion.div variants={fadeUp}>
              <div className="text-xs font-mono text-primary uppercase tracking-wider mb-4">What Signalium is</div>
              <div className="space-y-3">
                {[
                  "Customer and subscription platform",
                  "EA distribution and versioning layer",
                  "QDE runtime host and API surface",
                  "Telemetry and monitoring backbone",
                  "Secure EA-to-runtime communication channel",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-foreground">
                    <div className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
            </motion.div>
            <motion.div variants={fadeUp}>
              <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-4">What Signalium is NOT</div>
              <div className="space-y-3">
                {[
                  "A signal provider",
                  "A charting or analysis platform",
                  "A strategy or indicator engine",
                  "A portfolio or risk manager",
                  "A trade execution layer",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-muted-foreground">
                    <div className="w-1.5 h-1.5 rounded-full bg-destructive/60 flex-shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6 bg-card border-y border-border">
        <div className="max-w-7xl mx-auto">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
          >
            <motion.div variants={fadeUp} className="text-xs font-mono text-primary uppercase tracking-wider mb-3">Platform capabilities</motion.div>
            <motion.h2 variants={fadeUp} className="text-3xl font-bold mb-12 max-w-xl">Built for the entire trading operation cycle.</motion.h2>
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  icon: Cpu,
                  title: "QDE Runtime Hosting",
                  desc: "The Quant Decision Engine runs on our infrastructure, routing real-time decisions to your terminals with sub-second latency.",
                },
                {
                  icon: Download,
                  title: "EA Distribution",
                  desc: "Download and deploy Expert Advisors directly from the platform. Version-locked, tier-gated, and audit-logged.",
                },
                {
                  icon: Activity,
                  title: "Live Telemetry",
                  desc: "Every trade open, close, error, and heartbeat is recorded and surfaced in your runtime dashboard in real time.",
                },
                {
                  icon: Shield,
                  title: "Secure Channel",
                  desc: "All EA-to-runtime communication is authenticated and encrypted. Token-based download authorization.",
                },
                {
                  icon: Zap,
                  title: "Low-Latency Routing",
                  desc: "Decision routing optimized for speed. EAs receive QDE outputs with minimal overhead.",
                },
                {
                  icon: BarChart3,
                  title: "Subscription Tiers",
                  desc: "Starter, Professional, and Enterprise tiers with tier-gated EA access and runtime allocation.",
                },
              ].map((f) => (
                <motion.div key={f.title} variants={fadeUp} className="p-6 border border-border rounded-sm bg-background hover:border-primary/30 transition-colors">
                  <f.icon className="w-5 h-5 text-primary mb-4" />
                  <div className="font-semibold mb-2">{f.title}</div>
                  <div className="text-sm text-muted-foreground leading-relaxed">{f.desc}</div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Pricing */}
      {plans && plans.length > 0 && (
        <section className="py-24 px-6">
          <div className="max-w-7xl mx-auto">
            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-80px" }}
            >
              <motion.div variants={fadeUp} className="text-xs font-mono text-primary uppercase tracking-wider mb-3">Pricing</motion.div>
              <motion.h2 variants={fadeUp} className="text-3xl font-bold mb-12">Straightforward subscription tiers.</motion.h2>
              <div className="grid md:grid-cols-3 gap-6">
                {plans.map((plan) => (
                  <motion.div
                    key={plan.id}
                    variants={fadeUp}
                    className={`p-6 border rounded-sm flex flex-col gap-4 ${plan.tier === "professional" ? "border-primary bg-primary/5" : "border-border bg-card"}`}
                  >
                    {plan.tier === "professional" && (
                      <div className="text-xs font-mono text-primary uppercase tracking-wider">Most popular</div>
                    )}
                    <div>
                      <div className="font-bold text-xl">{plan.name}</div>
                      <div className="text-3xl font-bold font-mono mt-2">
                        ${plan.priceMonthly}
                        <span className="text-sm font-normal text-muted-foreground">/mo</span>
                      </div>
                    </div>
                    <div className="text-sm text-muted-foreground">{plan.description}</div>
                    <div className="space-y-2 flex-1">
                      {(plan.features as string[]).map((f: string) => (
                        <div key={f} className="flex items-center gap-2 text-sm">
                          <div className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />
                          {f}
                        </div>
                      ))}
                    </div>
                    <Link
                      href="/sign-up"
                      className={`text-center py-2.5 px-4 rounded-sm text-sm font-medium transition-colors ${
                        plan.tier === "professional"
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "border border-border text-foreground hover:bg-secondary"
                      }`}
                    >
                      Get started
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>
      )}

      {/* Architecture diagram */}
      <section className="py-24 px-6 bg-card border-y border-border">
        <div className="max-w-7xl mx-auto">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
          >
            <motion.div variants={fadeUp} className="text-xs font-mono text-primary uppercase tracking-wider mb-3">Architecture</motion.div>
            <motion.h2 variants={fadeUp} className="text-3xl font-bold mb-12">How the stack connects.</motion.h2>
            <motion.div variants={fadeUp} className="font-mono text-sm text-muted-foreground border border-border bg-background rounded-sm p-8 leading-relaxed">
              <div className="flex flex-col md:flex-row items-start md:items-center gap-2 md:gap-4 flex-wrap">
                <div className="border border-primary/40 bg-primary/5 text-primary px-4 py-2 rounded-sm">
                  Signalium Trainer<br /><span className="text-xs text-muted-foreground">trains · deploys</span>
                </div>
                <div className="text-muted-foreground">→</div>
                <div className="border border-border bg-secondary px-4 py-2 rounded-sm text-foreground">
                  QDE<br /><span className="text-xs text-muted-foreground">makes all decisions</span>
                </div>
                <div className="text-muted-foreground">→</div>
                <div className="border border-primary/40 bg-primary/5 text-primary px-4 py-2 rounded-sm">
                  Signalium (YOU)<br /><span className="text-xs text-muted-foreground">hosts · routes · records</span>
                </div>
                <div className="text-muted-foreground">→</div>
                <div className="border border-border bg-secondary px-4 py-2 rounded-sm text-foreground">
                  EA<br /><span className="text-xs text-muted-foreground">executes</span>
                </div>
                <div className="text-muted-foreground">→</div>
                <div className="border border-border bg-secondary px-4 py-2 rounded-sm text-foreground">
                  Terminal<br /><span className="text-xs text-muted-foreground">MT4 / MT5</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6">
        <div className="max-w-7xl mx-auto text-center">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-80px" }}
          >
            <motion.h2 variants={fadeUp} className="text-4xl font-bold mb-4">Ready to connect your terminals?</motion.h2>
            <motion.p variants={fadeUp} className="text-muted-foreground mb-8 max-w-lg mx-auto">
              Set up your subscription, download your first EA, and connect to the QDE runtime in minutes.
            </motion.p>
            <motion.div variants={fadeUp}>
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-3 rounded-sm font-semibold hover:bg-primary/90 transition-colors"
              >
                Create account
                <ChevronRight className="w-4 h-4" />
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2 text-foreground font-semibold">
            <Activity className="w-4 h-4 text-primary" />
            SIGNALIUM
          </div>
          <div>Customer platform · Runtime host · EA distribution</div>
          <div className="font-mono text-xs">QDE v3.0 · Signalium 3.0</div>
        </div>
      </footer>
    </div>
  );
}

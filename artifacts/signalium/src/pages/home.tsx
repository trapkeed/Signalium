import { Link } from "wouter";
import { motion, type Variants } from "framer-motion";
import { Activity, Shield, LineChart, Target, ChevronRight, Lock, Server, BarChart4, MousePointerClick, Cpu, Coins, TrendingUp, Layers, Plus, Minus } from "lucide-react";
import { useState } from "react";
import { useListPlans } from "@workspace/api-client-react";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] } },
};

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.15 } },
};

export default function Home() {
  const { data: plans } = useListPlans();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden selection:bg-primary/30 selection:text-primary">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-background/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white font-medium text-lg tracking-wide">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-lg shadow-primary/20">
              <Activity className="w-4 h-4 text-background" />
            </div>
            SIGNALIUM
          </div>
          <div className="flex items-center gap-6">
            <Link href="/sign-in" className="text-sm text-muted-foreground hover:text-white transition-colors">
              Client Portal
            </Link>
            <Link
              href="/sign-up"
              className="text-sm bg-white text-background px-5 py-2.5 rounded shadow hover:bg-white/90 transition-all font-medium"
            >
              Open Account
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative pt-40 pb-32 px-6">
        <div className="absolute inset-0 z-0">
          <img 
            src="/trading-floor.jpg" 
            alt="Professional Trading Environment" 
            className="w-full h-full object-cover opacity-10"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background via-background/80 to-background" />
          <div className="absolute inset-0 bg-gradient-to-r from-background via-background/90 to-transparent" />
        </div>
        
        <div className="max-w-7xl mx-auto relative z-10">
          <motion.div
            variants={stagger}
            initial="hidden"
            animate="show"
            className="max-w-3xl"
          >
            <motion.div variants={fadeUp} className="inline-flex items-center gap-2 text-xs font-medium text-primary tracking-widest uppercase mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              Institutional Trading Infrastructure
            </motion.div>
            <motion.h1 variants={fadeUp} className="text-5xl md:text-7xl font-normal tracking-tight text-white mb-8 leading-[1.1]">
              Capital precision. <br />
              <span className="text-muted-foreground">Flawless execution.</span>
            </motion.h1>
            <motion.p variants={fadeUp} className="text-lg md:text-xl text-muted-foreground max-w-2xl mb-12 leading-relaxed font-light">
              Signalium provides the unshakeable foundation for professional traders. 
              Direct market access, sub-millisecond execution routing, and rigorous capital protection protocols—built for those who treat trading as a business, not a game.
            </motion.p>
            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <Link
                href="/sign-up"
                className="w-full sm:w-auto inline-flex justify-center items-center gap-2 bg-primary text-background px-8 py-4 rounded font-medium hover:bg-primary/90 transition-all shadow-[0_0_20px_rgba(201,151,32,0.3)]"
              >
                Access Platform
                <ChevronRight className="w-4 h-4" />
              </Link>
              <Link
                href="/sign-in"
                className="w-full sm:w-auto inline-flex justify-center items-center gap-2 px-8 py-4 rounded border border-border text-white hover:bg-white/5 transition-colors"
              >
                Contact Sales
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Philosophy */}
      <section className="py-24 px-6 border-y border-white/5 bg-card">
        <div className="max-w-7xl mx-auto">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            className="grid md:grid-cols-2 gap-16 items-center"
          >
            <div>
              <motion.h2 variants={fadeUp} className="text-3xl md:text-4xl font-normal text-white mb-6 leading-tight">
                Quietly confident. <br/>Loudly capable.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-muted-foreground leading-relaxed mb-6 font-light">
                We reject the noise of retail trading platforms. Signalium is designed for the serious capital allocator who requires stability, absolute discretion, and performance.
              </motion.p>
              <motion.div variants={fadeUp} className="space-y-4">
                {[
                  "Direct integration with institutional liquidity pools",
                  "Encrypted, isolated execution environments",
                  "Granular risk management parameters",
                  "Zero-latency internal routing architectures"
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full" />
                    </div>
                    <span className="text-sm text-white/80">{item}</span>
                  </div>
                ))}
              </motion.div>
            </div>
            <motion.div variants={fadeUp} className="relative">
              <div className="aspect-[4/3] rounded bg-secondary border border-white/10 overflow-hidden p-8 flex flex-col justify-between relative shadow-2xl">
                <div className="absolute top-0 right-0 w-64 h-64 bg-accent/10 blur-[100px] rounded-full" />
                <div className="relative z-10 flex justify-between items-start mb-12">
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground uppercase tracking-widest">Execution Status</div>
                    <div className="text-2xl text-white font-mono">NOMINAL</div>
                  </div>
                  <Activity className="w-6 h-6 text-primary" />
                </div>
                <div className="space-y-6 relative z-10">
                  <div className="h-px w-full bg-white/5" />
                  <div className="flex justify-between items-center text-sm font-mono">
                    <span className="text-muted-foreground">LATENCY</span>
                    <span className="text-white">0.4ms</span>
                  </div>
                  <div className="h-px w-full bg-white/5" />
                  <div className="flex justify-between items-center text-sm font-mono">
                    <span className="text-muted-foreground">UPTIME</span>
                    <span className="text-success">99.999%</span>
                  </div>
                  <div className="h-px w-full bg-white/5" />
                  <div className="flex justify-between items-center text-sm font-mono">
                    <span className="text-muted-foreground">CAPITAL ALLOCATED</span>
                    <span className="text-white">SECURE</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-32 px-6 border-y border-white/5 bg-card">
        <div className="max-w-7xl mx-auto">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            className="mb-16 md:mb-24 text-center"
          >
            <motion.div variants={fadeUp} className="text-sm text-primary tracking-widest uppercase mb-4">How it works</motion.div>
            <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-normal text-white max-w-2xl mx-auto leading-tight">
              From account to execution in three steps.
            </motion.h2>
          </motion.div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-50px" }}
            className="grid md:grid-cols-3 gap-8"
          >
            {[
              {
                step: "01",
                title: "Open your account",
                desc: "Select an access tier, connect your MT4 or MT5 terminal, and provision your dedicated execution environment in minutes.",
              },
              {
                step: "02",
                title: "Choose your mode",
                desc: "Trade manually with institutional-grade market intelligence at your fingertips, or deploy disciplined automated execution—your call.",
              },
              {
                step: "03",
                title: "Execute with confidence",
                desc: "Every order is routed, monitored, and protected by capital preservation protocols built for accounts that matter.",
              },
            ].map((s, i) => (
              <motion.div key={i} variants={fadeUp} className="relative p-8 rounded border border-white/10 bg-secondary">
                <div className="text-5xl font-mono text-primary/30 mb-6">{s.step}</div>
                <h3 className="text-xl font-medium text-white mb-3">{s.title}</h3>
                <p className="text-muted-foreground font-light leading-relaxed">{s.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Trading Modes */}
      <section className="py-32 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            className="mb-16 md:mb-24"
          >
            <motion.div variants={fadeUp} className="text-sm text-primary tracking-widest uppercase mb-4">Two ways to trade</motion.div>
            <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-normal text-white max-w-2xl leading-tight">
              Stay hands-on, or let discipline run the desk.
            </motion.h2>
          </motion.div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-50px" }}
            className="grid md:grid-cols-2 gap-8"
          >
            <motion.div variants={fadeUp} className="p-10 rounded border border-white/10 bg-card">
              <div className="w-12 h-12 rounded border border-white/10 bg-secondary flex items-center justify-center mb-8">
                <MousePointerClick className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-2xl font-medium text-white mb-4">Manual Trading Mode</h3>
              <p className="text-muted-foreground font-light leading-relaxed mb-8">
                Full discretionary control, backed by institutional-grade market intelligence. Place, manage, and close every position yourself while Signalium handles execution routing and capital protection in the background.
              </p>
              <div className="space-y-3">
                {["Real-time market intelligence at your fingertips", "Direct order placement with sub-millisecond routing", "Manual risk controls with hard capital limits"].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0" />
                    <span className="text-sm text-white/80 font-light">{item}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div variants={fadeUp} className="p-10 rounded border border-primary/30 bg-secondary shadow-[0_0_30px_rgba(201,151,32,0.05)]">
              <div className="w-12 h-12 rounded border border-primary/30 bg-primary/10 flex items-center justify-center mb-8">
                <Cpu className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-2xl font-medium text-white mb-4">Autonomous Trading Mode</h3>
              <p className="text-muted-foreground font-light leading-relaxed mb-8">
                Disciplined, rules-based execution that runs continuously across your connected terminals—no emotion, no hesitation, no missed sessions. You define the boundaries; the infrastructure enforces them.
              </p>
              <div className="space-y-3">
                {["Continuous execution across market sessions", "Hard-coded capital preservation protocols", "Full transparency into every automated decision"].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0" />
                    <span className="text-sm text-white/80 font-light">{item}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Supported Markets */}
      <section className="py-32 px-6 border-y border-white/5 bg-card">
        <div className="max-w-7xl mx-auto">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            className="mb-16 md:mb-24 text-center"
          >
            <motion.div variants={fadeUp} className="text-sm text-primary tracking-widest uppercase mb-4">Supported markets</motion.div>
            <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-normal text-white max-w-2xl mx-auto leading-tight">
              Trade across the venues that matter.
            </motion.h2>
          </motion.div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-50px" }}
            className="grid md:grid-cols-3 gap-8"
          >
            {[
              { icon: TrendingUp, title: "Forex", desc: "Major, minor, and exotic currency pairs with deep liquidity and tight spreads." },
              { icon: Coins, title: "Metals", desc: "Gold, silver, and precious metals execution with the same capital discipline." },
              { icon: Layers, title: "Indices", desc: "Global equity indices for diversified exposure alongside your core strategy." },
            ].map((m, i) => (
              <motion.div key={i} variants={fadeUp} className="p-8 rounded border border-white/10 bg-secondary text-center">
                <div className="w-12 h-12 rounded border border-white/10 bg-card flex items-center justify-center mb-6 mx-auto">
                  <m.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-xl font-medium text-white mb-3">{m.title}</h3>
                <p className="text-muted-foreground font-light leading-relaxed">{m.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Core Pillars */}
      <section className="py-32 px-6">
        <div className="max-w-7xl mx-auto">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            className="mb-16 md:mb-24"
          >
            <motion.div variants={fadeUp} className="text-sm text-primary tracking-widest uppercase mb-4">Infrastructure capabilities</motion.div>
            <motion.h2 variants={fadeUp} className="text-4xl md:text-5xl font-normal text-white max-w-2xl leading-tight">
              Engineered for absolute reliability under pressure.
            </motion.h2>
          </motion.div>

          <motion.div 
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-50px" }}
            className="grid md:grid-cols-3 gap-x-8 gap-y-16"
          >
            {[
              {
                icon: Target,
                title: "Precision Execution",
                desc: "Every order routed with deterministic exactness. We eliminate slippage vectors and optimize for optimal fill rates across major venues."
              },
              {
                icon: Shield,
                title: "Capital Protection",
                desc: "Institutional-grade risk limits. Hard-stop equity preservation protocols guard your accounts against catastrophic market events."
              },
              {
                icon: LineChart,
                title: "Analytical Clarity",
                desc: "Unflinching metrics on portfolio performance. Clean, decisive reporting that focuses on risk-adjusted returns and drawdown profiles."
              },
              {
                icon: Server,
                title: "Dedicated Resources",
                desc: "Isolated server environments for your automated strategies. Zero resource contention ensures your algorithms execute exactly as designed."
              },
              {
                icon: Lock,
                title: "Absolute Security",
                desc: "End-to-end encryption for all trade signals and account credentials. Your strategic intellectual property remains entirely yours."
              },
              {
                icon: BarChart4,
                title: "Multi-Terminal Management",
                desc: "Govern an unlimited array of MT4 and MT5 instances from a single, unified command center without sacrificing granularity."
              }
            ].map((f, i) => (
              <motion.div key={i} variants={fadeUp} className="group">
                <div className="w-12 h-12 rounded border border-white/10 bg-secondary flex items-center justify-center mb-6 group-hover:border-primary/50 transition-colors">
                  <f.icon className="w-5 h-5 text-white group-hover:text-primary transition-colors" />
                </div>
                <h3 className="text-xl font-medium text-white mb-4">{f.title}</h3>
                <p className="text-muted-foreground font-light leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Stats */}
      <section className="border-y border-white/5 bg-[url('/trading-floor.jpg')] bg-cover bg-center bg-fixed relative">
        <div className="absolute inset-0 bg-background/95 backdrop-blur-sm" />
        <div className="max-w-7xl mx-auto px-6 py-20 relative z-10">
          <motion.div
             variants={stagger}
             initial="hidden"
             whileInView="show"
             viewport={{ once: true }}
             className="grid grid-cols-2 md:grid-cols-4 gap-12"
          >
            {[
              { label: "Execution Latency", value: "<1ms" },
              { label: "System Uptime", value: "99.99%" },
              { label: "Daily Volume", value: "$4.2B+" },
              { label: "Active Institutions", value: "850+" },
            ].map((s, i) => (
              <motion.div key={i} variants={fadeUp} className="text-center md:text-left">
                <div className="text-4xl md:text-5xl font-normal text-white font-mono mb-2">{s.value}</div>
                <div className="text-sm text-primary tracking-widest uppercase">{s.label}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Pricing */}
      {plans && plans.length > 0 && (
        <section className="py-32 px-6">
          <div className="max-w-7xl mx-auto">
            <motion.div
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-100px" }}
              className="text-center mb-20"
            >
              <motion.div variants={fadeUp} className="text-sm text-primary tracking-widest uppercase mb-4">Access Tiers</motion.div>
              <motion.h2 variants={fadeUp} className="text-4xl font-normal text-white">Transparent structuring.</motion.h2>
            </motion.div>

            <motion.div 
              variants={stagger}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              className="grid md:grid-cols-3 gap-8 items-stretch"
            >
              {plans.map((plan) => (
                <motion.div
                  key={plan.id}
                  variants={fadeUp}
                  className={`relative p-8 flex flex-col h-full rounded border ${
                    plan.tier === "professional" 
                      ? "border-primary/50 bg-secondary shadow-[0_0_30px_rgba(201,151,32,0.05)]" 
                      : "border-white/10 bg-card"
                  }`}
                >
                  {plan.tier === "professional" && (
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary text-background text-xs font-bold tracking-widest uppercase px-4 py-1 rounded">
                      Standard Issue
                    </div>
                  )}
                  <div className="mb-8">
                    <h3 className="text-xl font-medium text-white mb-2">{plan.name}</h3>
                    <div className="text-muted-foreground text-sm font-light min-h-[40px]">{plan.description}</div>
                  </div>
                  
                  <div className="mb-8">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-mono text-white">${plan.priceMonthly}</span>
                      <span className="text-muted-foreground">/mo</span>
                    </div>
                  </div>

                  <div className="space-y-4 flex-1 mb-10">
                    {(plan.features as string[]).map((f: string, i: number) => (
                      <div key={i} className="flex items-start gap-3">
                        <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${plan.tier === "professional" ? "bg-primary" : "bg-white/30"}`} />
                        <span className="text-sm text-white/80 font-light leading-relaxed">{f}</span>
                      </div>
                    ))}
                  </div>

                  <Link
                    href="/sign-up"
                    className={`block w-full py-4 text-center rounded font-medium transition-all ${
                      plan.tier === "professional"
                        ? "bg-primary text-background hover:bg-primary/90"
                        : "bg-white/5 text-white hover:bg-white/10 border border-white/10"
                    }`}
                  >
                    Initiate Access
                  </Link>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>
      )}

      {/* Security & Infrastructure */}
      <section className="py-32 px-6 border-y border-white/5 bg-card">
        <div className="max-w-7xl mx-auto">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            className="grid md:grid-cols-2 gap-16 items-center"
          >
            <motion.div variants={fadeUp} className="order-2 md:order-1 relative">
              <div className="aspect-[4/3] rounded bg-secondary border border-white/10 overflow-hidden p-8 flex flex-col justify-center gap-6 relative">
                <div className="absolute top-0 left-0 w-64 h-64 bg-primary/5 blur-[100px] rounded-full" />
                {[
                  { icon: Lock, label: "End-to-end encryption" },
                  { icon: Shield, label: "Segregated capital protocols" },
                  { icon: Server, label: "Redundant execution infrastructure" },
                ].map((item, i) => (
                  <div key={i} className="relative z-10 flex items-center gap-4 p-4 rounded border border-white/10 bg-card">
                    <item.icon className="w-5 h-5 text-primary flex-shrink-0" />
                    <span className="text-sm text-white/90 font-light">{item.label}</span>
                  </div>
                ))}
              </div>
            </motion.div>
            <div className="order-1 md:order-2">
              <motion.div variants={fadeUp} className="text-sm text-primary tracking-widest uppercase mb-4">Security &amp; Infrastructure</motion.div>
              <motion.h2 variants={fadeUp} className="text-3xl md:text-4xl font-normal text-white mb-6 leading-tight">
                Built to withstand scrutiny.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-muted-foreground leading-relaxed mb-6 font-light">
                Every credential, order, and account balance is protected by redundant, encrypted infrastructure. We hold ourselves to the same standard your capital demands.
              </motion.p>
              <motion.div variants={fadeUp} className="space-y-4">
                {[
                  "Bank-grade encryption across every connection",
                  "Continuous uptime monitoring with automatic failover",
                  "Independent capital preservation safeguards on every account",
                  "Strict access controls and audited administrative actions",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <div className="w-1.5 h-1.5 bg-primary rounded-full" />
                    </div>
                    <span className="text-sm text-white/80">{item}</span>
                  </div>
                ))}
              </motion.div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-32 px-6">
        <div className="max-w-4xl mx-auto">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-100px" }}
            className="mb-16 text-center"
          >
            <motion.div variants={fadeUp} className="text-sm text-primary tracking-widest uppercase mb-4">Frequently asked</motion.div>
            <motion.h2 variants={fadeUp} className="text-4xl font-normal text-white">Questions worth answering.</motion.h2>
          </motion.div>

          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-50px" }}
            className="space-y-4"
          >
            {[
              {
                q: "What's the difference between manual and autonomous trading mode?",
                a: "Manual mode gives you full discretionary control over every position while Signalium handles execution and protection in the background. Autonomous mode runs disciplined, rules-based execution continuously across your connected terminals, within boundaries you define.",
              },
              {
                q: "Which terminals and markets are supported?",
                a: "Signalium connects to MT4 and MT5 terminals and supports execution across Forex, Metals, and Indices, with more venues added over time.",
              },
              {
                q: "How is my capital protected?",
                a: "Every account runs behind hard-coded capital preservation protocols, redundant execution infrastructure, and end-to-end encryption on every credential and order.",
              },
              {
                q: "Can I change or cancel my plan later?",
                a: "Yes. You can upgrade, downgrade, or cancel your access tier at any time from your account without long-term lock-in.",
              },
            ].map((item, i) => (
              <motion.div key={i} variants={fadeUp}>
                <FaqItem question={item.q} answer={item.a} />
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 px-6 bg-secondary border-t border-white/5 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-accent/5 rounded-full blur-[120px] pointer-events-none" />
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <motion.div
            variants={stagger}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
          >
            <motion.h2 variants={fadeUp} className="text-4xl md:text-6xl font-normal text-white mb-8 leading-tight">
              Ready to professionalize your infrastructure?
            </motion.h2>
            <motion.p variants={fadeUp} className="text-xl text-muted-foreground mb-12 font-light max-w-2xl mx-auto">
              Join the proprietary trading desks and serious individual allocators who trust Signalium with their daily execution.
            </motion.p>
            <motion.div variants={fadeUp}>
              <Link
                href="/sign-up"
                className="inline-flex justify-center items-center gap-2 bg-white text-background px-10 py-5 rounded font-medium hover:bg-white/90 transition-all text-lg"
              >
                Establish Connection
                <ChevronRight className="w-5 h-5" />
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 bg-background pt-16 pb-8 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3 text-white font-medium tracking-wide">
              <div className="w-6 h-6 rounded bg-white/5 flex items-center justify-center">
                <Activity className="w-3 h-3 text-primary" />
              </div>
              SIGNALIUM
            </div>
            <div className="text-sm text-muted-foreground font-light">
              Institutional Trading Infrastructure
            </div>
            <div className="flex gap-6 text-sm text-muted-foreground font-light">
              <Link href="#" className="hover:text-white transition-colors">Security</Link>
              <Link href="#" className="hover:text-white transition-colors">Terms</Link>
              <Link href="#" className="hover:text-white transition-colors">Privacy</Link>
            </div>
          </div>
          <div className="mt-12 text-center text-xs text-muted-foreground/50 font-light">
            &copy; {new Date().getFullYear()} Signalium Technologies. All rights reserved. High-performance capital routing systems.
          </div>
        </div>
      </footer>
    </div>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded border border-white/10 bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-6 p-6 text-left"
      >
        <span className="text-white font-medium">{question}</span>
        {open ? (
          <Minus className="w-4 h-4 text-primary flex-shrink-0" />
        ) : (
          <Plus className="w-4 h-4 text-primary flex-shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-6 pb-6 text-muted-foreground font-light leading-relaxed">
          {answer}
        </div>
      )}
    </div>
  );
}

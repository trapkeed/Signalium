import { PublicShell } from "@/components/public-shell";
import { FileText } from "lucide-react";

const SECTIONS = [
  {
    title: "1. Acceptance of terms",
    body: "By creating an account or using Signalium, you agree to be bound by these Terms of Service. If you do not agree, do not use the platform.",
  },
  {
    title: "2. Nature of the service",
    body: "Signalium provides market signals, automated analysis, and optional autonomous trade execution (\"QDE\") for connected trading accounts. Signalium is a software tool, not a licensed financial advisor or broker-dealer, and does not guarantee profits.",
  },
  {
    title: "3. Trading risk",
    body: "Trading leveraged financial instruments carries a high level of risk and may not be suitable for everyone. You are solely responsible for trades placed on your account, whether placed manually or executed by the QDE while Autonomous mode and your QDE switch are enabled. Past performance is not indicative of future results.",
  },
  {
    title: "4. Account responsibilities",
    body: "You are responsible for maintaining the confidentiality of your account credentials and API keys, and for all activity that occurs under your account. Notify us immediately of any unauthorized use.",
  },
  {
    title: "5. Subscriptions and billing",
    body: "Paid plans are billed on a recurring basis as described at checkout. You may cancel at any time from Account → Subscriptions; access continues until the end of the current billing period.",
  },
  {
    title: "6. Termination",
    body: "We may suspend or terminate your access to Signalium for violation of these terms, fraudulent activity, or as required by law. You may close your account at any time from your Account settings.",
  },
  {
    title: "7. Changes to these terms",
    body: "We may update these terms from time to time. Continued use of the platform after changes take effect constitutes acceptance of the revised terms.",
  },
  {
    title: "8. Contact",
    body: "Questions about these terms can be sent through our Contact page or the in-app Support desk.",
  },
];

export default function Terms() {
  return (
    <PublicShell>
      <section className="max-w-3xl mx-auto px-6 py-20">
        <div className="flex items-center gap-2 text-sm text-primary tracking-widest uppercase mb-4">
          <FileText className="w-4 h-4" /> Legal
        </div>
        <h1 className="text-3xl md:text-4xl font-normal text-white mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground font-light mb-12">Last updated: {new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</p>

        <div className="flex flex-col gap-8">
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <h2 className="text-white font-medium mb-2">{s.title}</h2>
              <p className="text-sm text-muted-foreground font-light leading-relaxed">{s.body}</p>
            </div>
          ))}
        </div>
      </section>
    </PublicShell>
  );
}

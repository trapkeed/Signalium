import { PublicShell } from "@/components/public-shell";
import { ShieldCheck } from "lucide-react";

const SECTIONS = [
  {
    title: "1. Information we collect",
    body: "We collect account information (name, email), trading configuration (symbols, risk parameters, trading mode), connected EA/broker metadata, and usage data needed to operate the platform and support your account.",
  },
  {
    title: "2. How we use your information",
    body: "We use your information to operate your account, run the QDE analysis and execution you have enabled, provide customer support, send service notifications, and improve platform reliability and security.",
  },
  {
    title: "3. Trading data",
    body: "Telemetry sent from your EA (positions, account state) is used to power signals, risk management, and the autonomous trading features you explicitly enable. This data is scoped to your account and is not shared with other users.",
  },
  {
    title: "4. Data sharing",
    body: "We do not sell your personal data. We share data only with service providers necessary to operate the platform (e.g. payment processors, email delivery, infrastructure providers) under appropriate confidentiality obligations, or when required by law.",
  },
  {
    title: "5. Data retention",
    body: "We retain account and trading data for as long as your account is active, plus a limited period afterward for legal, audit, and compliance purposes. You can request deletion of your account data via Account → Privacy.",
  },
  {
    title: "6. Security",
    body: "We use encryption in transit, access controls, and audit logging to protect your data. No system is perfectly secure; report suspected issues to our Support desk immediately.",
  },
  {
    title: "7. Your rights",
    body: "Depending on your jurisdiction, you may have rights to access, correct, export, or delete your personal data. Manage these from Account → Privacy, or contact us for assistance.",
  },
  {
    title: "8. Contact",
    body: "Questions about this policy can be sent through our Contact page or the in-app Support desk.",
  },
];

export default function Privacy() {
  return (
    <PublicShell>
      <section className="max-w-3xl mx-auto px-6 py-20">
        <div className="flex items-center gap-2 text-sm text-primary tracking-widest uppercase mb-4">
          <ShieldCheck className="w-4 h-4" /> Legal
        </div>
        <h1 className="text-3xl md:text-4xl font-normal text-white mb-2">Privacy Policy</h1>
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

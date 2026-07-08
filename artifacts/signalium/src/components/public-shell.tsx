import { Link } from "wouter";
import { Activity } from "lucide-react";
import { ReactNode } from "react";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <nav className="border-b border-white/5 bg-background/90 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 text-white font-medium tracking-wide">
            <div className="w-7 h-7 rounded bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Activity className="w-3.5 h-3.5 text-background" />
            </div>
            SIGNALIUM
          </Link>
          <div className="flex items-center gap-6 text-sm">
            <Link href="/status" className="text-muted-foreground hover:text-white transition-colors">Status</Link>
            <Link href="/kb" className="text-muted-foreground hover:text-white transition-colors">Help Center</Link>
            <Link href="/contact" className="text-muted-foreground hover:text-white transition-colors">Contact</Link>
            <Link href="/sign-in" className="text-muted-foreground hover:text-white transition-colors">Client Portal</Link>
          </div>
        </div>
      </nav>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-white/5 bg-background py-8 px-6">
        <div className="max-w-5xl mx-auto text-center text-xs text-muted-foreground/60 font-light">
          &copy; {new Date().getFullYear()} Signalium Technologies. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

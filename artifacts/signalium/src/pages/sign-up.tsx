import { useState } from "react";
import { useLocation } from "wouter";
import { customFetch, ApiError } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useAuth } from "@/hooks/use-auth";
import { REFERRAL_CODE_STORAGE_KEY } from "@/lib/referral";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function GoogleButton() {
  return (
    <a
      href={`${basePath}/api/auth/google/start${(() => {
        const ref = localStorage.getItem(REFERRAL_CODE_STORAGE_KEY);
        return ref ? `?ref=${encodeURIComponent(ref)}` : "";
      })()}`}
      className="w-full inline-flex items-center justify-center gap-3 rounded-sm border border-[#2a333e] bg-[#1a2129] hover:bg-[#232c36] text-white font-medium px-4 py-2.5 transition-colors"
    >
      <svg viewBox="0 0 24 24" className="w-4 h-4" aria-hidden="true">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
      </svg>
      Continue with Google
    </a>
  );
}

export function SignUpPage() {
  const [, setLocation] = useLocation();
  const { refetch } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"form" | "code">("form");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (!email || !password) return setError("Enter your email and password");
    if (password.length < 8) return setError("Password must be at least 8 characters");
    setLoading(true);
    try {
      const referralCode = localStorage.getItem(REFERRAL_CODE_STORAGE_KEY) || undefined;
      const data = await customFetch<{ requiresCode?: boolean }>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ email, password, firstName: firstName || undefined, lastName: lastName || undefined, referralCode }),
      });
      if (data.requiresCode) {
        setStage("code");
      } else {
        await refetch();
        setLocation("/dashboard");
      }
    } catch (err) {
      setError(err instanceof ApiError ? (err.data as any)?.error ?? "Something went wrong" : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    setError(null);
    if (code.length !== 6) return setError("Enter the 6-digit code");
    setLoading(true);
    try {
      await customFetch("/api/auth/verify-code", {
        method: "POST",
        body: JSON.stringify({ email, code, purpose: "signup" }),
      });
      await refetch();
      setLocation("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? (err.data as any)?.error ?? "Invalid code" : "Invalid code");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="bg-[#0c1015] border border-[#18212a] rounded-md w-[440px] max-w-full p-8 flex flex-col gap-5">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Create your account</h1>
          <p className="text-sm text-muted-foreground mt-1">Start building and running your trading EAs.</p>
        </div>

        {stage === "form" ? (
          <>
            <GoogleButton />
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
            </div>
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label>First name</Label>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>Last name</Label>
                  <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Password</Label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} placeholder="At least 8 characters" />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={handleSubmit} disabled={loading} className="w-full">{loading ? "Creating account…" : "Sign up"}</Button>
            <p className="text-sm text-muted-foreground text-center">
              Already have an account?{" "}
              <a href={`${basePath}/sign-in`} className="text-primary hover:text-primary/90">Sign in</a>
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Enter the 6-digit code we emailed to <span className="text-foreground">{email}</span>.</p>
            <InputOTP maxLength={6} value={code} onChange={setCode}>
              <InputOTPGroup>
                {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}
              </InputOTPGroup>
            </InputOTP>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button onClick={handleVerify} disabled={loading} className="w-full">{loading ? "Verifying…" : "Verify & create account"}</Button>
          </>
        )}
      </div>
    </div>
  );
}

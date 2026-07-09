/**
 * S29 — Lightweight CSRF mitigation.
 *
 * This API is called two ways: (1) Bearer/API-key clients (EA terminals,
 * mobile, service tokens) which are immune to CSRF by construction — a
 * cross-site page cannot read or attach the caller's Authorization/x-api-key
 * header; (2) the Signalium web app, which authenticates via Clerk's
 * cookie-backed session and calls the API cross-origin with credentials.
 * For (2), a hostile page could still trigger a cookie-carrying request via
 * a plain HTML form.
 *
 * Mitigation: require a custom header on every state-changing request.
 * Cross-site `<form>` submissions (and simple `<img>`/`<script>` GETs) can
 * never attach a custom header without triggering a CORS preflight, which
 * our origin allowlist then blocks. A same-origin/allowed fetch() call can
 * set one trivially. This is not a substitute for a full double-submit
 * token scheme, but combined with the origin allowlist it closes the
 * practical CSRF vector for a JSON API with no HTML form endpoints.
 */
import type { NextFunction, Request, Response } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Requests carrying one of these are already unforgeable cross-site.
const BEARER_HEADERS = ["authorization", "x-api-key"];
// Paths that must remain reachable without the custom header: signature or
// HMAC-verified webhooks (no cookies/session involved at all).
const EXEMPT_PREFIXES = ["/api/payments/webhooks"];

export function csrfMitigation(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (EXEMPT_PREFIXES.some((p) => req.path.startsWith(p) || req.originalUrl.startsWith(p))) return next();
  if (BEARER_HEADERS.some((h) => req.headers[h])) return next();
  if (req.headers["x-requested-with"] || req.headers["x-signalium-client"]) return next();

  return res.status(403).json({ error: "Missing required client header" });
}

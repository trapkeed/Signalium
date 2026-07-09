import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { robotsTxtHandler, sitemapXmlHandler } from "./routes/seo";
import { logger } from "./lib/logger";
import { apiResponseTimeMiddleware } from "./lib/apiResponseTime";
import { ipReputationGate } from "./middlewares/ipReputationGate";
import { csrfMitigation } from "./middlewares/csrfMitigation";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(apiResponseTimeMiddleware);

// S29 — institutional security headers. `crossOriginResourcePolicy` is
// relaxed to `cross-origin` because media/EA-build downloads are fetched
// cross-origin by the Signalium web app and mobile clients; `contentSecurityPolicy`
// only governs responses this API itself renders (there are effectively
// none — it's a JSON API), so a strict default-src covers it without
// breaking anything.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: { maxAge: 15552000, includeSubDomains: true },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// S29 — CORS is restricted to an explicit allowlist (ALLOWED_ORIGINS, comma
// separated) rather than reflecting every request's Origin header. Falls
// back to allowing all in non-production so local/dev preview domains
// (which vary per Repl) keep working without configuration.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",").map((o) => o.trim()).filter(Boolean);
if (process.env.NODE_ENV === "production" && allowedOrigins.length === 0) {
  // Fail closed, not open: an unset ALLOWED_ORIGINS in production must not
  // silently mean "allow everything" — that would defeat the whole point
  // of the allowlist. Refuse to boot until it's configured.
  throw new Error("ALLOWED_ORIGINS must be set (comma-separated) in production");
}
app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // same-origin / server-to-server / curl
    if (process.env.NODE_ENV !== "production") return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
}));

// S29 — blocks requests from IPs flagged by repeated security-incident
// detections (brute force, API abuse, replay attempts, etc). Checked before
// any route handling so a blocklisted IP never reaches auth or business logic.
app.use(ipReputationGate);

// S29 — lightweight CSRF mitigation for cookie-authenticated state-changing
// requests. Real cross-site forms/img/script tags cannot attach custom
// headers, so requiring one on mutations blocks classic CSRF without a
// stateful token exchange. Bearer-token API clients (EA terminals, mobile)
// already send `x-api-key`/`Authorization`, which also satisfies this.
app.use(csrfMitigation);
// Payment provider webhooks (Stripe in particular) must verify their
// signature against the exact raw request bytes — re-serializing the
// parsed JSON body would break verification. `verify` stashes the raw
// buffer on every request; webhook routes read `req.rawBody` instead of
// `req.body` when checking signatures.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as import("express").Request).rawBody = Buffer.from(buf);
    },
  }),
);
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

// Real crawlers request these at the site root, not under /api. Mounted
// directly (in addition to /api/seo/robots.txt and /api/seo/sitemap.xml)
// so the admin-controlled content is what search engines actually see.
app.get("/robots.txt", robotsTxtHandler);
app.get("/sitemap.xml", sitemapXmlHandler);

app.use("/api", router);

export default app;

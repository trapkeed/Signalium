import express, { type Express } from "express";
import cors from "cors";
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

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
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

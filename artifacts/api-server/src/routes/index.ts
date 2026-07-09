import { Router, type IRouter } from "express";
import healthRouter from "./health";
import plansRouter from "./plans";
import subscriptionsRouter from "./subscriptions";
import easRouter from "./eas";
import runtimeRouter from "./runtime";
import usersRouter from "./users";
import statsRouter from "./stats";
import paymentsRouter from "./payments";
import smtpRouter from "./smtp";
import apiKeysRouter from "./api-keys";
import eaRegistrationsRouter from "./ea-registrations";
import eaBuildsRouter from "./ea-builds";
import symbolsRouter from "./symbols";
import qdeRouter from "./qde";
import accountSecurityRouter from "./account-security";
import storageRouter from "./storage";
import seoRouter from "./seo";
import mediaRouter from "./media";
import notificationsRouter from "./notifications";
import announcementsRouter from "./announcements";
import maintenanceBannerRouter from "./maintenance-banner";
import supportTicketsRouter from "./support-tickets";
import contactRouter from "./contact";
import knowledgeBaseRouter from "./knowledge-base";
import statusRouter from "./status";
import referralsRouter from "./referrals";
import auditLogRouter from "./audit-log";
import brokersRouter from "./brokers";
import dataProvidersRouter from "./data-providers";
import featureFlagsRouter from "./feature-flags";
import invoicesRouter from "./invoices";
import paymentWebhooksRouter from "./payment-webhooks";
import tradingSettingsRouter from "./trading-settings";
import inferenceGatewayRouter from "./inference-gateway";
import tradeIntelligenceRouter from "./trade-intelligence";
import deploymentsRouter from "./deployments";
import operationalRouter from "./operational";
import providerManagementRouter from "./provider-management";
import securityRouter from "./security";
import researchLabRouter from "./research-lab";
import rolesRouter from "./roles";
import ssoRouter from "./sso";
import opsDashboardRouter from "./ops-dashboard";
import resilienceRouter from "./resilience";
import { blockWhenLocked } from "../middlewares/blockWhenLocked";

const router: IRouter = Router();

router.use(healthRouter);
// Payment webhooks must be reachable regardless of maintenance-lock state
// (a provider will retry-storm us if we 503 every delivery) and are
// authenticated by signature verification, not Clerk auth — mounted before
// blockWhenLocked and any auth middleware.
router.use("/payments/webhooks", paymentWebhooksRouter);
router.use("/account", accountSecurityRouter);
router.use(blockWhenLocked);
router.use("/plans", plansRouter);
router.use("/subscriptions", subscriptionsRouter);
router.use("/eas", easRouter);
router.use("/runtime", runtimeRouter);
router.use("/users", usersRouter);
router.use("/stats", statsRouter);
router.use("/payments", paymentsRouter);
router.use("/invoices", invoicesRouter);
router.use("/smtp", smtpRouter);
router.use("/api-keys", apiKeysRouter);
router.use("/ea-registrations", eaRegistrationsRouter);
router.use("/ea-builds", eaBuildsRouter);
router.use("/symbols", symbolsRouter);
router.use("/qde", qdeRouter);
router.use(storageRouter);
router.use("/seo", seoRouter);
router.use("/media", mediaRouter);
router.use("/notifications", notificationsRouter);
router.use("/announcements", announcementsRouter);
router.use("/maintenance-banner", maintenanceBannerRouter);
router.use("/support/tickets", supportTicketsRouter);
router.use("/contact", contactRouter);
router.use("/kb", knowledgeBaseRouter);
router.use("/status", statusRouter);
router.use("/referrals", referralsRouter);
router.use("/audit-log", auditLogRouter);
router.use("/brokers", brokersRouter);
router.use("/data-providers", dataProvidersRouter);
router.use("/feature-flags", featureFlagsRouter);
router.use("/trading-settings", tradingSettingsRouter);
// S18: inference gateway routes merge into /qde namespace alongside existing qdeRouter
router.use("/qde", inferenceGatewayRouter);
// S19: trade telemetry & learning-loop intelligence routes also under /qde
router.use("/qde", tradeIntelligenceRouter);
// S21B: deployment client and hot-swap management routes under /qde
router.use("/qde", deploymentsRouter);
// S22A: operational infrastructure — telemetry, heartbeat, incidents, alerts
router.use("/operational", operationalRouter);
// S18: extended provider management (credentials, capabilities, status, mappings)
// Mounted at /data-providers so it shares the same base path as dataProvidersRouter
router.use("/data-providers", providerManagementRouter);
// S23c: Security Operations — automated security-incident findings (distinct from audit-log's admin-action trail)
router.use("/security", securityRouter);
// S24B: Research Lab Integration Hub — admin gateway/proxy to signalium-trainer's research/training/deployment APIs
router.use("/research-lab", researchLabRouter);
// S24C: fine-grained admin role management (SuperAdmin-only) — grant/revoke/assume
router.use("/admin/roles", rolesRouter);
// S24C: SSO Identity Provider — token issuance/refresh/revocation/verification for trusted internal services
router.use("/sso", ssoRouter);
// S25: unified Operations Dashboard — admin-only aggregate read across all ops surfaces
router.use("/ops-dashboard", opsDashboardRouter);
// S26: Scalability/HA/DR — backups, job-queue, circuit breakers, secret rotation, config export/restore
router.use("/resilience", resilienceRouter);

export default router;

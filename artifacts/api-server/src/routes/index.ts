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

const router: IRouter = Router();

router.use(healthRouter);
router.use("/plans", plansRouter);
router.use("/subscriptions", subscriptionsRouter);
router.use("/eas", easRouter);
router.use("/runtime", runtimeRouter);
router.use("/users", usersRouter);
router.use("/stats", statsRouter);
router.use("/payments", paymentsRouter);
router.use("/smtp", smtpRouter);
router.use("/api-keys", apiKeysRouter);
router.use("/ea-registrations", eaRegistrationsRouter);
router.use("/ea-builds", eaBuildsRouter);

export default router;

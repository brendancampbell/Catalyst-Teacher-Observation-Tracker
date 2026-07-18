import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import districtRouter from "./district";
import teachersRouter from "./teachers";
import observationsRouter from "./observations";
import rubricRouter from "./rubric";
import adminSchoolsRouter from "./admin-schools";
import actionCenterRouter from "./action-center";
import actionStepsRouter from "./action-steps";
import aiRouter from "./ai";
import emailRouter from "./email";
import peopleRouter from "./people";
import qualitativeThemesRouter from "./qualitative-themes";
import adminSchoolYearsRouter from "./admin-school-years";
import { requireAuth, requireNetworkScope, enforceSchoolScope } from "../middleware/auth";
import { isProduction } from "../config/env";

const router: IRouter = Router();

router.use("/auth", authRouter);
/* Dev-only auth bypass — route is never registered in production */
if (!isProduction) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: devAuthRouter } = require("./dev-auth") as { default: import("express").Router };
  router.use("/auth", devAuthRouter);
}
/* Health check — no auth, must be publicly reachable for deployment probe */
router.use(healthRouter);

router.use("/dashboard",    requireAuth, enforceSchoolScope, dashboardRouter);
router.use("/district",     requireAuth, requireNetworkScope, districtRouter);
router.use("/teachers",     requireAuth, teachersRouter);
router.use("/observations", requireAuth, observationsRouter);
router.use("/rubric",       requireAuth, rubricRouter);
router.use("/people",       requireAuth, peopleRouter);
router.use("/admin/schools",      requireAuth, requireNetworkScope, adminSchoolsRouter);
router.use("/admin/school-years", requireAuth, adminSchoolYearsRouter);
router.use("/action-center",requireAuth, actionCenterRouter);
router.use("/action-steps", requireAuth, actionStepsRouter);
router.use("/ai",                  requireAuth, aiRouter);
router.use("/email",               requireAuth, emailRouter);
router.use("/qualitative-themes",  requireAuth, qualitativeThemesRouter);

export default router;

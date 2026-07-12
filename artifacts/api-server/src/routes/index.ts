import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import devAuthRouter from "./dev-auth";
import dashboardRouter from "./dashboard";
import districtRouter from "./district";
import teachersRouter from "./teachers";
import observationsRouter from "./observations";
import rubricRouter from "./rubric";
import adminSchoolsRouter from "./admin-schools";
import actionCenterRouter from "./action-center";
import aiRouter from "./ai";
import emailRouter from "./email";
import peopleRouter from "./people";
import { requireAuth, requireNetworkScope, enforceSchoolScope } from "../middleware/auth";

const router: IRouter = Router();

router.use("/auth", authRouter);
/* Dev-only auth bypass — disabled in production inside the handler */
router.use("/auth", devAuthRouter);
/* Health check — no auth, must be publicly reachable for deployment probe */
router.use(healthRouter);

router.use("/dashboard",    requireAuth, enforceSchoolScope, dashboardRouter);
router.use("/district",     requireAuth, requireNetworkScope, districtRouter);
router.use("/teachers",     requireAuth, teachersRouter);
router.use("/observations", requireAuth, observationsRouter);
router.use("/rubric",       requireAuth, rubricRouter);
router.use("/people",       requireAuth, peopleRouter);
router.use("/admin/schools",requireAuth, requireNetworkScope, adminSchoolsRouter);
router.use("/action-center",requireAuth, actionCenterRouter);
router.use("/ai",           requireAuth, aiRouter);
router.use("/email",        requireAuth, emailRouter);

export default router;

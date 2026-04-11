import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import dashboardRouter from "./dashboard";
import districtRouter from "./district";
import teachersRouter from "./teachers";
import observationsRouter from "./observations";
import rubricRouter from "./rubric";
import usersRouter from "./users";
import adminTeachersRouter from "./admin-teachers";
import adminSchoolsRouter from "./admin-schools";
import actionCenterRouter from "./action-center";
import { requireAuth, requireNetworkScope, requireNetworkAdmin, enforceSchoolScope } from "../middleware/auth";

const router: IRouter = Router();

router.use("/auth", authRouter);
router.use(requireAuth, healthRouter);

router.use("/dashboard",      requireAuth, enforceSchoolScope, dashboardRouter);
router.use("/district",       requireAuth, requireNetworkScope, districtRouter);
router.use("/teachers",       requireAuth, teachersRouter);
router.use("/observations",   requireAuth, observationsRouter);
router.use("/rubric",         requireAuth, rubricRouter);
router.use("/users",          requireAuth, usersRouter);
router.use("/admin/teachers", requireAuth, adminTeachersRouter);
router.use("/admin/schools",  requireAuth, requireNetworkScope, adminSchoolsRouter);
router.use("/action-center",  requireAuth, actionCenterRouter);

export default router;

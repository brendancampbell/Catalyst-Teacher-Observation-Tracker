import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import districtRouter from "./district";
import teachersRouter from "./teachers";
import observationsRouter from "./observations";
import rubricRouter from "./rubric";
import usersRouter from "./users";
import adminTeachersRouter from "./admin-teachers";
import adminSchoolsRouter from "./admin-schools";
import actionCenterRouter from "./action-center";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/dashboard", dashboardRouter);
router.use("/district", districtRouter);
router.use("/teachers", teachersRouter);
router.use("/observations", observationsRouter);
router.use("/rubric", rubricRouter);
router.use("/users", usersRouter);
router.use("/admin/teachers", adminTeachersRouter);
router.use("/admin/schools", adminSchoolsRouter);
router.use("/action-center", actionCenterRouter);

export default router;

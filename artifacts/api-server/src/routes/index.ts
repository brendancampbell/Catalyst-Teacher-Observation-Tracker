import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import teachersRouter from "./teachers";
import observationsRouter from "./observations";
import rubricRouter from "./rubric";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/dashboard", dashboardRouter);
router.use("/teachers", teachersRouter);
router.use("/observations", observationsRouter);
router.use("/rubric", rubricRouter);

export default router;

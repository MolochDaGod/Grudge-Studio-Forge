import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import scenesRouter from "./scenes";
import scriptsRouter from "./scripts";
import assetsRouter from "./assets";
import grudgeRouter from "./grudge";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(scenesRouter);
router.use(scriptsRouter);
router.use(assetsRouter);
router.use(grudgeRouter);
router.use(storageRouter);

export default router;

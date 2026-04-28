import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import scenesRouter from "./scenes";
import scriptsRouter from "./scripts";
import assetsRouter from "./assets";
import prefabsRouter from "./prefabs";
import grudgeRouter from "./grudge";
import polyhavenRouter from "./polyhaven";
import storageRouter from "./storage";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(scenesRouter);
router.use(scriptsRouter);
router.use(assetsRouter);
router.use(prefabsRouter);
router.use(grudgeRouter);
router.use(polyhavenRouter);
router.use(storageRouter);
router.use(aiRouter);

export default router;

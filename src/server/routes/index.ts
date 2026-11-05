import { Router } from "express";
import { Logger } from "../../logger";
import { DeidentificationService } from "../../service/service";
import { deidentifyRouter } from "./deidentify";
import { entitiesRouter } from "./entities";
import { healthRouter } from "./health";

export function createRoutes(service: DeidentificationService, logger: Logger): Router {
  const router = Router();
  router.use(healthRouter());
  router.use(entitiesRouter(service));
  router.use(deidentifyRouter(service, logger));
  return router;
}

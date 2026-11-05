import { Router } from "express";
import { DeidentificationService } from "../services/deidentification.service";
import { Logger } from "../utils/logger";
import { deidentifyRoutes } from "./deidentify.routes";
import { entitiesRoutes } from "./entities.routes";
import { healthRoutes } from "./health.routes";

export function createRoutes(service: DeidentificationService, logger: Logger): Router {
  const router = Router();
  router.use(healthRoutes());
  router.use(entitiesRoutes(service));
  router.use(deidentifyRoutes(service, logger));
  return router;
}

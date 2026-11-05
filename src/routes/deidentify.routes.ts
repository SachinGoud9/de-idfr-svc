import { Router } from "express";
import { deidentify, deidentifyBatch } from "../controllers/deidentify.controller";
import { DeidentificationService } from "../services/deidentification.service";
import { Logger } from "../utils/logger";

export function deidentifyRoutes(service: DeidentificationService, logger: Logger): Router {
  const router = Router();
  router.post("/deidentify", deidentify(service, logger));
  router.post("/deidentify/batch", deidentifyBatch(service, logger));
  return router;
}

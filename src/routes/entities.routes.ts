import { Router } from "express";
import { listEntities } from "../controllers/entities.controller";
import { DeidentificationService } from "../services/deidentification.service";

export function entitiesRoutes(service: DeidentificationService): Router {
  const router = Router();
  router.get("/entities", listEntities(service));
  return router;
}

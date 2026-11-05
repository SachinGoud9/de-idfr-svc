import { Router } from "express";
import { DeidentificationService } from "../../service/service";

export function entitiesRouter(service: DeidentificationService): Router {
  const router = Router();
  router.get("/entities", (_req, res) =>
    res.json({ supported: service.registry.entities(), default: service.registry.defaultEntities() })
  );
  return router;
}

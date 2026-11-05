import { Request, Router } from "express";
import { Logger } from "../../logger";
import { DeidentificationService, ValidationError } from "../../service/service";

const body = (req: Request) => {
  if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  return req.body as Record<string, unknown>;
};

export function deidentifyRouter(service: DeidentificationService, logger: Logger): Router {
  const router = Router();

  router.post("/deidentify", (req, res, next) => {
    try {
      const b = body(req);
      const result = service.deidentify(b.text, { entities: b.entities });
      logger.info("De-identified text", {
        requestId: req.id,
        chars: (b.text as string).length,
        entitiesFound: Object.values(result.entitiesDetected).reduce((a, n) => a + n, 0),
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  router.post("/deidentify/batch", (req, res, next) => {
    try {
      const b = body(req);
      const results = service.deidentifyBatch(b.records, { entities: b.entities });
      logger.info("De-identified batch", { requestId: req.id, records: results.length });
      res.json({ results });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

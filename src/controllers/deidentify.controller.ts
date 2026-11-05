import { Request, RequestHandler } from "express";
import { ValidationError } from "../errors";
import { DeidentificationService } from "../services/deidentification.service";
import { Logger } from "../utils/logger";

const body = (req: Request) => {
  if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  return req.body as Record<string, unknown>;
};

export function deidentify(service: DeidentificationService, logger: Logger): RequestHandler {
  return (req, res, next) => {
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
  };
}

export function deidentifyBatch(service: DeidentificationService, logger: Logger): RequestHandler {
  return (req, res, next) => {
    try {
      const b = body(req);
      const results = service.deidentifyBatch(b.records, { entities: b.entities });
      logger.info("De-identified batch", { requestId: req.id, records: results.length });
      res.json({ results });
    } catch (e) {
      next(e);
    }
  };
}

import { RequestHandler } from "express";
import { DeidentificationService } from "../services/deidentification.service";

export function listEntities(service: DeidentificationService): RequestHandler {
  return (_req, res) =>
    res.json({ supported: service.registry.entities(), default: service.registry.defaultEntities() });
}

import express, { NextFunction, Request, Response } from "express";
import { Logger, silentLogger } from "./logger";
import {
  authenticate,
  rateLimit,
  requestId,
  requestLogger,
  requireJson,
  securityHeaders,
} from "./middleware";
import { TokenVerifier } from "./oauth";
import { DeidentificationService, ValidationError } from "./service";

export interface AppOptions {
  // Where request and error logs go. Defaults to silent so tests and library use stay quiet.
  logger?: Logger;
  bodyLimit?: string;
  // Max requests per IP per window. Leave out (or 0) to disable.
  rateLimit?: { max: number; windowMs: number };
  // If non-empty, callers must send one of these as `X-API-Key` or `Authorization: Bearer`.
  apiKeys?: string[];
  // OAuth 2.0 access-token check. Combine with apiKeys to accept either credential.
  tokenVerifier?: TokenVerifier;
  // Set when running behind a reverse proxy so req.ip is the real client address.
  trustProxy?: boolean;
}

export function createApp(service = new DeidentificationService(), options: AppOptions = {}) {
  const logger = options.logger ?? silentLogger;
  const app = express();
  app.disable("x-powered-by");
  if (options.trustProxy) app.set("trust proxy", true);

  app.use(requestId());
  app.use(securityHeaders());
  app.use(requestLogger(logger));
  if (options.rateLimit && options.rateLimit.max > 0) app.use(rateLimit(options.rateLimit));
  if (options.apiKeys?.length || options.tokenVerifier) {
    app.use(authenticate({ apiKeys: options.apiKeys, verifier: options.tokenVerifier, logger }));
  }
  app.use(requireJson());
  app.use(express.json({ limit: options.bodyLimit ?? "2mb" }));

  const body = (req: Request) => {
    if (typeof req.body !== "object" || req.body === null || Array.isArray(req.body)) {
      throw new ValidationError("Request body must be a JSON object");
    }
    return req.body as Record<string, unknown>;
  };

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.get("/entities", (_req, res) =>
    res.json({ supported: service.registry.entities(), default: service.registry.defaultEntities() })
  );

  app.post("/deidentify", (req, res, next) => {
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

  app.post("/deidentify/batch", (req, res, next) => {
    try {
      const b = body(req);
      const results = service.deidentifyBatch(b.records, { entities: b.entities });
      logger.info("De-identified batch", { requestId: req.id, records: results.length });
      res.json({ results });
    } catch (e) {
      next(e);
    }
  });

  app.use((req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}`, requestId: req.id });
  });

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.id;
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message, requestId });
    if (err?.type === "entity.parse.failed")
      return res.status(400).json({ error: "Malformed JSON body", requestId });
    if (err?.type === "entity.too.large")
      return res.status(413).json({ error: "Request body too large", requestId });
    // Log the message and stack only. Never the request, which may hold PII.
    logger.error("Unhandled error", { requestId, message: String(err?.message ?? err), stack: err?.stack });
    res.status(500).json({ error: "Internal server error", requestId });
  });

  return app;
}

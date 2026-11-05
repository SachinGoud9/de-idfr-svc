import express from "express";
import {
  authenticate,
  errorHandler,
  notFound,
  rateLimit,
  requestId,
  requestLogger,
  requireJson,
  securityHeaders,
} from "./middleware";
import { createRoutes } from "./routes";
import { DeidentificationService } from "./services/deidentification.service";
import { TokenVerifier } from "./services/token-verifier.service";
import { Logger, silentLogger } from "./utils/logger";

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

  app.use(createRoutes(service, logger));
  app.use(notFound());
  app.use(errorHandler(logger));

  return app;
}

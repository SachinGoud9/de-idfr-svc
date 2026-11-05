import { RequestHandler } from "express";
import { Logger } from "../utils/logger";

// One line when the request arrives, one when it finishes. Path only, never the query
// string or the body, since both can carry PII.
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    logger.info(`Called ${req.method} ${req.path}`, { requestId: req.id });
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.info(`Completed ${req.method} ${req.path} with status ${res.statusCode}`, {
        requestId: req.id,
        durationMs: Number(ms.toFixed(1)),
        subject: req.auth?.sub,
      });
    });
    next();
  };
}

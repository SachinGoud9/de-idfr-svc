import { NextFunction, Request, Response } from "express";
import { ValidationError } from "../errors";
import { Logger } from "../utils/logger";

// Maps errors to HTTP responses. Mount last.
export function errorHandler(logger: Logger) {
  return (err: any, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.id;
    if (err instanceof ValidationError) return res.status(400).json({ error: err.message, requestId });
    if (err?.type === "entity.parse.failed")
      return res.status(400).json({ error: "Malformed JSON body", requestId });
    if (err?.type === "entity.too.large")
      return res.status(413).json({ error: "Request body too large", requestId });
    // Log the message and stack only. Never the request, which may hold PII.
    logger.error("Unhandled error", { requestId, message: String(err?.message ?? err), stack: err?.stack });
    res.status(500).json({ error: "Internal server error", requestId });
  };
}

export function notFound() {
  return (req: Request, res: Response) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}`, requestId: req.id });
  };
}

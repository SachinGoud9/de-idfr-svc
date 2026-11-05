import { randomUUID } from "node:crypto";
import { RequestHandler } from "express";

// Every request gets an id so a log line can be matched to the response a caller saw.
// We reuse the caller's X-Request-Id only if it is short and boring, to avoid log injection.
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header("x-request-id");
    req.id = incoming && /^[A-Za-z0-9._-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("X-Request-Id", req.id);
    next();
  };
}

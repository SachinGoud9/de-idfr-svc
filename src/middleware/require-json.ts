import { RequestHandler } from "express";

// express.json silently ignores bodies with the wrong content type, which would turn
// "forgot the header" into a confusing "text is required". Say what is actually wrong.
export function requireJson(): RequestHandler {
  return (req, res, next) => {
    if (req.method === "POST" && !req.is("application/json")) {
      res.status(415).json({ error: "Content-Type must be application/json", requestId: req.id });
      return;
    }
    next();
  };
}

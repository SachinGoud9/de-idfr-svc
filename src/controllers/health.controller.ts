import { RequestHandler } from "express";

export const health: RequestHandler = (_req, res) => {
  res.json({ status: "ok" });
};

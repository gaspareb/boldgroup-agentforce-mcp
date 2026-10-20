import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const [scheme, headerToken] = header.split(" ");
  const bearerToken = scheme === "Bearer" ? headerToken : undefined;

  // Query-param fallback: some MCP clients (e.g. Claude's "No sign-in" connector mode) don't
  // offer a field for a custom Authorization header, only a URL - so accept the key embedded
  // there too (e.g. https://host/mcp?key=...), at the same protection level as the header.
  const queryToken = typeof req.query.key === "string" ? req.query.key : undefined;

  const token = bearerToken ?? queryToken;

  if (!token || !safeEqual(token, env.MCP_SERVER_API_KEY)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "resource") => new AppError(404, "not_found", `${what} not found`);
export const forbidden = (permission?: string) => new AppError(403, "forbidden", permission ? `missing permission ${permission}` : "forbidden");
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);

export function onError(err: Error, c: Context) {
  if (err instanceof AppError) return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  if (err instanceof ZodError) return c.json({ error: { code: "invalid_input", message: "invalid input", details: err.issues } }, 400);
  if (err instanceof HTTPException) return err.getResponse();
  console.error("[api] unhandled", err);
  return c.json({ error: { code: "internal", message: "internal error" } }, 500);
}

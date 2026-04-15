import { captureException } from "../client.js";
import { runWithScope } from "../request-context.js";
import type { WatchdockCaptureContext, WatchdockRequestPayload, WatchdockUserPayload } from "../types.js";
import { buildRequestUrl } from "../utils.js";

export interface ExpressLikeRequest {
  method: string;
  protocol?: string;
  originalUrl?: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  body?: unknown;
  user?: unknown;
  get(name: string): string | undefined;
}

export interface ExpressLikeResponse {}

export type ExpressNextFunction = (error?: unknown) => void;
export type ExpressMiddleware = (
  req: ExpressLikeRequest,
  res: ExpressLikeResponse,
  next: ExpressNextFunction,
) => void;
export type ExpressErrorMiddleware = (
  error: unknown,
  req: ExpressLikeRequest,
  res: ExpressLikeResponse,
  next: ExpressNextFunction,
) => void;

export interface ExpressMiddlewareOptions {
  mapUser?: (req: ExpressLikeRequest) => WatchdockUserPayload | undefined;
  includeBody?: boolean;
}

export function watchdockRequestHandler(options: ExpressMiddlewareOptions = {}): ExpressMiddleware {
  return function watchdockRequest(req: ExpressLikeRequest, _res: ExpressLikeResponse, next: ExpressNextFunction): void {
    const scope = {
      request: buildRequestPayload(req, options.includeBody ?? false),
      user: options.mapUser?.(req),
    };

    runWithScope(scope, () => next());
  };
}

export function watchdockErrorHandler(
  contextBuilder?: (error: unknown, req: ExpressLikeRequest) => WatchdockCaptureContext | undefined,
): ExpressErrorMiddleware {
  return function expressWatchdockError(error, req, _res, next) {
    captureException(error, {
      request: buildRequestPayload(req, true),
      ...(contextBuilder?.(error, req) ?? {}),
    });
    next(error);
  };
}

function buildRequestPayload(req: ExpressLikeRequest, includeBody: boolean): WatchdockRequestPayload {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      headers[key] = value.join(", ");
      continue;
    }
    if (typeof value === "string") {
      headers[key] = value;
    }
  }

  return {
    method: req.method,
    url: buildRequestUrl(req.protocol, req.get("host"), req.originalUrl || req.url),
    headers,
    query_params: req.query as Record<string, unknown>,
    body: includeBody ? req.body : undefined,
  };
}

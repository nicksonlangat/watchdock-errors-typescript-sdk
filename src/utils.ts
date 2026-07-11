import os from "node:os";

import type {
  WatchdockCaptureContext,
  WatchdockEventPayload,
  WatchdockExceptionPayload,
  WatchdockRequestPayload,
  WatchdockScope,
  WatchdockServerPayload,
  WatchdockStackFrame,
  WatchdockUserPayload,
} from "./types.js";

const DEFAULT_MAX_BODY_LENGTH = 8_000;

export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string") {
    return new Error(value);
  }

  return new Error("Non-error thrown");
}

export function buildExceptionPayload(error: Error): WatchdockExceptionPayload {
  return {
    type: error.name || "Error",
    message: error.message || "Unknown error",
    stacktrace: parseStack(error.stack),
  };
}

export function parseStack(stack?: string): WatchdockStackFrame[] {
  if (!stack) {
    return [];
  }

  return stack
    .split("\n")
    .slice(1)
    .map((line) => parseStackLine(line))
    .filter((frame): frame is WatchdockStackFrame => frame !== null);
}

function parseStackLine(line: string): WatchdockStackFrame | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("at ")) {
    return null;
  }

  const withFunction = /^at\s+(.*?)\s+\((.*?):(\d+):(\d+)\)$/;
  const withoutFunction = /^at\s+(.*?):(\d+):(\d+)$/;

  let match = trimmed.match(withFunction);
  if (match) {
    return {
      function: match[1],
      filename: normalizeFilename(match[2]),
      lineno: Number(match[3]),
    };
  }

  match = trimmed.match(withoutFunction);
  if (match) {
    return {
      filename: normalizeFilename(match[1]),
      lineno: Number(match[2]),
    };
  }

  return {
    filename: trimmed.replace(/^at\s+/, ""),
  };
}

function normalizeFilename(filename: string): string {
  if (filename.startsWith("file://")) {
    return filename.replace("file://", "");
  }
  return filename;
}

export function buildServerPayload(serverName?: string, server?: WatchdockServerPayload): WatchdockServerPayload {
  return {
    hostname: server?.hostname || serverName || os.hostname(),
    runtime: server?.runtime || "node",
    runtime_version: server?.runtime_version || process.version,
    platform: server?.platform || `${process.platform}/${process.arch}`,
    ...server,
  };
}

export function mergeScope(
  scope: WatchdockScope | undefined,
  context: WatchdockCaptureContext | undefined,
): WatchdockCaptureContext {
  return {
    ...context,
    request: {
      ...(scope?.request ?? {}),
      ...(context?.request ?? {}),
    },
    user: {
      ...(scope?.user ?? {}),
      ...(context?.user ?? {}),
    },
    server: {
      ...(scope?.server ?? {}),
      ...(context?.server ?? {}),
    },
  };
}

export function sanitizeEvent(event: WatchdockEventPayload, sendPii: boolean): WatchdockEventPayload {
  const sanitizedHeaders = sanitizeHeaders(event.request?.headers ?? {}, sendPii);
  const sanitizedBody = sanitizeBody(event.request?.body, sendPii);

  return {
    ...event,
    request: event.request
      ? {
          ...event.request,
          headers: sanitizedHeaders,
          body: sanitizedBody,
        }
      : undefined,
    user: sendPii ? event.user : redactUser(event.user),
  };
}

function sanitizeHeaders(headers: Record<string, string>, sendPii: boolean): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    if (normalized === "authorization" || normalized === "cookie" || normalized === "set-cookie") {
      result[key] = "[REDACTED]";
      continue;
    }

    if (!sendPii && normalized === "x-forwarded-for") {
      result[key] = "[REDACTED]";
      continue;
    }

    result[key] = value;
  }

  return result;
}

function redactUser(user?: WatchdockUserPayload): WatchdockUserPayload | undefined {
  if (!user) {
    return undefined;
  }

  const redacted: WatchdockUserPayload = {};
  if (user.id !== undefined) {
    redacted.id = user.id;
  }
  if (user.username !== undefined) {
    redacted.username = user.username;
  }
  return Object.keys(redacted).length ? redacted : undefined;
}

function sanitizeBody(body: unknown, sendPii: boolean): unknown {
  if (sendPii) {
    return truncateBody(body);
  }

  if (body === undefined || body === null) {
    return body;
  }

  if (typeof body === "string") {
    return "[REDACTED]";
  }

  if (typeof body === "object") {
    return "[REDACTED]";
  }

  return body;
}

function truncateBody(body: unknown): unknown {
  if (typeof body === "string") {
    return body.length > DEFAULT_MAX_BODY_LENGTH ? `${body.slice(0, DEFAULT_MAX_BODY_LENGTH)}…` : body;
  }

  try {
    const serialized = JSON.stringify(body);
    if (!serialized) {
      return body;
    }
    if (serialized.length <= DEFAULT_MAX_BODY_LENGTH) {
      return body;
    }
    return `${serialized.slice(0, DEFAULT_MAX_BODY_LENGTH)}…`;
  } catch {
    return "[Unserializable body]";
  }
}

/**
 * Pulls a correlation ID off incoming request headers so this event can be
 * linked back to the nginx access log line for the same request. Prefers
 * `X-Request-Id` (nginx's built-in `$request_id`, zero extra modules
 * required) and falls back to the trace-id segment of a W3C `traceparent`
 * header if present.
 */
export function extractTraceId(headers?: Record<string, string>): string | undefined {
  if (!headers) {
    return undefined;
  }

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }

  const requestId = normalized["x-request-id"];
  if (requestId) {
    return requestId;
  }

  const traceparent = normalized["traceparent"];
  if (traceparent) {
    const parts = traceparent.split("-");
    if (parts.length >= 2 && parts[1]) {
      return parts[1];
    }
  }

  return undefined;
}

export function normalizeUrl(input: string): string {
  if (!input) {
    return input;
  }
  if (input.startsWith("http://") || input.startsWith("https://")) {
    return input;
  }
  return `https://${input}`;
}

export function buildRequestUrl(protocol: string | undefined, host: string | undefined, originalUrl: string): string {
  if (!host) {
    return originalUrl;
  }
  return `${protocol || "http"}://${host}${originalUrl}`;
}

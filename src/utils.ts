import fs from "node:fs";
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
  const stacktrace = parseStack(error.stack);
  enrichFramesWithContext(stacktrace);
  return {
    type: error.name || "Error",
    message: error.message || "Unknown error",
    stacktrace,
  };
}

/** Source lines captured on each side of a frame's failing line. */
const CONTEXT_LINES = 2;

/**
 * Fills context_line / pre_context / post_context on each frame by reading the
 * source file around the failing line, on the machine where the code runs (the
 * only place the source actually is). Frames whose file can't be read (native
 * modules, bundled output, files not on disk) keep just their location.
 *
 * Line numbers point at the *running* JavaScript, so for TypeScript compiled
 * without inline source maps the context is the compiled line; plain JS is
 * exact. Reading is best-effort and never throws into the caller.
 */
export function enrichFramesWithContext(frames: WatchdockStackFrame[]): void {
  const cache = new Map<string, string[] | null>();

  for (const frame of frames) {
    if (!frame.filename || !frame.lineno) {
      continue;
    }
    const lines = readFileLines(frame.filename, cache);
    if (!lines) {
      continue;
    }
    const idx = frame.lineno - 1; // frame line numbers are 1-based
    if (idx < 0 || idx >= lines.length) {
      continue;
    }

    const at = (n: number): string => (n >= 1 && n - 1 < lines.length ? lines[n - 1] : "");

    frame.context_line = at(frame.lineno).trim();
    frame.pre_context = [];
    for (let i = frame.lineno - CONTEXT_LINES; i < frame.lineno; i++) {
      frame.pre_context.push(at(i));
    }
    frame.post_context = [];
    for (let i = frame.lineno + 1; i <= frame.lineno + CONTEXT_LINES; i++) {
      frame.post_context.push(at(i));
    }
  }
}

function readFileLines(filename: string, cache: Map<string, string[] | null>): string[] | null {
  const cached = cache.get(filename);
  if (cached !== undefined) {
    return cached;
  }

  let lines: string[] | null = null;
  try {
    // Skip virtual paths (e.g. "node:internal/...") that aren't real files.
    if (!filename.startsWith("node:")) {
      lines = fs.readFileSync(filename, "utf8").split(/\r?\n/);
    }
  } catch {
    lines = null;
  }

  cache.set(filename, lines);
  return lines;
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

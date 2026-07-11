# Watchdock Errors TypeScript

Watchdock's error tracking SDK for Node.js backends.

It captures handled and unhandled server-side errors, formats them into the payload expected by the Watchdock backend, and sends them to:

- `POST /api/v1/error-events/`

## Install

```bash
npm install watchdock-errors
```

Node `18+` is required.

## Quick Start

```ts
import { init, captureException, captureMessage } from "watchdock-errors";

init({
  apiKey: "wdk_your_tracking_key",
  environment: "production",
  release: "1.0.0",
  serverName: "api-1",
  sendPii: false,
});

try {
  throw new Error("Payment provider rejected request");
} catch (error) {
  captureException(error);
}

captureMessage("Background job completed with partial failures");

// Override the default level via context
captureMessage("Queue depth high", { level: "warning" });
```

## Express Integration

```ts
import express from "express";
import {
  watchdockErrorHandler,
  watchdockRequestHandler,
} from "watchdock-errors/express";
import { init } from "watchdock-errors";

init({
  apiKey: process.env.WATCHDOCK_API_KEY!,
  environment: process.env.NODE_ENV,
});

const app = express();

app.use(express.json());
app.use(
  watchdockRequestHandler({
    includeBody: false,
    mapUser: (req) =>
      req.user
        ? {
            id: (req.user as { id?: string }).id,
            email: (req.user as { email?: string }).email,
          }
        : undefined,
  }),
);

app.get("/boom", () => {
  throw new Error("Unexpected crash");
});

app.use(watchdockErrorHandler());
```

## API

### `init(options)`

```ts
init({
  apiKey: "wdk_xxx",
  endpoint: "https://api.watchdock.cc/api/v1/error-events/",
  environment: "production",
  release: "1.2.3",
  serverName: "api-1",
  sendPii: false,
  beforeSend: async (event) => {
    delete event.request?.headers?.authorization;
    return event;
  },
  onError: (error) => {
    console.error("Watchdock send failed", error);
  },
});
```

### `captureException(error, context?)`

Captures an `Error` object or any thrown value. Defaults to `level: "error"` unless overridden via `context.level`.

### `captureMessage(message, context?)`

Captures a non-exception event as a `"Message"` issue. Defaults to `level: "info"` unless overridden via `context.level`.

### `flush()`

Waits for any queued sends to finish. Useful before shutting down a process.

## Correlating with nginx requests

If your app is behind nginx and you've added `$request_id` to your access log format (see the [nginx log collection docs](https://watchdock.cc/docs/nginx-log-collection)) and forwarded it to your app via `proxy_set_header X-Request-Id $request_id;`, this SDK automatically reads that header off the request and attaches it as `trace_id` — no code changes needed. This lets WatchDock link a failed request in your nginx access logs directly to the exception it produced.

You can also pass `trace_id` explicitly via context, which takes priority over the auto-extracted value:

```ts
captureException(error, { trace_id: myTraceId });
captureMessage("Queue depth high", { level: "warning", trace_id: myTraceId });
```

## Notes

- The SDK authenticates with `Authorization: Bearer wdk_...`.
- Request headers like `Authorization` and `Cookie` are always redacted.
- When `sendPii` is `false`, request bodies are redacted and user email is omitted.
- The SDK is intentionally lightweight and uses the global `fetch` available in Node 18+.
- On `init()`, the SDK schedules a one-time, fire-and-forget ping to the platform (with the SDK version and environment) to register that it started up. This never blocks startup and any failure is silently ignored.

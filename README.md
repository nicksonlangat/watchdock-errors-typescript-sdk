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

Captures an `Error` object or any thrown value.

### `captureMessage(message, context?)`

Captures a non-exception event as a `"Message"` issue.

### `flush()`

Waits for any queued sends to finish. Useful before shutting down a process.

## Notes

- The SDK authenticates with `Authorization: Bearer wdk_...`.
- Request headers like `Authorization` and `Cookie` are always redacted.
- When `sendPii` is `false`, request bodies are redacted and user email is omitted.
- The SDK is intentionally lightweight and uses the global `fetch` available in Node 18+.

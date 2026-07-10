import { getCurrentScope } from "./request-context.js";
import type { WatchdockCaptureContext, WatchdockClientState, WatchdockEventPayload, WatchdockInitOptions } from "./types.js";
import { buildExceptionPayload, buildServerPayload, mergeScope, normalizeUrl, sanitizeEvent, toError } from "./utils.js";

const SDK_NAME = "watchdock-errors-typescript";
const SDK_VERSION = "0.1.0";
const DEFAULT_ENDPOINT = "https://api.watchdock.cc/api/v1/error-events/";

class WatchdockClient {
  private state: WatchdockClientState | null = null;
  private queue = new Set<Promise<void>>();

  init(options: WatchdockInitOptions): void {
    if (!options.apiKey || !options.apiKey.startsWith("wdk_")) {
      throw new Error("Watchdock apiKey must start with 'wdk_'");
    }

    const endpoint = options.endpoint ? normalizeUrl(options.endpoint) : DEFAULT_ENDPOINT;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;

    if (!fetchImpl) {
      throw new Error("No fetch implementation available. Use Node 18+ or pass fetchImpl.");
    }

    this.state = {
      apiKey: options.apiKey,
      endpoint,
      environment: options.environment,
      release: options.release,
      serverName: options.serverName,
      sendPii: options.sendPii ?? false,
      beforeSend: options.beforeSend,
      onError: options.onError,
      fetchImpl,
    };

    sendInitPing(this.state);
  }

  isInitialized(): boolean {
    return this.state !== null;
  }

  captureException(error: unknown, context?: WatchdockCaptureContext): void {
    const normalized = toError(error);
    this.enqueueEvent({
      title: context?.title,
      environment: context?.environment,
      level: context?.level || "error",
      release: context?.release,
      exception: buildExceptionPayload(normalized),
      request: context?.request,
      user: context?.user,
      server: context?.server,
    });
  }

  captureMessage(message: string, context?: WatchdockCaptureContext): void {
    this.enqueueEvent({
      title: context?.title || message,
      environment: context?.environment,
      level: context?.level || "info",
      release: context?.release,
      exception: {
        type: "Message",
        message,
        stacktrace: [],
      },
      request: context?.request,
      user: context?.user,
      server: context?.server,
    });
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.queue]);
  }

  private enqueueEvent(partial: Omit<WatchdockEventPayload, "timestamp" | "sdk">): void {
    if (!this.state) {
      return;
    }

    const task = this.send(partial).finally(() => {
      this.queue.delete(task);
    });

    this.queue.add(task);
  }

  private async send(partial: Omit<WatchdockEventPayload, "timestamp" | "sdk">): Promise<void> {
    const state = this.state;
    if (!state) {
      return;
    }

    try {
      const mergedContext = mergeScope(getCurrentScope(), {
        request: partial.request,
        user: partial.user,
        server: partial.server,
        title: partial.title,
        environment: partial.environment,
        level: partial.level,
        release: partial.release,
      });

      let event: WatchdockEventPayload = sanitizeEvent(
        {
          project_key: state.apiKey,
          title: mergedContext.title || partial.title,
          timestamp: new Date().toISOString(),
          environment: mergedContext.environment || state.environment || "production",
          level: mergedContext.level || partial.level,
          release: mergedContext.release || state.release || "",
          exception: partial.exception,
          request: mergedContext.request,
          user: mergedContext.user,
          server: buildServerPayload(state.serverName, mergedContext.server),
          sdk: {
            name: SDK_NAME,
            version: SDK_VERSION,
          },
        },
        state.sendPii,
      );

      if (state.beforeSend) {
        const nextEvent = await state.beforeSend(event);
        if (!nextEvent) {
          return;
        }
        event = nextEvent;
      }

      const response = await state.fetchImpl(state.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.apiKey}`,
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        throw new Error(`Watchdock ingestion failed with status ${response.status}`);
      }
    } catch (error) {
      state.onError?.(error);
    }
  }
}

function baseUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/$/, "");
  const idx = trimmed.indexOf("/api/v1/");
  return idx === -1 ? trimmed : trimmed.slice(0, idx);
}

/**
 * Fire-and-forget POST to register SDK initialisation with the platform.
 * Waits before pinging to allow the server to be ready at startup, and
 * never blocks init or raises on failure.
 */
function sendInitPing(state: WatchdockClientState): void {
  setTimeout(() => {
    state
      .fetchImpl(`${baseUrl(state.endpoint)}/api/v1/errors/sdk-init/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${state.apiKey}`,
        },
        body: JSON.stringify({ sdk_version: SDK_VERSION, environment: state.environment }),
      })
      .catch(() => {
        // Never block or raise on init ping failure
      });
  }, 5000);
}

export const client = new WatchdockClient();

export function init(options: WatchdockInitOptions): void {
  client.init(options);
}

export function captureException(error: unknown, context?: WatchdockCaptureContext): void {
  client.captureException(error, context);
}

export function captureMessage(message: string, context?: WatchdockCaptureContext): void {
  client.captureMessage(message, context);
}

export function flush(): Promise<void> {
  return client.flush();
}

export function isInitialized(): boolean {
  return client.isInitialized();
}

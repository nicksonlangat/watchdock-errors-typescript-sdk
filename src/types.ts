export interface WatchdockStackFrame {
  filename: string;
  function?: string;
  lineno?: number;
  context_line?: string;
}

export interface WatchdockExceptionPayload {
  type: string;
  message: string;
  stacktrace?: WatchdockStackFrame[];
}

export interface WatchdockRequestPayload {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  query_params?: Record<string, unknown>;
  body?: unknown;
}

export interface WatchdockUserPayload {
  id?: string | number;
  email?: string;
  username?: string;
  [key: string]: unknown;
}

export interface WatchdockServerPayload {
  hostname?: string;
  runtime?: string;
  runtime_version?: string;
  platform?: string;
  [key: string]: unknown;
}

export interface WatchdockSdkPayload {
  name: string;
  version: string;
}

export interface WatchdockEventPayload {
  project_key?: string;
  title?: string;
  timestamp: string;
  environment?: string;
  level?: string;
  release?: string;
  trace_id?: string;
  exception: WatchdockExceptionPayload;
  request?: WatchdockRequestPayload;
  user?: WatchdockUserPayload;
  server?: WatchdockServerPayload;
  sdk: WatchdockSdkPayload;
}

export interface WatchdockCaptureContext {
  title?: string;
  environment?: string;
  level?: string;
  release?: string;
  /**
   * Correlation ID linking this event to the originating nginx request
   * (e.g. `X-Request-Id`). Takes priority over any value auto-extracted
   * from `request.headers` if both are present.
   */
  trace_id?: string;
  request?: WatchdockRequestPayload;
  user?: WatchdockUserPayload;
  server?: WatchdockServerPayload;
  extras?: Record<string, unknown>;
}

export interface WatchdockInitOptions {
  apiKey: string;
  endpoint?: string;
  environment?: string;
  release?: string;
  serverName?: string;
  sendPii?: boolean;
  beforeSend?: (event: WatchdockEventPayload) => WatchdockEventPayload | null | Promise<WatchdockEventPayload | null>;
  onError?: (error: unknown) => void;
  fetchImpl?: typeof fetch;
}

export interface WatchdockScope {
  request?: WatchdockRequestPayload;
  user?: WatchdockUserPayload;
  server?: WatchdockServerPayload;
}

export interface WatchdockClientState {
  apiKey: string;
  endpoint: string;
  environment?: string;
  release?: string;
  serverName?: string;
  sendPii: boolean;
  beforeSend?: WatchdockInitOptions["beforeSend"];
  onError?: WatchdockInitOptions["onError"];
  fetchImpl: typeof fetch;
}

export { captureException, captureMessage, flush, init, isInitialized } from "./client.js";
export { getCurrentScope, runWithScope } from "./request-context.js";
export type {
  WatchdockCaptureContext,
  WatchdockEventPayload,
  WatchdockExceptionPayload,
  WatchdockInitOptions,
  WatchdockRequestPayload,
  WatchdockScope,
  WatchdockServerPayload,
  WatchdockStackFrame,
  WatchdockUserPayload,
} from "./types.js";

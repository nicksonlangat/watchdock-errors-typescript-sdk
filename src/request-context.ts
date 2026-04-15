import { AsyncLocalStorage } from "node:async_hooks";

import type { WatchdockScope } from "./types.js";

const storage = new AsyncLocalStorage<WatchdockScope>();

export function runWithScope<T>(scope: WatchdockScope, callback: () => T): T {
  return storage.run(scope, callback);
}

export function getCurrentScope(): WatchdockScope | undefined {
  return storage.getStore();
}

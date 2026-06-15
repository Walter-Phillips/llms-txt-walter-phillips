import { AsyncLocalStorage } from "node:async_hooks";
import type { Environment } from "../bindings";

export interface ObservabilityContext {
  env: Environment;
  executionContext: ExecutionContext;
}

const storage = new AsyncLocalStorage<ObservabilityContext>();

/**
 * Run a Worker invocation with observability bindings available to log sinks.
 *
 * @param context Invocation-scoped Worker context.
 * @param callback Work to run inside the observability scope.
 * @returns Callback result.
 */
export function withObservabilityContext<T>(context: ObservabilityContext, callback: () => T): T {
  return storage.run(context, callback);
}

/**
 * Get the current invocation-scoped observability context, if one exists.
 *
 * @returns Current observability context or undefined outside Worker handlers.
 */
export function currentObservabilityContext(): ObservabilityContext | undefined {
  return storage.getStore();
}

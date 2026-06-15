import * as Sentry from "@sentry/cloudflare";
import type { LogFields } from "./logger";

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Capture a handled exception in Sentry with structured context.
 *
 * @param error Error-like value to capture.
 * @param context Non-secret workflow context.
 */
export function captureHandledException(error: unknown, context: LogFields = {}): void {
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined && !(value instanceof Error)) scope.setExtra(key, value);
    }
    Sentry.captureException(asError(error));
  });
}

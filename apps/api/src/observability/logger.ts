import pino from "pino/browser";
import type { Logger } from "pino";
import { sendLogToAxiom } from "./axiom";
import { currentObservabilityContext } from "./context";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, JsonValue | Error | undefined>;
export type LogRecord = Record<string, JsonValue>;

const SERVICE = "llms-txt-api";
const REDACTED = "[redacted]";
const SENSITIVE_KEYS = [
  "authorization",
  "body",
  "content",
  "key",
  "prompt",
  "secret",
  "snippet",
  "token",
];

function writeRecord(level: LogLevel, record: unknown): void {
  const serialized = serializeUnknown(record, false);
  const payload = isPlainObject(serialized)
    ? serialized
    : ({ msg: serialized } satisfies Record<string, JsonValue>);
  const output = { service: SERVICE, ...payload, level };
  const context = currentObservabilityContext();

  switch (level) {
    case "info":
      console.info(output);
      break;
    case "warn":
      console.warn(output);
      break;
    case "error":
      console.error(output);
      break;
  }

  context?.executionContext.waitUntil(sendLogToAxiom(context.env, output));
}

const logger: Logger = pino({
  browser: {
    asObject: true,
    write: {
      info: (record: unknown): void => {
        writeRecord("info", record);
      },
      warn: (record: unknown): void => {
        writeRecord("warn", record);
      },
      error: (record: unknown): void => {
        writeRecord("error", record);
      },
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_KEYS.some((sensitive) => normalized.includes(sensitive));
}

function serializeError(error: Error, includeStack: boolean): JsonValue {
  return {
    name: error.name,
    message: error.message,
    ...(includeStack && error.stack ? { stack: error.stack } : {}),
  };
}

function serializeSpecialPrimitive(value: unknown): JsonValue | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") {
    return String(value);
  }
  return undefined;
}

function serializePrimitive(value: unknown): JsonValue | undefined {
  if (value === undefined) return null;
  if (value === null || typeof value === "string") return value;
  if (typeof value === "boolean") return value;
  return serializeSpecialPrimitive(value);
}

function serializeRecord(value: Record<string, unknown>, includeStack: boolean): JsonValue {
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      isSensitiveKey(key) ? REDACTED : serializeUnknown(nested, includeStack),
    ]),
  );
}

function serializeUnknown(value: unknown, includeStack: boolean): JsonValue {
  if (value instanceof Error) return serializeError(value, includeStack);

  const primitive = serializePrimitive(value);
  if (primitive !== undefined) return primitive;

  if (Array.isArray(value)) return value.map((item) => serializeUnknown(item, includeStack));
  if (!isPlainObject(value)) return "[unserializable]";

  return serializeRecord(value, includeStack);
}

function serializeFields(fields: LogFields, includeStack: boolean): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter((entry): entry is [string, JsonValue | Error] => entry[1] !== undefined)
      .map(([key, value]) => [
        key,
        isSensitiveKey(key) ? REDACTED : serializeUnknown(value, includeStack),
      ]),
  );
}

function emit(level: LogLevel, event: string, fields: LogFields): void {
  const record = {
    event,
    ...serializeFields(fields, level === "error"),
  };

  switch (level) {
    case "info":
      logger.info(record);
      break;
    case "warn":
      logger.warn(record);
      break;
    case "error":
      logger.error(record);
      break;
  }
}

/**
 * Emit a structured informational event.
 *
 * @param event Stable event name for querying.
 * @param fields Structured event fields.
 */
export function logInfo(event: string, fields: LogFields = {}): void {
  emit("info", event, fields);
}

/**
 * Emit a structured warning event.
 *
 * @param event Stable event name for querying.
 * @param fields Structured event fields.
 */
export function logWarn(event: string, fields: LogFields = {}): void {
  emit("warn", event, fields);
}

/**
 * Emit a structured error event.
 *
 * @param event Stable event name for querying.
 * @param fields Structured event fields.
 */
export function logError(event: string, fields: LogFields = {}): void {
  emit("error", event, fields);
}

/**
 * Build safe URL fields for logs without retaining query strings or fragments.
 *
 * @param url URL to summarize.
 * @returns Domain and path fields when parsing succeeds.
 */
export function urlFields(url: string): LogFields {
  try {
    const parsed = new URL(url);
    return { domain: parsed.origin, path: parsed.pathname };
  } catch {
    return { urlParseError: true };
  }
}

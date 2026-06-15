import { AxiomWithoutBatching } from "@axiomhq/js";
import type { Environment } from "../bindings";
import type { LogRecord } from "./logger";

interface AxiomConfig {
  dataset: string;
  token: string;
  edgeUrl?: string;
  orgId?: string;
}

const clients = new Map<string, AxiomWithoutBatching>();

function axiomConfig(env: Environment): AxiomConfig | undefined {
  if (!env.AXIOM_TOKEN || !env.AXIOM_DATASET) return undefined;
  return {
    dataset: env.AXIOM_DATASET,
    token: env.AXIOM_TOKEN,
    edgeUrl: env.AXIOM_EDGE_URL,
    orgId: env.AXIOM_ORG_ID,
  };
}

function clientKey(config: AxiomConfig): string {
  return [config.token, config.edgeUrl ?? "", config.orgId ?? ""].join(":");
}

function axiomClient(config: AxiomConfig): AxiomWithoutBatching {
  const key = clientKey(config);
  const existing = clients.get(key);
  if (existing) return existing;

  const client = new AxiomWithoutBatching({
    token: config.token,
    ...(config.edgeUrl ? { edgeUrl: config.edgeUrl } : {}),
    ...(config.orgId ? { orgId: config.orgId } : {}),
  });
  clients.set(key, client);
  return client;
}

/**
 * Send one structured log record to Axiom when Axiom is configured.
 *
 * @param env Worker bindings containing optional Axiom settings.
 * @param record Sanitized structured log record.
 */
export async function sendLogToAxiom(env: Environment, record: LogRecord): Promise<void> {
  const config = axiomConfig(env);
  if (!config) return;

  try {
    await axiomClient(config).ingest(config.dataset, record);
  } catch (error) {
    console.warn({
      service: "llms-txt-api",
      level: "warn",
      event: "axiom_ingest_failed",
      workflow: "observability",
      step: "axiom_ingest",
      outcome: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

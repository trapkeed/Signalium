/**
 * RunPod API client.
 *
 * All RunPod credentials are vault-resolved (vault-first, env fallback via
 * `resolveManagedConfig`) and never leave this module/server — the trainer
 * only ever receives short-lived scoped worker credentials (see
 * credentials.ts), never this API key.
 *
 * Uses RunPod's public GraphQL API (https://api.runpod.io/graphql).
 */
import { resolveManagedConfig } from "../secretsVault";
import { getCircuitBreaker } from "../circuitBreaker";

const RUNPOD_GRAPHQL_URL = "https://api.runpod.io/graphql";

const runpodBreaker = getCircuitBreaker("runpod-api", { failureThreshold: 4, resetTimeoutMs: 60_000, timeoutMs: 15_000 });

export class RunpodNotConfiguredError extends Error {
  constructor() {
    super("RunPod is not configured — set runpod.api_key (vault) or RUNPOD_API_KEY (env).");
    this.name = "RunpodNotConfiguredError";
  }
}

async function getApiKey(): Promise<string | null> {
  return resolveManagedConfig("runpod.api_key", "RUNPOD_API_KEY");
}

export async function isRunpodConfigured(): Promise<boolean> {
  return (await getApiKey()) !== null;
}

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const apiKey = await getApiKey();
  if (!apiKey) throw new RunpodNotConfiguredError();

  return runpodBreaker.execute(async () => {
    // Auth via header, not query string — query params are far more likely
    // to be captured in access logs, proxies, or error traces than headers.
    const res = await fetch(RUNPOD_GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`RunPod API responded with ${res.status}`);
    const body = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
    if (body.errors?.length) throw new Error(`RunPod API error: ${body.errors.map((e) => e.message).join("; ")}`);
    if (!body.data) throw new Error("RunPod API returned no data");
    return body.data;
  });
}

// ─── Config resolution ───────────────────────────────────────────────────────

export interface RunpodLaunchDefaults {
  templateId: string | null;
  volumeId: string | null;
  gpuType: string | null;
  allowedGpus: string[];
  region: string | null;
  gpuPricing: Record<string, number>;
}

/**
 * Admin-configured hourly price per GPU type, e.g. `{"NVIDIA A100": 1.29}`.
 * This is the ONLY trusted source of per-GPU cost for budget enforcement —
 * a caller-supplied cost on the launch request body must never be used to
 * decide whether a launch is within budget, or an admin could understate it
 * to bypass the cap.
 */
async function getGpuPricing(): Promise<Record<string, number>> {
  const raw = await resolveManagedConfig("runpod.gpu_pricing_json", "RUNPOD_GPU_PRICING_JSON");
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    const out: Record<string, number> = {};
    for (const [gpu, price] of Object.entries(parsed)) {
      if (typeof price === "number" && Number.isFinite(price) && price >= 0) out[gpu] = price;
    }
    return out;
  } catch {
    return {};
  }
}

export async function getRunpodLaunchDefaults(): Promise<RunpodLaunchDefaults> {
  const [templateId, volumeId, gpuType, allowedGpusRaw, region, gpuPricing] = await Promise.all([
    resolveManagedConfig("runpod.default_template_id", "RUNPOD_DEFAULT_TEMPLATE_ID"),
    resolveManagedConfig("runpod.default_volume_id", "RUNPOD_DEFAULT_VOLUME_ID"),
    resolveManagedConfig("runpod.default_gpu", "RUNPOD_DEFAULT_GPU"),
    resolveManagedConfig("runpod.allowed_gpus", "RUNPOD_ALLOWED_GPUS"),
    resolveManagedConfig("runpod.region", "RUNPOD_REGION"),
    getGpuPricing(),
  ]);
  return {
    templateId,
    volumeId,
    gpuType,
    allowedGpus: allowedGpusRaw ? allowedGpusRaw.split(",").map((g) => g.trim()).filter(Boolean) : [],
    region,
    gpuPricing,
  };
}

/**
 * Resolves the trusted hourly cost for a GPU type from the admin-configured
 * pricing map. Returns null if the GPU isn't priced, so callers can fail
 * closed (refuse to launch) instead of silently treating it as free.
 */
export async function resolveTrustedGpuCost(gpuType: string): Promise<number | null> {
  const pricing = await getGpuPricing();
  return pricing[gpuType] ?? null;
}

// ─── Pod lifecycle ────────────────────────────────────────────────────────────

export interface LaunchPodInput {
  name: string;
  gpuType: string;
  templateId: string;
  volumeId?: string | null;
  region?: string | null;
}

export interface LaunchedPod {
  id: string;
  costPerHr: number | null;
}

export async function launchPod(input: LaunchPodInput): Promise<LaunchedPod> {
  const mutation = `
    mutation podFindAndDeployOnDemand($input: PodFindAndDeployOnDemandInput!) {
      podFindAndDeployOnDemand(input: $input) {
        id
        costPerHr
      }
    }
  `;
  const data = await graphql<{ podFindAndDeployOnDemand: { id: string; costPerHr: number | null } }>(mutation, {
    input: {
      name: input.name,
      gpuTypeId: input.gpuType,
      templateId: input.templateId,
      networkVolumeId: input.volumeId ?? undefined,
      dataCenterId: input.region ?? undefined,
      cloudType: "SECURE",
    },
  });
  return { id: data.podFindAndDeployOnDemand.id, costPerHr: data.podFindAndDeployOnDemand.costPerHr ?? null };
}

export async function stopPod(runpodPodId: string): Promise<void> {
  await graphql(`mutation { podStop(input: { podId: "${runpodPodId}" }) { id } }`);
}

export async function resumePod(runpodPodId: string, gpuCount = 1): Promise<void> {
  await graphql(`mutation { podResume(input: { podId: "${runpodPodId}", gpuCount: ${gpuCount} }) { id } }`);
}

export async function terminatePod(runpodPodId: string): Promise<void> {
  await graphql(`mutation { podTerminate(input: { podId: "${runpodPodId}" }) }`);
}

export interface RunpodPodStatus {
  id: string;
  desiredStatus: string;
  costPerHr: number | null;
  gpuUtilPercent: number | null;
  memoryUtilPercent: number | null;
  runtime: { uptimeInSeconds: number } | null;
}

export async function getPodStatus(runpodPodId: string): Promise<RunpodPodStatus | null> {
  const query = `
    query pod($input: PodFilter!) {
      pod(input: $input) {
        id
        desiredStatus
        costPerHr
        runtime {
          uptimeInSeconds
          gpus { gpuUtilPercent memoryUtilPercent }
        }
      }
    }
  `;
  const data = await graphql<{
    pod: {
      id: string;
      desiredStatus: string;
      costPerHr: number | null;
      runtime: { uptimeInSeconds: number; gpus?: Array<{ gpuUtilPercent: number; memoryUtilPercent: number }> } | null;
    } | null;
  }>(query, { input: { podId: runpodPodId } });
  if (!data.pod) return null;
  const gpu = data.pod.runtime?.gpus?.[0];
  return {
    id: data.pod.id,
    desiredStatus: data.pod.desiredStatus,
    costPerHr: data.pod.costPerHr ?? null,
    gpuUtilPercent: gpu?.gpuUtilPercent ?? null,
    memoryUtilPercent: gpu?.memoryUtilPercent ?? null,
    runtime: data.pod.runtime ? { uptimeInSeconds: data.pod.runtime.uptimeInSeconds } : null,
  };
}

// ─── Logs & artifacts ────────────────────────────────────────────────────────
// RunPod does not expose a stable GraphQL logs endpoint for all pod types;
// we surface whatever the runtime block reports, and degrade gracefully.

export async function getPodLogs(runpodPodId: string): Promise<string[]> {
  const query = `
    query pod($input: PodFilter!) {
      pod(input: $input) {
        runtime { container { message } }
      }
    }
  `;
  const data = await graphql<{ pod: { runtime: { container: { message: string } | null } | null } | null }>(query, {
    input: { podId: runpodPodId },
  });
  const message = data.pod?.runtime?.container?.message;
  return message ? message.split("\n") : [];
}

/** Lists files on the pod's attached network volume, if any is configured. */
export async function listVolumeArtifacts(volumeId: string): Promise<Array<{ name: string; sizeBytes: number }>> {
  const query = `
    query networkVolume($id: String!) {
      networkVolume(id: $id) {
        id
        files { name size }
      }
    }
  `;
  try {
    const data = await graphql<{ networkVolume: { files?: Array<{ name: string; size: number }> } | null }>(query, { id: volumeId });
    return (data.networkVolume?.files ?? []).map((f) => ({ name: f.name, sizeBytes: f.size }));
  } catch {
    // Some RunPod accounts/volumes don't support the files sub-query — degrade to an empty listing rather than failing the whole page.
    return [];
  }
}

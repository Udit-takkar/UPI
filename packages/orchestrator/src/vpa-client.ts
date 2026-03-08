import { z } from "zod";
import type pino from "pino";

const ResolvedVpaSchema = z.object({
  vpaAddress: z.string(),
  handle: z.string(),
  ifsc: z.string(),
  bankOrgId: z.string(),
  pspOrgId: z.string(),
  accountNumberEncrypted: z.string(),
});

export type ResolvedVpa = z.infer<typeof ResolvedVpaSchema>;

const VPA_RESOLVE_TIMEOUT_MS = 5_000;

export function createVpaClient(baseUrl: string, logger: pino.Logger) {
  async function resolve(vpaAddress: string): Promise<ResolvedVpa | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), VPA_RESOLVE_TIMEOUT_MS);

    try {
      const res = await fetch(`${baseUrl}/internal/vpa/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vpaAddress }),
        signal: controller.signal,
      });

      if (res.status === 404) return null;
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        logger.error({ vpa: vpaAddress, status: res.status, body }, "VPA resolve failed");
        throw new Error(`VPA resolve failed: ${res.status}`);
      }

      return ResolvedVpaSchema.parse(await res.json());
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        logger.error({ vpa: vpaAddress }, "VPA resolve timed out");
        throw new Error(`VPA resolve timed out after ${VPA_RESOLVE_TIMEOUT_MS}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  return { resolve };
}

export type VpaClient = ReturnType<typeof createVpaClient>;

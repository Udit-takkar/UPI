import type { Database } from "@repo/shared/db";
import { schema } from "@repo/shared/db";
import type { RegisteredOrg } from "@repo/shared/db/types";
import { eq } from "drizzle-orm";
import type pino from "pino";

export interface OrgCache {
  getByOrgId(orgId: string): RegisteredOrg | undefined;
  getByFingerprint(fingerprint: string): RegisteredOrg | undefined;
  refresh(): Promise<void>;
  stop(): void;
}

export function createOrgCache(db: Database, logger: pino.Logger): OrgCache {
  let byOrgId = new Map<string, RegisteredOrg>();
  let byFingerprint = new Map<string, RegisteredOrg>();
  let timer: ReturnType<typeof setInterval> | null = null;

  async function refresh() {
    try {
      const orgs = await db
        .select()
        .from(schema.registeredOrgs)
        .where(eq(schema.registeredOrgs.status, "ACTIVE"));

      const newByOrgId = new Map<string, RegisteredOrg>();
      const newByFingerprint = new Map<string, RegisteredOrg>();
      for (const org of orgs) {
        newByOrgId.set(org.orgId, org);
        if (org.mtlsCertFingerprint) {
          newByFingerprint.set(org.mtlsCertFingerprint, org);
        }
      }
      byOrgId = newByOrgId;
      byFingerprint = newByFingerprint;
      logger.info({ count: orgs.length }, "Org cache refreshed");
    } catch (err) {
      logger.error(err, "Failed to refresh org cache");
    }

    if (!timer) {
      timer = setInterval(refresh, 30_000);
    }
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    getByOrgId: (id) => byOrgId.get(id),
    getByFingerprint: (fp) => byFingerprint.get(fp),
    refresh,
    stop,
  };
}

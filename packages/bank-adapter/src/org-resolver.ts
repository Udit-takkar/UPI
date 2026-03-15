import { eq } from "drizzle-orm";
import { schema } from "@repo/shared/db";
import type { Database } from "@repo/shared/db";
import type { RegisteredOrg } from "@repo/shared/db/types";
import type pino from "pino";

const CACHE_TTL_MS = 60_000;

interface CachedOrg {
  org: RegisteredOrg;
  cachedAt: number;
}

export function createOrgResolver(db: Database, logger: pino.Logger) {
  const cache = new Map<string, CachedOrg>();

  async function resolve(orgId: string): Promise<RegisteredOrg> {
    const cached = cache.get(orgId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
      return cached.org;
    }

    const org = await db.query.registeredOrgs.findFirst({
      where: eq(schema.registeredOrgs.orgId, orgId),
    });

    if (!org) {
      throw new Error(`Organization not found: ${orgId}`);
    }

    if (org.status !== "ACTIVE") {
      throw new Error(`Organization not active: ${orgId} (status: ${org.status})`);
    }

    cache.set(orgId, { org, cachedAt: Date.now() });
    return org;
  }

  function invalidate(orgId: string) {
    cache.delete(orgId);
  }

  return { resolve, invalidate };
}

export type OrgResolver = ReturnType<typeof createOrgResolver>;

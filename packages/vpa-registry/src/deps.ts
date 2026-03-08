import type { Database } from "@repo/shared/db";
import type { Redis } from "ioredis";

export interface VpaRegistryDeps {
  db: Database;
  redis: Redis;
}

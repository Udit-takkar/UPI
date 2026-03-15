import type { Database } from "@repo/shared/db";
import type { Redis } from "ioredis";
import type { Producer } from "kafkajs";

export interface BankAdapterDeps {
  db: Database;
  redis: Redis;
  kafkaProducer: Producer;
}

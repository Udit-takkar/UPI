import { Kafka, logLevel } from "kafkajs";

export function createKafkaClient({
  clientId,
  brokers,
}: {
  clientId: string;
  brokers?: string[];
}): Kafka {
  return new Kafka({
    clientId,
    brokers: brokers ?? (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
    retry: { initialRetryTime: 300, retries: 5 },
    logLevel: logLevel.WARN,
  });
}

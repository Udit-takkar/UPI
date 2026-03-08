import type { Kafka, Producer } from "kafkajs";
import { CompressionTypes } from "kafkajs";
import type { Topic } from "./topics.js";

export async function createProducer(kafka: Kafka): Promise<Producer> {
  const producer = kafka.producer({
    idempotent: true,
    maxInFlightRequests: 5,
  });
  await producer.connect();
  return producer;
}

export async function sendMessage(
  producer: Producer,
  topic: Topic,
  key: string,
  value: unknown,
): Promise<void> {
  await producer.send({
    topic,
    compression: CompressionTypes.GZIP,
    acks: -1,
    messages: [{ key, value: JSON.stringify(value) }],
  });
}

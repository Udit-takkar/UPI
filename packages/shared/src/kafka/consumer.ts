import type { Consumer, Kafka, EachMessagePayload } from "kafkajs";
import type { Producer } from "kafkajs";
import { CompressionTypes } from "kafkajs";
import { TOPICS, type Topic } from "./topics.js";

export async function createConsumer(
  kafka: Kafka,
  groupId: string,
): Promise<Consumer> {
  const consumer = kafka.consumer({
    groupId,
    sessionTimeout: 30_000,
    heartbeatInterval: 3_000,
  });
  await consumer.connect();
  return consumer;
}

export type MessageHandler = (message: {
  key: string | null;
  value: unknown;
  partition: number;
  offset: string;
}) => Promise<void>;

export async function runConsumer(
  consumer: Consumer,
  topic: Topic,
  handler: MessageHandler,
  dlqProducer?: Producer,
): Promise<void> {
  await consumer.subscribe({ topic, fromBeginning: false });

  await consumer.run({
    autoCommit: false,
    eachMessage: async (payload: EachMessagePayload) => {
      const { message, partition, topic: msgTopic } = payload;
      try {
        const value = message.value
          ? JSON.parse(message.value.toString())
          : null;
        await handler({
          key: message.key?.toString() ?? null,
          value,
          partition,
          offset: message.offset,
        });
      } catch (err) {
        if (dlqProducer) {
          await dlqProducer.send({
            topic: TOPICS.DLQ,
            compression: CompressionTypes.GZIP,
            messages: [
              {
                key: message.key,
                value: JSON.stringify({
                  originalTopic: msgTopic,
                  partition,
                  offset: message.offset,
                  error: err instanceof Error ? err.message : String(err),
                  payload: message.value?.toString(),
                }),
              },
            ],
          });
        }
      }
      await consumer.commitOffsets([
        {
          topic: msgTopic,
          partition,
          offset: String(Number(message.offset) + 1),
        },
      ]);
    },
  });
}

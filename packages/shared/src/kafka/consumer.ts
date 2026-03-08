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
        let value: unknown = null;
        if (message.value) {
          try {
            value = JSON.parse(message.value.toString());
          } catch {
            throw new Error(
              `Malformed JSON in message at ${msgTopic}:${partition}:${message.offset}`,
            );
          }
        }
        await handler({
          key: message.key?.toString() ?? null,
          value,
          partition,
          offset: message.offset,
        });
      } catch (err) {
        if (dlqProducer) {
          try {
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
          } catch (dlqErr) {
            console.error("Failed to send to DLQ", {
              originalTopic: msgTopic,
              partition,
              offset: message.offset,
              dlqError: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
              originalError: err instanceof Error ? err.message : String(err),
            });
          }
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

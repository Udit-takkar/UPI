import { z } from "zod";
import { UpiMessageHeaderSchema, RrnSchema } from "./common.js";

export const ReversalRequestSchema = z.object({
  header: UpiMessageHeaderSchema,
  txnId: z.uuid(),
  originalRrn: RrnSchema,
  reason: z.string().max(255),
});

export type ReversalRequest = z.infer<typeof ReversalRequestSchema>;

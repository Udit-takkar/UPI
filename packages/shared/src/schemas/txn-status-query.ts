import { z } from "zod";
import { UpiMessageHeaderSchema } from "./common.js";

export const TxnStatusQuerySchema = z
  .object({
    header: UpiMessageHeaderSchema,
    txnId: z.uuid().optional(),
    orgTxnId: z.string().max(255).optional(),
  })
  .refine((d) => d.txnId || d.orgTxnId, {
    message: "Either txnId or orgTxnId is required",
  });

export type TxnStatusQuery = z.infer<typeof TxnStatusQuerySchema>;

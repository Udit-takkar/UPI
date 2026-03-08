import { z } from "zod";
import {
  UpiMessageHeaderSchema,
  VpaSchema,
  AmountPaiseSchema,
  CurrencySchema,
} from "./common.js";

export const CollectRequestSchema = z.object({
  header: UpiMessageHeaderSchema,
  payerVpa: VpaSchema,
  payeeVpa: VpaSchema,
  collectByVpa: VpaSchema,
  amountPaise: AmountPaiseSchema,
  currency: CurrencySchema,
  orgTxnId: z.string().max(255).optional(),
  note: z.string().max(50).optional(),
  expiresAt: z.iso.datetime(),
});

export type CollectRequest = z.infer<typeof CollectRequestSchema>;

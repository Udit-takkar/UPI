import { z } from "zod";
import {
  UpiMessageHeaderSchema,
  AmountPaiseSchema,
  IfscSchema,
  RrnSchema,
  CurrencySchema,
} from "./common.js";

export const DebitRequestSchema = z.object({
  header: UpiMessageHeaderSchema,
  txnId: z.uuid(),
  rrn: RrnSchema,
  payerAccount: z.string(),
  payerIfsc: IfscSchema,
  amountPaise: AmountPaiseSchema,
  currency: CurrencySchema,
});

export type DebitRequest = z.infer<typeof DebitRequestSchema>;

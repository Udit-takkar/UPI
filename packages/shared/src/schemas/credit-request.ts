import { z } from "zod";
import {
  UpiMessageHeaderSchema,
  AmountPaiseSchema,
  IfscSchema,
  RrnSchema,
  CurrencySchema,
} from "./common.js";

export const CreditRequestSchema = z.object({
  header: UpiMessageHeaderSchema,
  txnId: z.uuid(),
  rrn: RrnSchema,
  payeeAccount: z.string(),
  payeeIfsc: IfscSchema,
  amountPaise: AmountPaiseSchema,
  currency: CurrencySchema,
});

export type CreditRequest = z.infer<typeof CreditRequestSchema>;

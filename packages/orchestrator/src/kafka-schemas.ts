import { z } from "zod";
import { PayRequestSchema } from "@repo/shared/schemas";

export const PayMessageSchema = z.object({
  body: PayRequestSchema,
  header: z.object({ orgId: z.uuid() }),
});
export type PayMessage = z.infer<typeof PayMessageSchema>;

export const DebitResponseSchema = z.object({
  txnId: z.uuid(),
  rrn: z.string(),
  success: z.boolean(),
  responseCode: z.string(),
  payeeVpa: z.string(),
  payeeIfsc: z.string(),
  payeeBankOrgId: z.string(),
  payeeAccountRef: z.string(),
  amountPaise: z.string(),
  currency: z.string(),
});
export type DebitResponse = z.infer<typeof DebitResponseSchema>;

export const CreditResponseSchema = z.object({
  txnId: z.uuid(),
  success: z.boolean(),
  responseCode: z.string(),
});
export type CreditResponse = z.infer<typeof CreditResponseSchema>;

export const ReversalResponseSchema = z.object({
  txnId: z.uuid(),
  success: z.boolean(),
  responseCode: z.string(),
});
export type ReversalResponse = z.infer<typeof ReversalResponseSchema>;

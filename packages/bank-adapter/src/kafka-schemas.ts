import { z } from "zod";

export const DebitRequestSchema = z.object({
  txnId: z.uuid(),
  rrn: z.string(),
  payerVpa: z.string(),
  payerIfsc: z.string(),
  payerAccountRef: z.string(),
  payerBankOrgId: z.uuid(),
  payeeVpa: z.string(),
  payeeIfsc: z.string(),
  payeeBankOrgId: z.uuid(),
  payeeAccountRef: z.string(),
  amountPaise: z.string(),
  currency: z.string(),
  note: z.string().optional(),
});
export type DebitRequest = z.infer<typeof DebitRequestSchema>;

export const CreditRequestSchema = z.object({
  txnId: z.uuid(),
  rrn: z.string(),
  payeeVpa: z.string(),
  payeeIfsc: z.string(),
  payeeBankOrgId: z.uuid(),
  payeeAccountRef: z.string(),
  amountPaise: z.string(),
  currency: z.string(),
});
export type CreditRequest = z.infer<typeof CreditRequestSchema>;

export const ReversalRequestSchema = z.object({
  txnId: z.uuid(),
  originalRrn: z.string(),
  reason: z.string(),
  payerBankOrgId: z.uuid(),
  payerAccountRef: z.string(),
  payerIfsc: z.string(),
  amountPaise: z.string(),
  currency: z.string(),
});
export type ReversalRequest = z.infer<typeof ReversalRequestSchema>;

export const BankApiResponseSchema = z.object({
  txnId: z.string(),
  success: z.boolean(),
  responseCode: z.string(),
});
export type BankApiResponse = z.infer<typeof BankApiResponseSchema>;

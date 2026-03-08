import { z } from "zod";

export const VpaSchema = z
  .string()
  .min(3)
  .max(255)
  .regex(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/, "Invalid VPA format");

export const AmountPaiseSchema = z
  .string()
  .regex(/^\d+$/, "Amount must be a numeric string")
  .transform((v) => BigInt(v))
  .refine((v) => v > 0n, "Amount must be positive");

export const IfscSchema = z
  .string()
  .length(11)
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC format");

export const RrnSchema = z
  .string()
  .length(12)
  .regex(/^\d{12}$/, "RRN must be 12 digits");

export const CurrencySchema = z.enum(["INR"]).default("INR");

export const UpiMessageHeaderSchema = z.object({
  msgId: z.uuid(),
  orgId: z.uuid(),
  ts: z.iso.datetime(),
});

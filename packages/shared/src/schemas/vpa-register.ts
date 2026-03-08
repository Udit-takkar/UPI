import { z } from "zod";
import { UpiMessageHeaderSchema, VpaSchema, IfscSchema } from "./common.js";

export const VpaRegisterSchema = z.object({
  header: UpiMessageHeaderSchema,
  vpaAddress: VpaSchema,
  ifsc: IfscSchema,
  accountRef: z.string().min(1),
  bankOrgId: z.uuid(),
});

export type VpaRegister = z.infer<typeof VpaRegisterSchema>;

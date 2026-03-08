import { z } from "zod";
import { UpiMessageHeaderSchema, VpaSchema } from "./common.js";

export const VpaDeregisterSchema = z.object({
  header: UpiMessageHeaderSchema,
  vpaAddress: VpaSchema,
  reason: z.string().max(255).optional(),
});

export type VpaDeregister = z.infer<typeof VpaDeregisterSchema>;

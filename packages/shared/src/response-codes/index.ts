export const UPI_RESPONSE_CODES = {
  "00": { message: "Transaction successful", success: true },
  U30: { message: "Debit timeout", success: false },
  U31: { message: "Credit timeout", success: false },
  U28: { message: "Unable to process", success: false },
  U16: { message: "Risk threshold exceeded", success: false },
  U09: { message: "Debit ack not received", success: false },
  ZA: { message: "Declined by payer PSP", success: false },
  ZM: { message: "Invalid MPIN", success: false },
  ZR: { message: "Invalid/Expired VPA", success: false },
  ZX: { message: "Insufficient funds", success: false },
  ZH: { message: "Account frozen", success: false },
  ZD: { message: "Validation error", success: false },
  ZE: { message: "No account found", success: false },
  ZS: { message: "Remitter bank unavailable", success: false },
  ZT: { message: "Beneficiary bank unavailable", success: false },
  RP: { message: "Reversal successful", success: true },
} as const;

export type UpiResponseCode = keyof typeof UPI_RESPONSE_CODES;

export function getResponseMessage(code: string): string {
  const entry = UPI_RESPONSE_CODES[code as UpiResponseCode];
  return entry?.message ?? "Unknown response code";
}

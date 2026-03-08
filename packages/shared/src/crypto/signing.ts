import { createSign, createVerify } from "node:crypto";

export function signPayload(privateKeyPem: string, payload: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(payload);
  signer.end();
  return signer.sign(privateKeyPem, "base64");
}

export function verifySignature(
  publicKeyPem: string,
  payload: string,
  signature: string,
): boolean {
  const verifier = createVerify("RSA-SHA256");
  verifier.update(payload);
  verifier.end();
  return verifier.verify(publicKeyPem, signature, "base64");
}

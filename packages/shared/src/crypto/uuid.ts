import { uuidv7 } from "uuidv7";

export function generateTxnId(): string {
  return uuidv7();
}

export function generateRrn(): string {
  const now = new Date();
  const prefix =
    String(now.getFullYear()).slice(2) +
    String(now.getMonth() + 1).padStart(2, "0") +
    String(now.getDate()).padStart(2, "0");
  const suffix = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
  return prefix + suffix;
}

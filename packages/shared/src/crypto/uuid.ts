import { uuidv7 } from "uuidv7";
import { randomInt } from "node:crypto";

export function generateTxnId(): string {
  return uuidv7();
}

let rrnCounter = randomInt(0, 100_000);

export function generateRrn(): string {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 0);
  const julianDay = Math.floor((now.getTime() - startOfYear.getTime()) / 86_400_000);
  const dayStr = String(julianDay).padStart(3, "0");
  const yy = String(now.getFullYear()).slice(2);
  rrnCounter = (rrnCounter + 1) % 10_000_000;
  const seq = String(rrnCounter).padStart(7, "0");
  return yy + dayStr + seq;
}

import { createMockBankServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 4000);

async function main() {
  const app = await createMockBankServer();
  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Mock bank server listening on port ${PORT}`);
}

main().catch((err) => {
  console.error("Failed to start mock bank:", err);
  process.exit(1);
});

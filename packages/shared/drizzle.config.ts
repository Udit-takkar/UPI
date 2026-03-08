import { readFileSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

const envFile = readFileSync('../../.env', 'utf-8');
for (const line of envFile.split('\n')) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match && !process.env[match[1]]) {
    process.env[match[1]] = match[2]?.replace(/^["']|["']$/g, '') ?? '';
  }
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { envSchema } from '../dist/config/env.schema.js';

const typeOrmEnvKeys = [
  'DB_HOST',
  'DB_NAME',
  'DB_PASSWORD',
  'DB_PORT',
  'DB_USER',
];

const expectedKeys = [
  ...new Set([...Object.keys(envSchema.shape), ...typeOrmEnvKeys]),
].sort();
const fileKeys = Object.keys(
  parse(readFileSync(new URL('../.env.example', import.meta.url))),
).sort();

const missing = expectedKeys.filter((key) => !fileKeys.includes(key));
const extra = fileKeys.filter((key) => !expectedKeys.includes(key));

if (missing.length || extra.length) {
  if (missing.length)
    console.error(`✗ Missing from .env.example: ${missing.join(', ')}`);
  if (extra.length)
    console.error(`✗ Unexpected in .env.example: ${extra.join(', ')}`);
  process.exit(1);
}
console.log(
  `✓ .env.example matches the configuration contracts (${expectedKeys.length} variables)`,
);

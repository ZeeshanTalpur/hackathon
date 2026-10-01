#!/usr/bin/env node
/**
 * Applies a SQL file to the Supabase Postgres database.
 *
 *   node scripts/apply-sql.mjs supabase/apply-all.sql
 *
 * Needed because the REST API cannot run DDL. Reads NEXT_PUBLIC_SUPABASE_URL
 * (for the project ref) and SUPABASE_DB_PASSWORD from .env.local.
 *
 * Tries the direct host first, then the regional poolers, because new Supabase
 * projects only reach the direct host over IPv6.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';

const root = process.cwd();

function loadEnv(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

const env = loadEnv(await readFile(path.join(root, '.env.local'), 'utf8'));
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const password = env.SUPABASE_DB_PASSWORD;

if (!password) {
  console.error('SUPABASE_DB_PASSWORD is missing from .env.local');
  process.exit(1);
}

const REGIONS = [
  'ap-south-1', 'ap-southeast-1', 'us-east-1', 'us-west-1',
  'eu-central-1', 'eu-west-1', 'ap-northeast-1', 'ap-southeast-2',
  'sa-east-1', 'ca-central-1', 'us-east-2', 'eu-west-2', 'eu-west-3',
];

const candidates = [
  { label: 'direct', host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres' },
  ...REGIONS.flatMap((region) => [
    {
      label: `pooler ${region} (session)`,
      host: `aws-0-${region}.pooler.supabase.com`,
      port: 5432,
      user: `postgres.${ref}`,
    },
    {
      label: `pooler ${region} (session, aws-1)`,
      host: `aws-1-${region}.pooler.supabase.com`,
      port: 5432,
      user: `postgres.${ref}`,
    },
  ]),
];

async function connect() {
  for (const candidate of candidates) {
    const client = new pg.Client({
      host: candidate.host,
      port: candidate.port,
      user: candidate.user,
      password,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
      query_timeout: 600_000,
      statement_timeout: 600_000,
    });

    try {
      await client.connect();
      console.log(`Connected via ${candidate.label} (${candidate.host}:${candidate.port})`);
      return client;
    } catch (error) {
      const reason = error?.message ?? String(error);
      // Wrong password means the host is right - stop and say so.
      if (/password authentication failed|Tenant or user not found/i.test(reason)) {
        console.log(`  ${candidate.label}: ${reason}`);
      }
      await client.end().catch(() => {});
    }
  }
  return null;
}

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/apply-sql.mjs <file.sql>');
  process.exit(1);
}

const sql = await readFile(path.join(root, file), 'utf8');
const client = await connect();

if (!client) {
  console.error('\nCould not reach the database on any known host.');
  console.error('Run the SQL in the Supabase dashboard SQL editor instead.');
  process.exit(1);
}

try {
  console.log(`Applying ${file} (${(sql.length / 1024).toFixed(0)} KB)...`);
  await client.query(sql);
  console.log('Applied successfully.');
} catch (error) {
  console.error(`\nFailed: ${error.message}`);
  if (error.position) {
    const at = Number(error.position);
    console.error('Near:', sql.slice(Math.max(0, at - 200), at + 200));
  }
  process.exitCode = 1;
} finally {
  await client.end();
}

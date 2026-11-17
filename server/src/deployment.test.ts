/** P0 #13: migrations are safe to run before or after the new code, and deploys run them first. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const migrationDir = path.join(root, 'prisma/migrations/20261030120000_posture_metrics_and_contribution');

describe('#13 migration sequencing', () => {
  const sql = readFileSync(path.join(migrationDir, 'migration.sql'), 'utf8');

  it('is idempotent, so a database already updated with `prisma db push` does not fail', () => {
    for (const statement of sql.split(';').filter((s) => /ADD COLUMN/i.test(s))) {
      expect(statement).toMatch(/ADD COLUMN IF NOT EXISTS/i);
    }
  });

  it('only adds nullable or defaulted columns, so the previous release keeps working against it', () => {
    for (const statement of sql.split(';').filter((s) => /ADD COLUMN/i.test(s))) {
      expect(/NOT NULL/i.test(statement) ? /DEFAULT/i.test(statement) : true).toBe(true);
    }
  });

  it('is the newest migration', () => {
    const all = readdirSync(path.join(root, 'prisma/migrations')).filter((name) => /^\d+_/.test(name)).sort();
    expect(all[all.length - 1]).toBe(path.basename(migrationDir));
  });

  it('has a deploy start command that migrates before the server starts', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['start:deploy']).toMatch(/^prisma migrate deploy && node dist\/server\.js$/);
  });
});

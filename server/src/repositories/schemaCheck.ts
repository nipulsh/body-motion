import { prisma } from './prisma';

/** Columns added by migrations that the running code depends on. */
export const REQUIRED_COLUMNS: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'scans', column: 'postureMetrics' },
  { table: 'muscle_findings', column: 'contributionPercent' },
];

type ColumnRow = { table_name: string; column_name: string };
export type ColumnQuery = () => Promise<ColumnRow[]>;

const defaultQuery: ColumnQuery = () =>
  prisma.$queryRaw<ColumnRow[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name IN ('scans', 'muscle_findings')`;

/** `table.column` for every required column the database does not have yet. */
export async function findMissingSchemaColumns(query: ColumnQuery = defaultQuery): Promise<string[]> {
  const rows = await query();
  const present = new Set(rows.map((row) => `${row.table_name}.${row.column_name}`));
  return REQUIRED_COLUMNS.map(({ table, column }) => `${table}.${column}`).filter((key) => !present.has(key));
}

/**
 * Fail fast at startup when migrations are missing, instead of failing every analysis job
 * later with an opaque Prisma column error.
 */
export async function assertDatabaseSchema(query: ColumnQuery = defaultQuery): Promise<void> {
  const missing = await findMissingSchemaColumns(query);
  if (missing.length > 0) {
    throw new Error(
      `Database schema is out of date (missing ${missing.join(', ')}). ` +
        'Run "npx prisma migrate deploy" in the server folder, then restart.',
    );
  }
}

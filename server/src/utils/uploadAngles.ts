export function parseUploadAngles(raw: unknown, count: number): Array<string | null> {
  const empty = Array.from({ length: count }, () => null as string | null);
  if (raw == null || raw === '') return empty;

  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return empty;
    }
  }

  if (!Array.isArray(parsed)) return empty;

  return Array.from({ length: count }, (_, index) => {
    const value = parsed[index];
    if (value == null || value === '') return null;
    const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(n) ? String(Math.round(n)) : null;
  });
}

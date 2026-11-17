/**
 * Local-only session log (IndexedDB) and best stars per game and level.
 * No video, images, names or patient details are stored.
 */

export interface SessionRecord {
  id?: number;
  date: string;
  gameId: string;
  level: string;
  options: Record<string, string | boolean>;
  durationSeconds: number;
  score: number;
  stars: number;
  hurtsPresses: number;
  endedBy: 'complete' | 'exit' | 'hurts';
  metrics: Record<string, unknown>;
}

const DB_NAME = 'mirror-rehab';
const STORE = 'sessions';
const STARS_KEY = 'bpsy.rehab.stars';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

export async function saveSession(record: SessionRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
  });
  db.close();
}

export async function allSessions(): Promise<SessionRecord[]> {
  const db = await openDb();
  const rows = await new Promise<SessionRecord[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as SessionRecord[]);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
  });
  db.close();
  return rows;
}

function readStars(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(STARS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function bestStars(gameId: string, levelKey: string): number {
  const v = readStars()[`${gameId}:${levelKey}`];
  return typeof v === 'number' && v >= 0 && v <= 3 ? v : 0;
}

export function recordStars(gameId: string, levelKey: string, stars: number): void {
  try {
    const all = readStars();
    const key = `${gameId}:${levelKey}`;
    all[key] = Math.max(all[key] ?? 0, Math.max(0, Math.min(3, Math.round(stars))));
    window.localStorage.setItem(STARS_KEY, JSON.stringify(all));
  } catch {
    // Storage blocked: stars are not kept.
  }
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formulas and quote every cell.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** One row per session; each metric gets its own column. */
export function sessionsToCsv(rows: readonly SessionRecord[]): string {
  const metricKeys = Array.from(new Set(rows.flatMap((r) => Object.keys(r.metrics ?? {})))).sort();
  const head = ['id', 'date', 'game', 'level', 'options', 'durationSeconds', 'score', 'stars', 'hurtsPresses', 'endedBy', ...metricKeys];
  const lines = [head.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push(
      [r.id, r.date, r.gameId, r.level, r.options, r.durationSeconds, r.score, r.stars, r.hurtsPresses, r.endedBy, ...metricKeys.map((k) => r.metrics?.[k])]
        .map(csvCell)
        .join(','),
    );
  }
  return lines.join('\r\n');
}

/** Download every session as CSV. Resolves with the number of rows. */
export async function exportCsv(): Promise<number> {
  const rows = await allSessions();
  const blob = new Blob([sessionsToCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mirror-rehab-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rows.length;
}

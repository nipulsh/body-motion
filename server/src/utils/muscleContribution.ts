import { geminiAnalysisSchema, type Deformity } from '../schemas/analysis.schema';

/** Shares are reported in tenths of a percent; every kept muscle gets at least one tenth. */
const RESOLUTION = 1000;

/**
 * Largest-remainder apportionment of `RESOLUTION` units: exact total, each weight at least one
 * unit (so no listed muscle reads 0%), and the units that minimum costs are taken from the
 * largest shares, so small muscles never distort the big ones by more than 0.1% each.
 */
function apportion(weights: number[]): number[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  const exact = weights.map((w) => (w / total) * RESOLUTION);
  const units = exact.map((x) => Math.max(1, Math.floor(x)));
  let remaining = RESOLUTION - units.reduce((sum, u) => sum + u, 0);
  const byRemainder = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remaining > 0; k = (k + 1) % byRemainder.length, remaining--) {
    units[byRemainder[k]!.i]! += 1;
  }
  while (remaining < 0) {
    const largest = units.indexOf(Math.max(...units));
    units[largest]! -= 1;
    remaining++;
  }
  return units.map((u) => u / (RESOLUTION / 100));
}

/**
 * Normalise contributions to sum to exactly 100 (Gemini's numbers rarely add up). Muscles the
 * model explicitly gave 0% are removed when others carry a share: a listed muscle that explains
 * none of the deformity contradicts itself. When every contribution is missing or zero (older
 * analyses), shares come from likelihood x intensity instead.
 */
export function normaliseContributions<
  T extends { contributionPercent?: number; likelihood: number; intensity: number },
>(muscles: T[]): Array<T & { contributionPercent: number }> {
  if (muscles.length === 0) return [];
  const given = muscles.map((m) => Math.max(0, m.contributionPercent ?? 0));
  const givenTotal = given.reduce((sum, v) => sum + v, 0);
  const kept =
    givenTotal > 0 ? muscles.filter((_, i) => given[i]! > 0) : muscles;
  const weights =
    givenTotal > 0
      ? kept.map((m) => Math.max(0, m.contributionPercent ?? 0))
      : kept.map((m) => Math.max(0.01, m.likelihood * Math.max(0.05, m.intensity)));
  const shares = apportion(weights);
  return kept
    .map((m, i) => ({ ...m, contributionPercent: shares[i]! }))
    .sort((a, b) => b.contributionPercent - a.contributionPercent);
}

/** Side implied by a catalogue name such as "Left Deltoid"; null for midline muscles. */
function sideFromName(name: string): 'left' | 'right' | null {
  const match = /^(left|right)\b/i.exec(name.trim());
  return match ? (match[1]!.toLowerCase() as 'left' | 'right') : null;
}

/**
 * Collapse repeated muscles into one row per catalogue muscle: the same name listed twice
 * (even with conflicting side labels such as "left" and "bilateral"), or two names that
 * resolved to one catalogue muscle. Shares add up, the stronger likelihood and intensity win,
 * distinct reasons are kept, and the side comes from the name when it carries one.
 */
export function mergeDuplicateMuscles<
  T extends {
    name: string;
    side: string;
    likelihood: number;
    intensity: number;
    reason: string;
    contributionPercent?: number;
  },
>(muscles: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const muscle of muscles) {
    const key = muscle.name.trim().toLowerCase();
    const named = sideFromName(muscle.name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...muscle, side: named ?? muscle.side });
      continue;
    }
    const reasons = new Set([existing.reason, muscle.reason].map((r) => r.trim()).filter(Boolean));
    byKey.set(key, {
      ...existing,
      side: named ?? (existing.side === 'unknown' ? muscle.side : existing.side),
      likelihood: Math.max(existing.likelihood, muscle.likelihood),
      intensity: Math.max(existing.intensity, muscle.intensity),
      reason: [...reasons].join(' '),
      contributionPercent: (existing.contributionPercent ?? 0) + (muscle.contributionPercent ?? 0),
    });
  }
  return [...byKey.values()];
}

/** The clinician-only note stored with an analysis, if any (older analyses have none). */
export function measurementConflictOf(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const value = (parsed as { measurementConflict?: unknown }).measurementConflict;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** False only when the stored analysis says the capture could not be analysed. Older ones were. */
export function analysisPossibleOf(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return true;
  return (parsed as { analysisPossible?: unknown }).analysisPossible !== false;
}

/**
 * Every deformity stored with an analysis, most pronounced first. Analyses saved before the list
 * existed still rated each region, so theirs are rebuilt from those ratings.
 */
export function deformitiesOf(parsed: unknown): Deformity[] {
  const stored = geminiAnalysisSchema.safeParse(parsed);
  if (!stored.success) return [];
  if (stored.data.deformities) return stored.data.deformities;
  return (stored.data.regionAssessment ?? [])
    .filter((entry) => entry.severity > 0)
    .sort((a, b) => b.severity - a.severity)
    .map((entry) => ({
      name: entry.observation,
      region: entry.region,
      side: entry.side,
      severity: entry.severity,
      description: entry.observation,
    }));
}

/** Serialize stored findings for the API: contribution share included, largest first. */
export function serializeMuscleFindings<
  T extends {
    name: string;
    side: string;
    likelihood: number;
    deformation: string;
    intensity: number;
    reason: string;
    contributionPercent: number;
    bodyExplorerId: string;
    bodyExplorerMeshNames: string[];
  },
>(findings: T[], sideToApi: (side: T['side']) => string) {
  // Analyses saved before contributions existed have 0 everywhere; derive a share for them.
  return normaliseContributions(findings).map((muscle) => ({
    name: muscle.name,
    side: sideToApi(muscle.side),
    likelihood: muscle.likelihood,
    deformation: muscle.deformation,
    intensity: muscle.intensity,
    reason: muscle.reason,
    contributionPercent: muscle.contributionPercent,
    bodyExplorerId: muscle.bodyExplorerId || undefined,
    bodyExplorerMeshNames:
      muscle.bodyExplorerMeshNames.length > 0 ? muscle.bodyExplorerMeshNames : undefined,
  }));
}

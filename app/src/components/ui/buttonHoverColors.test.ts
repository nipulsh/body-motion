/** Hover colours: distinct from the resting colour, readable, and defined once as theme tokens. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buttonVariants } from './button';

const css = readFileSync(path.resolve(__dirname, '../../styles/app.css'), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const theme = css.slice(css.indexOf('@theme inline {'), css.indexOf('}', css.indexOf('@theme inline {')));

function token(name: string): string {
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(root);
  if (!match) throw new Error(`--${name} is not defined in :root`);
  return match[1]!.trim();
}

type Rgba = { r: number; g: number; b: number; a: number };

/** Parse `#rrggbb` or `oklch(L C H [/ A%])` into sRGB (0–1) with alpha. */
function parseColor(value: string): Rgba {
  if (value.startsWith('#')) {
    const n = parseInt(value.slice(1), 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255, a: 1 };
  }
  const m = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+)%)?\s*\)/.exec(value);
  if (!m) throw new Error(`unsupported colour ${value}`);
  const [L, C, H] = [Number(m[1]), Number(m[2]), (Number(m[3]) * Math.PI) / 180];
  const a = Math.cos(H) * C;
  const b = Math.sin(H) * C;
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
  const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  return { r: gamma(lin[0]!), g: gamma(lin[1]!), b: gamma(lin[2]!), a: m[4] ? Number(m[4]) / 100 : 1 };
}

const over = (top: Rgba, under: Rgba): Rgba => ({
  r: top.r * top.a + under.r * (1 - top.a),
  g: top.g * top.a + under.g * (1 - top.a),
  b: top.b * top.a + under.b * (1 - top.a),
  a: 1,
});

function luminance({ r, g, b }: Rgba): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const distance = (a: Rgba, b: Rgba) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

const background = () => parseColor(token('background'));
const solid = (name: string) => over(parseColor(token(name)), background());

const CASES = [
  { variant: 'default', base: 'primary', hover: 'primary-hover', text: token('primary-foreground') },
  { variant: 'destructive', base: 'destructive', hover: 'destructive-hover', text: '#ffffff' },
  { variant: 'secondary', base: 'secondary', hover: 'secondary-hover', text: token('secondary-foreground') },
  { variant: 'outline', base: null, hover: 'outline-hover', text: '#000000' },
] as const;

describe('button hover colours', () => {
  it('each filled/outline variant hovers to its own theme token, not a faded copy of its colour', () => {
    for (const { variant, hover } of CASES) {
      const classes = buttonVariants({ variant }).split(/\s+/);
      expect(classes, variant).toContain(`hover:bg-${hover}`);
      expect(classes.some((c) => /^hover:bg-(primary|destructive|secondary)\/\d+$/.test(c)), variant).toBe(false);
    }
  });

  it('defines every hover colour once in :root and exposes it to Tailwind', () => {
    for (const { hover } of CASES) {
      expect(() => token(hover)).not.toThrow();
      expect(theme).toContain(`--color-${hover}: var(--${hover});`);
    }
  });

  it('hover colours are clearly different from the resting colours', () => {
    for (const { variant, base, hover } of CASES) {
      const resting = base ? solid(base) : parseColor('#ffffff');
      // ~0.08 in sRGB is a visible step; the old 85% fade over black was a darkening, not a new colour.
      expect(distance(resting, solid(hover)), variant).toBeGreaterThanOrEqual(0.08);
    }
  });

  it('keeps button text readable on every hover colour (WCAG AA, 4.5:1)', () => {
    for (const { variant, hover, text } of CASES) {
      expect(contrast(parseColor(text), solid(hover)), variant).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('ghost buttons and list rows (hover:bg-accent) visibly change on the black background', () => {
    expect(distance(solid('accent'), background())).toBeGreaterThanOrEqual(0.05);
    expect(contrast(parseColor(token('accent-foreground')), solid('accent'))).toBeGreaterThanOrEqual(4.5);
  });
});

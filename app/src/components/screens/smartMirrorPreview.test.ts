import { describe, expect, it } from 'vitest';
import { isSmartMirrorDevPreview } from './smartMirrorPreview';

describe('isSmartMirrorDevPreview', () => {
  it('matches the smart-mirror query only in development', () => {
    expect(isSmartMirrorDevPreview('?screen=smart-mirror', true)).toBe(true);
    expect(isSmartMirrorDevPreview('screen=smart-mirror', true)).toBe(true);
  });

  it('ignores the query outside development and for other screens', () => {
    expect(isSmartMirrorDevPreview('?screen=smart-mirror', false)).toBe(false);
    expect(isSmartMirrorDevPreview('', true)).toBe(false);
    expect(isSmartMirrorDevPreview('?screen=dashboard', true)).toBe(false);
  });
});
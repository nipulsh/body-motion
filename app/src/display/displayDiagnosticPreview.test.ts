import { describe, expect, it } from 'vitest';
import { isDisplayDiagnosticPreview } from './displayDiagnosticPreview';

describe('isDisplayDiagnosticPreview', () => {
  it('matches the displays query only in development', () => {
    expect(isDisplayDiagnosticPreview('?screen=displays', true)).toBe(true);
    expect(isDisplayDiagnosticPreview('screen=displays', true)).toBe(true);
  });

  it('ignores the query outside development and for other screens', () => {
    expect(isDisplayDiagnosticPreview('?screen=displays', false)).toBe(false);
    expect(isDisplayDiagnosticPreview('?screen=smart-mirror', true)).toBe(false);
    expect(isDisplayDiagnosticPreview('', true)).toBe(false);
  });
});

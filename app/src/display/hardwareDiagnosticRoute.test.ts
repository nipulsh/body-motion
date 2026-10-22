import { describe, expect, it } from 'vitest';
import { isHardwareDiagnosticScreen } from './hardwareDiagnosticRoute';

describe('isHardwareDiagnosticScreen', () => {
  it('matches the hardware query in any build', () => {
    expect(isHardwareDiagnosticScreen('?screen=hardware')).toBe(true);
    expect(isHardwareDiagnosticScreen('screen=hardware')).toBe(true);
  });

  it('leaves the display diagnostic and the kiosk on their own routes', () => {
    expect(isHardwareDiagnosticScreen('?screen=displays')).toBe(false);
    expect(isHardwareDiagnosticScreen('?screen=smart-mirror')).toBe(false);
    expect(isHardwareDiagnosticScreen('')).toBe(false);
  });
});

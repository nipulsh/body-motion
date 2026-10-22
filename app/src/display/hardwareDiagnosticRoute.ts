export const HARDWARE_DIAGNOSTIC_PARAM = 'screen';
export const HARDWARE_DIAGNOSTIC_VALUE = 'hardware';

/** Production hardware diagnostic. Available in every build, on the laptop window. */
export function isHardwareDiagnosticScreen(search: string): boolean {
  const query = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(query).get(HARDWARE_DIAGNOSTIC_PARAM) === HARDWARE_DIAGNOSTIC_VALUE;
}

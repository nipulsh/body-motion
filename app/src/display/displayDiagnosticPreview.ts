export const DISPLAY_DIAGNOSTIC_PARAM = 'screen';
export const DISPLAY_DIAGNOSTIC_VALUE = 'displays';

/** Dev-only display diagnostic. Production builds ignore the query string. */
export function isDisplayDiagnosticPreview(
  search: string,
  dev: boolean = import.meta.env.DEV,
): boolean {
  if (!dev) return false;
  const query = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(query).get(DISPLAY_DIAGNOSTIC_PARAM) === DISPLAY_DIAGNOSTIC_VALUE;
}

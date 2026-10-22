export const SMART_MIRROR_PREVIEW_PARAM = 'screen';
export const SMART_MIRROR_PREVIEW_VALUE = 'smart-mirror';

/** Dev-only preview. Production builds ignore the query string. */
export function isSmartMirrorDevPreview(
  search: string,
  dev: boolean = import.meta.env.DEV,
): boolean {
  if (!dev) return false;
  const query = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(query).get(SMART_MIRROR_PREVIEW_PARAM) === SMART_MIRROR_PREVIEW_VALUE;
}

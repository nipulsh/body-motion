export const MIRROR_HOME_PREVIEW_PARAM = 'screen';
export const MIRROR_HOME_PREVIEW_VALUE = 'mirror-home';

/** Kiosk-style Smart Mirror home (`?screen=mirror-home`). */
export function isMirrorHomePreview(search: string): boolean {
  const query = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(query).get(MIRROR_HOME_PREVIEW_PARAM) === MIRROR_HOME_PREVIEW_VALUE;
}

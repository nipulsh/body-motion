/**
 * Every instruction and button sits in the top 40% of the portrait screen (measured on the
 * rotated kiosk stage), where the patient reads it at eye level and reaches it with a raised
 * hand, and it stays off the body below. The analysis pages (capture and results) are the
 * exception. Rehab games follow the same line in `rehab.css`.
 */
export const MIRROR_TOP_ZONE_PERCENT = 40;

/** A page's controls: never taller than the top zone, scrolling inside it if they must. */
export const mirrorTopZoneClass = 'max-h-[40%] overflow-y-auto';

/** Fills exactly the top zone; its content can centre in it. */
export const mirrorTopZoneFillClass = 'h-[40%] max-h-[40%] overflow-y-auto';

/** Over a full-screen layer: the top zone, with its content centred. */
export const mirrorTopZoneOverlayClass =
  'absolute inset-x-0 top-0 flex h-[40%] flex-col items-center justify-center-safe overflow-y-auto';

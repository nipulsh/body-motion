import type { DesktopWindowRole } from '../desktop/desktopApi';
import type { WorkflowStage } from '../workflow/types';

/**
 * Kiosk app always boots to the Smart Mirror home screen.
 */
export function resolveClinicalInitialStage(
  _search: string,
  _windowRole: DesktopWindowRole | null,
): WorkflowStage {
  return 'mirror_home';
}

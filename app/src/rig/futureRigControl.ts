/**
 * Placeholder for future Python → localhost bridge → Electron → Three.js rig control.
 * No implementation yet — wire IPC/commands here when the local rig service exists.
 */
export interface RigControlAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  applyPose?(poseName: string): Promise<void>;
}

export function useFutureRigControl(): RigControlAdapter {
  return {
    async connect() {
      console.info('[rig] Future rig control: connect() not implemented');
    },
    async disconnect() {
      console.info('[rig] Future rig control: disconnect() not implemented');
    },
  };
}

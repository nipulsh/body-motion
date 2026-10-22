import { useConnectivity } from '../connectivity/ConnectivityContext';
import { OFFLINE_ACTION_MESSAGE } from '../offline/messages';

export function useRequiresOnline() {
  const { isOnline } = useConnectivity();
  return {
    isOnline,
    offlineMessage: OFFLINE_ACTION_MESSAGE,
  };
}

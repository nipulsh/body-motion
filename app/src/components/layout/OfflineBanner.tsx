import { useConnectivity } from '../../connectivity/ConnectivityContext';
import { OFFLINE_BANNER_MESSAGE, OFFLINE_RECONNECTED_MESSAGE } from '../../offline/messages';
import { Alert, AlertDescription } from '../ui/alert';

export function OfflineBanner() {
  const { isOnline, showReconnected } = useConnectivity();

  if (isOnline && !showReconnected) {
    return null;
  }

  return (
    <div className="sticky top-0 z-20 border-b bg-background/95 px-4 py-2 backdrop-blur">
      <Alert variant={isOnline ? 'default' : 'destructive'} className="py-2">
        <AlertDescription className="text-center text-sm">
          {isOnline ? OFFLINE_RECONNECTED_MESSAGE : OFFLINE_BANNER_MESSAGE}
        </AlertDescription>
      </Alert>
    </div>
  );
}

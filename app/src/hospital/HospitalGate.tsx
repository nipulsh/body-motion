import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useConnectivity } from '../connectivity/ConnectivityContext';
import { useHospital } from '../hospital/HospitalContext';
import { Alert, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';

interface HospitalGateProps {
  children: ReactNode;
}

function HospitalLoadingScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="size-8 animate-spin" />
        <p className="text-sm">Loading hospital profile…</p>
      </div>
    </div>
  );
}

export function HospitalGate({ children }: HospitalGateProps) {
  const { hospital, loading, error, reload } = useHospital();
  const { isOnline } = useConnectivity();

  if (loading) {
    return <HospitalLoadingScreen />;
  }

  if (hospital) {
    return <>{children}</>;
  }

  if (!isOnline) {
    return (
      <div className="flex min-h-svh flex-col bg-background">
        <Alert variant="destructive" className="rounded-none border-x-0 border-t-0">
          <AlertDescription>{error ?? 'Hospital information is not available offline.'}</AlertDescription>
        </Alert>
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-4">
        <Alert variant="destructive">
          <AlertDescription>{error ?? 'Hospital profile is unavailable.'}</AlertDescription>
        </Alert>
        <Button type="button" className="w-full" onClick={() => void reload()}>
          Retry
        </Button>
      </div>
    </div>
  );
}

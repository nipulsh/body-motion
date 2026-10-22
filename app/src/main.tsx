import { StrictMode } from 'react';
import { getDesktopWindowRole } from './desktop/desktopApi';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppAuthProvider } from './auth/AppAuthContext';
import { DisplayDiagnosticScreen } from './components/screens/DisplayDiagnosticScreen';
import { SmartMirrorScreen } from './components/screens/SmartMirrorScreen';
import { isSmartMirrorDevPreview } from './components/screens/smartMirrorPreview';
import { isDisplayDiagnosticPreview } from './display/displayDiagnosticPreview';
import { isHardwareDiagnosticScreen } from './display/hardwareDiagnosticRoute';
import { HardwareDiagnosticScreen } from './components/screens/HardwareDiagnosticScreen';
import { resolveClinicalInitialStage } from './display/resolveClinicalInitialStage';
import { isSmartMirrorWindowLabel } from './display/mirrorWindow';
import { ConnectivityProvider } from './connectivity/ConnectivityContext';
import { HospitalGate } from './hospital/HospitalGate';
import { HospitalProvider } from './hospital/HospitalContext';
import { MirrorHandNavProvider } from './components/smartMirror/MirrorHandNavContext';
import { WorkflowProvider } from './workflow/WorkflowContext';
import type { WorkflowStage } from './workflow/types';
import './styles/app.css';

const rootElement = document.getElementById('root')!;
const windowRole = getDesktopWindowRole();

if (isSmartMirrorWindowLabel(windowRole)) {
  createRoot(rootElement).render(
    <StrictMode>
      <SmartMirrorScreen remote />
    </StrictMode>,
  );
} else if (isSmartMirrorDevPreview(window.location.search)) {
  createRoot(rootElement).render(
    <StrictMode>
      <SmartMirrorScreen />
    </StrictMode>,
  );
} else if (isDisplayDiagnosticPreview(window.location.search)) {
  createRoot(rootElement).render(
    <StrictMode>
      <DisplayDiagnosticScreen />
    </StrictMode>,
  );
} else if (isHardwareDiagnosticScreen(window.location.search)) {
  createRoot(rootElement).render(
    <StrictMode>
      <HardwareDiagnosticScreen />
    </StrictMode>,
  );
} else {
  mountKioskApp(rootElement, resolveClinicalInitialStage(window.location.search, windowRole));
}

function KioskApp({ initialStage }: { initialStage?: WorkflowStage }) {
  return (
    <ConnectivityProvider>
      <HospitalProvider>
        <HospitalGate>
          <WorkflowProvider initialStage={initialStage}>
            <MirrorHandNavProvider>
              <App />
            </MirrorHandNavProvider>
          </WorkflowProvider>
        </HospitalGate>
      </HospitalProvider>
    </ConnectivityProvider>
  );
}

function mountKioskApp(root: HTMLElement, initialStage?: WorkflowStage) {
  createRoot(root).render(
    <StrictMode>
      <AppAuthProvider>
        <KioskApp initialStage={initialStage} />
      </AppAuthProvider>
    </StrictMode>,
  );
}

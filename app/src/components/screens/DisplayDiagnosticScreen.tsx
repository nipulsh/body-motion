import { useSmartMirrorDisplays } from '../../hooks/useSmartMirrorDisplays';
import {
  selectSmartMirrorDisplay,
  type ConnectedDisplay,
  type DisplaySnapshot,
} from '../../display/smartMirrorDisplay';

export function DisplayDiagnosticScreen() {
  const { snapshot, error, refresh } = useSmartMirrorDisplays();
  return <DisplayDiagnosticView snapshot={snapshot} error={error} onRefresh={refresh} />;
}

export function DisplayDiagnosticView({
  snapshot,
  error,
  onRefresh,
}: {
  snapshot: DisplaySnapshot | null;
  error: string | null;
  onRefresh: () => void;
}) {
  const selection = snapshot ? selectSmartMirrorDisplay(snapshot) : null;

  return (
    <main className="display-diagnostic">
      <header className="display-diagnostic-header">
        <div>
          <h1>Display diagnostic</h1>
          <p>Connected displays for the Smart Mirror. This screen does not open the mirror window.</p>
        </div>
        <button type="button" onClick={onRefresh}>Refresh</button>
      </header>

      <p className="display-diagnostic-note">
        A portrait external display is preferred. Orientation does not prove that a display is a TV, and a secondary display is not assumed to be HDMI.
      </p>

      {error ? <p role="alert">{error}</p> : null}
      {!snapshot ? <p>Reading displays…</p> : null}

      {snapshot && selection ? (
        <>
          <section aria-label="Smart Mirror candidate">
            <h2>Smart Mirror candidate</h2>
            <p data-testid="display-selection-status">{selection.status}</p>
            <p>{selection.message}</p>
            {selection.candidate ? (
              <p data-testid="display-candidate">
                {displayLabel(selection.candidate)} · {selection.candidate.width}×{selection.candidate.height} · {selection.candidate.orientation}
              </p>
            ) : null}
            <p>Topology: {snapshot.topology}</p>
          </section>

          <section aria-label="Connected displays">
            <h2>Connected displays</h2>
            {snapshot.displays.length === 0 ? <p>No displays reported.</p> : null}
            <ul>
              {snapshot.displays.map((display) => {
                const chosen = selection.candidates.some((candidate) => candidate.id === display.id);
                return (
                  <li key={display.id} data-testid={`display-${display.id}`}>
                    <strong>{displayLabel(display)}</strong>
                    {display.primary ? ' · Primary' : ''}
                    {chosen && selection.status === 'selected' ? ' · Candidate' : ''}
                    {chosen && selection.status === 'choose' ? ' · Needs a choice' : ''}
                    <span>
                      {display.width}×{display.height} at {display.x},{display.y} · scale {display.scaleFactor} · {display.orientation}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}

function displayLabel(display: ConnectedDisplay): string {
  return display.name?.trim() || display.id;
}

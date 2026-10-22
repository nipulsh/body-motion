import { useEffect, useRef, useState, type RefObject } from 'react';
import { probeHardwareCamera, type CameraProbeResult } from '../../display/hardwareCameraProbe';
import {
  CLEAR_MANUAL_CONFIRMATION,
  createHardwareProfile,
  draftFromManual,
  hardwareProfileFromJson,
  hardwareProfileToJson,
  initialManualDraft,
  liveReadingRows,
  loadHardwareProfile,
  manualEntryStatus,
  MANUAL_FIELD_SPECS,
  parseManualDraft,
  readLiveHardware,
  saveHardwareProfile,
  type HardwareDetectedSnapshot,
  type HardwareManualDraft,
  type LiveHardwareReading,
  type ManualFieldKey,
  type MeasurementStatus,
} from '../../display/hardwareCalibration';
import { loadHardwareDisplaySnapshot } from '../../display/loadDisplays';
import { useSmartMirrorDisplays } from '../../hooks/useSmartMirrorDisplays';

const GROUPS = [
  {
    id: 'plastic',
    title: 'Transparent plastic',
    note: 'Prefilled from the stated cabinet size. Unverified until you measure the sheet.',
  },
  {
    id: 'panel',
    title: 'TV panel',
    note: 'Measure the illuminated glass. A 43-inch class name is the diagonal, not the panel height. Entered values stay unverified.',
  },
  {
    id: 'camera',
    title: 'Webcam',
    note: 'Leave field of view and tilt empty when they have not been measured. Entered values stay unverified.',
  },
] as const;

export function HardwareDiagnosticScreen() {
  const displays = useSmartMirrorDisplays(loadHardwareDisplaySnapshot);
  const [draft, setDraft] = useState<HardwareManualDraft>(initialManualDraft);
  const [savedSnapshot, setSavedSnapshot] = useState<HardwareDetectedSnapshot | null>(null);
  const [camera, setCamera] = useState<Extract<CameraProbeResult, { ok: true }> | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [detectedAt, setDetectedAt] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [probeToken, setProbeToken] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const live = readLiveHardware(
    displays.snapshot,
    camera
      ? { width: camera.width, height: camera.height, label: camera.label, deviceId: camera.deviceId }
      : null,
  );

  useEffect(() => {
    const stored = loadHardwareProfile(localStorage);
    if (stored.status === 'invalid') {
      setStorageError(stored.message);
      return;
    }
    if (stored.status === 'ok') {
      setDraft(draftFromManual(stored.profile.manual));
      setSavedSnapshot(stored.profile.detectedSnapshot);
    }
  }, []);

  useEffect(() => {
    if (displays.snapshot && !displays.error) {
      setDetectedAt(new Date().toISOString());
    }
  }, [displays.snapshot, displays.error]);

  useEffect(() => {
    let cancelled = false;
    void probeHardwareCamera().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setCamera(result);
        setCameraError(null);
        setDetectedAt(new Date().toISOString());
        return;
      }
      setCamera(null);
      setCameraError(result.message);
    });
    return () => {
      cancelled = true;
    };
  }, [probeToken]);

  const persist = (kind: 'save' | 'export') => {
    const parsed = parseManualDraft(draft);
    if (!parsed.ok) {
      setFormError(parsed.message);
      setNotice(null);
      return;
    }
    const profile = createHardwareProfile(parsed.manual, live, new Date().toISOString());
    if (kind === 'export') {
      downloadJson(hardwareProfileToJson(profile));
      setFormError(null);
      setNotice('Profile exported. Live readings were not replaced.');
      return;
    }
    try {
      saveHardwareProfile(profile, localStorage);
    } catch {
      setFormError('The profile could not be saved in this browser.');
      setNotice(null);
      return;
    }
    setSavedSnapshot(profile.detectedSnapshot);
    setFormError(null);
    setStorageError(null);
    setNotice('Profile saved. The detection snapshot is kept separate from the live readings.');
  };

  const importText = (text: string) => {
    const parsed = hardwareProfileFromJson(text);
    if (!parsed.ok) {
      setFormError(parsed.message);
      setNotice(null);
      return;
    }
    try {
      saveHardwareProfile(parsed.profile, localStorage);
    } catch {
      setFormError('The profile could not be saved in this browser.');
      setNotice(null);
      return;
    }
    setDraft(draftFromManual(parsed.profile.manual));
    setSavedSnapshot(parsed.profile.detectedSnapshot);
    setFormError(null);
    setStorageError(null);
    setNotice('Profile imported. Saved detection was not copied over the live readings.');
  };

  return (
    <HardwareDiagnosticView
      live={live}
      draft={draft}
      savedSnapshot={savedSnapshot}
      displayError={displays.error}
      cameraError={cameraError}
      detectedAt={detectedAt}
      formError={formError}
      notice={notice}
      storageError={storageError}
      fileRef={fileRef}
      onDraftChange={(key, value) => {
        setDraft((current) => ({ ...current, [key]: value }));
        setFormError(null);
      }}
      onRefresh={() => {
        displays.refresh();
        setProbeToken((current) => current + 1);
      }}
      onSave={() => persist('save')}
      onExport={() => persist('export')}
      onImportText={importText}
      onClear={() => {
        setDraft(initialManualDraft());
        setFormError(null);
        setNotice('Entered measurements were reset. Save to replace the stored profile.');
      }}
    />
  );
}

export function HardwareDiagnosticView({
  live,
  draft,
  savedSnapshot,
  displayError,
  cameraError,
  detectedAt,
  formError,
  notice,
  storageError,
  fileRef,
  onDraftChange,
  onRefresh,
  onSave,
  onExport,
  onImportText,
  onClear,
  confirm = (message) => window.confirm(message),
}: {
  live: LiveHardwareReading;
  draft: HardwareManualDraft;
  savedSnapshot: HardwareDetectedSnapshot | null;
  displayError: string | null;
  cameraError: string | null;
  detectedAt: string | null;
  formError: string | null;
  notice: string | null;
  storageError: string | null;
  fileRef?: RefObject<HTMLInputElement | null>;
  onDraftChange: (key: ManualFieldKey, value: string) => void;
  onRefresh: () => void;
  onSave: () => void;
  onExport: () => void;
  onImportText: (text: string) => void;
  onClear: () => void;
  confirm?: (message: string) => boolean;
}) {
  const localFileRef = useRef<HTMLInputElement>(null);
  const inputRef = fileRef ?? localFileRef;
  const liveRows = liveReadingRows(live);

  return (
    <main className="display-diagnostic hardware-diagnostic">
      <header className="display-diagnostic-header">
        <div>
          <h1>Hardware diagnostics</h1>
          <p>Measurements for aligning the wireframe with the reflection. This screen does not change pose detection or drawing.</p>
        </div>
      </header>

      <div className="hardware-diagnostic-actions">
        <button type="button" onClick={onRefresh}>Refresh diagnostics</button>
        <button type="button" onClick={onSave}>Save profile</button>
        <button type="button" onClick={onExport}>Export JSON</button>
        <button type="button" onClick={() => inputRef.current?.click()}>Import JSON</button>
        <button
          type="button"
          onClick={() => {
            if (confirm(CLEAR_MANUAL_CONFIRMATION)) onClear();
          }}
        >
          Clear manual measurements
        </button>
        <input
          ref={inputRef}
          className="hardware-file-input"
          type="file"
          accept="application/json,.json"
          aria-label="Import hardware calibration JSON"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void file.text().then(onImportText);
          }}
        />
      </div>

      <p className="display-diagnostic-note" data-testid="detection-time">
        Last successful detection: {detectedAt ? formatTime(detectedAt) : 'No successful read yet.'}
      </p>
      {displayError ? <p role="alert">{displayError}</p> : null}
      {cameraError ? <p role="alert">{cameraError}</p> : null}
      {storageError ? <p role="alert">{storageError}</p> : null}
      {formError ? <p role="alert">{formError}</p> : null}
      {notice ? <p data-testid="hardware-notice">{notice}</p> : null}

      <section aria-label="Detected display and camera">
        <h2>Live readings</h2>
        <p className="display-diagnostic-note">
          Detected values come from the current display and webcam. Unknown means this screen could not read that value.
          Webcam resolution is the external mirror camera, not the laptop camera, and it is the size that camera opened.
          The overlay canvas is the selected display bounds. Letterbox offsets come from the existing fit.
        </p>
        {live.displayMessage ? <p>{live.displayMessage}</p> : null}
        <ReadingList rows={liveRows} prefix="live" />
      </section>

      <section aria-label="Sign convention">
        <h2>Sign convention</h2>
        <ul className="hardware-convention">
          <li>Top, left, and right offsets are measured inward from those edges of the plastic.</li>
          <li>Webcam X is positive to the right of the TV center.</li>
          <li>Webcam Y is positive above the TV center.</li>
          <li>Positive tilt means the lens points upward.</li>
        </ul>
      </section>

      <section aria-label="Physical measurements">
        <h2>Physical measurements</h2>
        {GROUPS.map((group) => (
          <div key={group.id}>
            <h3>{group.title}</h3>
            <p className="display-diagnostic-note">{group.note}</p>
            <div className="hardware-diagnostic-grid">
              {MANUAL_FIELD_SPECS.filter((field) => field.group === group.id).map((field) => {
                const status = manualEntryStatus(draft[field.key]);
                return (
                  <label key={field.key} className="hardware-field" data-testid={`field-${field.key}`}>
                    <span className="hardware-field-label">
                      {field.label}
                      <StatusBadge status={status} />
                    </span>
                    <span className="hardware-field-control">
                      <input
                        data-testid={`manual-${field.key}`}
                        inputMode="decimal"
                        value={draft[field.key]}
                        onChange={(event) => onDraftChange(field.key, event.target.value)}
                      />
                      <span>{field.unit === 'in' ? 'inches' : 'degrees'}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section aria-label="Saved detection snapshot">
        <h2>Saved detection snapshot</h2>
        {savedSnapshot ? (
          <>
            <p className="display-diagnostic-note">
              Recorded {formatTime(savedSnapshot.capturedAt)}. These values do not replace the live readings above.
            </p>
            <ReadingList rows={liveReadingRows(savedSnapshot)} prefix="saved" />
          </>
        ) : (
          <p>No saved detection snapshot yet.</p>
        )}
      </section>
    </main>
  );
}

function ReadingList({
  rows,
  prefix,
}: {
  rows: ReturnType<typeof liveReadingRows>;
  prefix: string;
}) {
  return (
    <dl className="hardware-reading-list">
      {rows.map((row) => (
        <div key={row.id} data-testid={`${prefix}-${row.id}`}>
          <dt>
            {row.label}
            <StatusBadge status={row.status} />
          </dt>
          <dd>{row.text}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusBadge({ status }: { status: MeasurementStatus }) {
  const label = status === 'detected' ? 'Detected' : status === 'entered' ? 'Entered' : 'Unknown';
  return (
    <span className={`hardware-status hardware-status-${status}`} data-status={status}>
      {label}
    </span>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function downloadJson(json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'hardware-calibration.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

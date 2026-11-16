import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getVersion } from '@tauri-apps/api/app';
import { checkForUpdate, applyUpdate, type AvailableUpdate } from '../services/updater';
import { useTranslation } from 'react-i18next';
import { Segmented, Modal, Button, HelpTip, SectionLabel, Toggle, Slider, Select } from '../ui';
import { SUPPORTED_LANGS, LANG_LABELS, changeLang, type Lang } from '../i18n';
import type { HotkeysApi } from '../app/useHotkeys';
import HotkeySettings from './HotkeySettings';
import MinimapSettings from './MinimapSettings';
import type { MinimapApi } from '../app/useMinimapWindow';
import TrackerSettings from './TrackerSettings';
import SquadServerSettings from './SquadServerSettings';
import type { TrackerApi } from '../app/useTracker';
import AppearanceSettings from './AppearanceSettings';
import LinkSettings from '../link/LinkSettings';
import ConnectionTest from '../net/ConnectionTest';
import {
  Desktop,
  Info,
  Keyboard,
  MapTrifold,
  PaintBrush,
  PlugsConnected,
  SlidersHorizontal,
  UsersThree,
} from '@phosphor-icons/react';

export type SettingsTab = 'general' | 'appearance' | 'minimap' | 'hotkeys' | 'party' | 'devices' | 'integrations' | 'about';

interface SettingsModalProps {
  onClose: () => void;
  onChanged?: (resolvedLogsDir: string) => void;
  railSide: 'left' | 'right';
  onRailSideChange: (side: 'left' | 'right') => void;
  followCenter: boolean;
  onFollowCenterChange: (on: boolean) => void;
  followZoom: number;
  onFollowZoomChange: (zoom: number) => void;
  floorLock: boolean;
  onFloorLockChange: (locked: boolean) => void;
  hotkeys?: HotkeysApi;
  /** Whether the last always-on-top request succeeded (null = not tried yet). */
  compactOnTopOk?: boolean | null;
  minimap?: MinimapApi;
  tracker?: TrackerApi;
  /** Replays the opening animation (Appearance tab). */
  onReplayIntro?: () => void;
  /** Tab to open on (defaults to General). */
  initialTab?: SettingsTab;
}

export default function SettingsModal({
  onClose,
  onChanged,
  railSide,
  onRailSideChange,
  followCenter,
  onFollowCenterChange,
  followZoom,
  onFollowZoomChange,
  floorLock,
  onFloorLockChange,
  hotkeys,
  compactOnTopOk,
  minimap,
  tracker,
  onReplayIntro,
  initialTab = 'general',
}: SettingsModalProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [installRoot, setInstallRoot] = useState<string | null>(null);
  const [resolvedLogsDir, setResolvedLogsDir] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [foundUpdate, setFoundUpdate] = useState<AvailableUpdate | null>(null);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const config = await invoke<{ install_root: string | null }>('get_eft_config');
        if (!cancelled) setInstallRoot(config.install_root);
      } catch {
        // Running outside Tauri — leave installRoot null
      }
      try {
        const dir = await invoke<string>('get_resolved_logs_dir');
        if (!cancelled) {
          setResolvedLogsDir(dir);
          setResolveError(null);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setResolveError(e instanceof Error ? e.message : String(e));
          setResolvedLogsDir(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getVersion()
      .then((v) => { if (!cancelled) setAppVersion(v); })
      .catch(() => { /* outside Tauri */ });
    return () => { cancelled = true; };
  }, []);

  const handleCheckUpdate = useCallback(async () => {
    setChecking(true);
    setUpdateMsg(null);
    setFoundUpdate(null);
    const u = await checkForUpdate();
    if (u) {
      setFoundUpdate(u);
      setUpdateMsg(t('settings.updateAvailable', { version: u.version }));
    } else {
      setUpdateMsg(t('settings.upToDate'));
    }
    setChecking(false);
  }, [t]);

  const handleInstallUpdate = useCallback(async () => {
    if (!foundUpdate) return;
    setInstalling(true);
    setUpdateMsg(t('settings.downloadingUpdate', { version: foundUpdate.version }));
    try {
      await applyUpdate(foundUpdate.update, ({ downloaded, total }) => {
        if (total) {
          setUpdateMsg(t('settings.downloadingUpdateProgress', { version: foundUpdate.version, pct: Math.round((downloaded / total) * 100) }));
        }
      });
      // relaunch() restarts the app; only reached on failure.
    } catch (e) {
      setUpdateMsg(e instanceof Error ? e.message : t('errors.updateFailed'));
      setInstalling(false);
    }
  }, [foundUpdate, t]);

  const handleSetRoot = useCallback(
    async (root: string | null, msg: string) => {
      setBusy(true);
      try {
        const resolvedDir = await invoke<string>('set_eft_install_root', { root });
        setInstallRoot(root);
        setResolvedLogsDir(resolvedDir);
        setResolveError(null);
        setStatusMsg(msg);
        onChanged?.(resolvedDir);
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : String(e);
        setResolveError(err);
        setResolvedLogsDir(null);
        setStatusMsg(null);
      } finally {
        setBusy(false);
      }
    },
    [onChanged],
  );

  const handleChangeFolder = useCallback(async () => {
    const chosen = await openDialog({ directory: true, multiple: false, title: t('settings.selectEftInstallFolder') });
    if (!chosen || Array.isArray(chosen)) return;
    await handleSetRoot(chosen, t('settings.eftFolderUpdated'));
  }, [handleSetRoot]);

  const handleUseAutoDetect = useCallback(async () => {
    await handleSetRoot(null, t('settings.autoDetectReEnabled'));
  }, [handleSetRoot]);

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'general', label: t('settings.tabs.general'), icon: <SlidersHorizontal weight="duotone" /> },
    { id: 'appearance', label: t('settings.tabs.appearance'), icon: <PaintBrush weight="duotone" /> },
    { id: 'minimap', label: t('settings.tabs.minimap'), icon: <MapTrifold weight="duotone" /> },
    { id: 'hotkeys', label: t('settings.tabs.hotkeys'), icon: <Keyboard weight="duotone" /> },
    { id: 'party', label: t('settings.tabs.party'), icon: <UsersThree weight="duotone" /> },
    { id: 'devices', label: t('settings.tabs.devices'), icon: <Desktop weight="duotone" /> },
    { id: 'integrations', label: t('settings.tabs.integrations'), icon: <PlugsConnected weight="duotone" /> },
    { id: 'about', label: t('settings.tabs.about'), icon: <Info weight="duotone" /> },
  ];

  return (
    <Modal title={t('settings.title')} onClose={onClose} size="lg">
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              className={`settings-nav__btn${tab === x.id ? ' is-on' : ''}`}
              aria-current={tab === x.id ? 'page' : undefined}
              onClick={() => setTab(x.id)}
            >
              {x.icon}
              <span>{x.label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-pane" key={tab}>
          {tab === 'appearance' && <AppearanceSettings onReplayIntro={onReplayIntro} />}
          {tab === 'general' && (
            <div className="settings-body">
        <SectionLabel>{t('settings.language')}</SectionLabel>
        <div className="settings-row">
          <div className="settings-row__text">
            <span>{t('settings.language')}</span>
            <HelpTip>{t('settings.languageHint')}</HelpTip>
          </div>
          <div className="settings-row__control">
            <Select
              aria-label={t('settings.language')}
              value={i18n.language}
              onChange={(e) => { void changeLang(e.target.value as Lang); }}
            >
              {SUPPORTED_LANGS.map((lng) => (
                <option key={lng} value={lng}>{LANG_LABELS[lng]}</option>
              ))}
            </Select>
          </div>
        </div>

        <SectionLabel>{t('settings.controlRailSide')}</SectionLabel>
        <Segmented
          fullWidth
          value={railSide}
          onChange={(v) => onRailSideChange(v as 'left' | 'right')}
          options={[
            { id: 'left', label: t('settings.leftRail') },
            { id: 'right', label: t('settings.rightRail') },
          ]}
        />

        <SectionLabel>{t('settings.onScreenshot')}</SectionLabel>
        <div className="settings-row">
          <div className="settings-row__text">
            <span>{t('settings.jumpToPosition')}</span>
            <HelpTip>{t('settings.jumpToPositionHint')}</HelpTip>
          </div>
          <Toggle checked={followCenter} onChange={onFollowCenterChange} label={t('settings.jumpToPositionLabel')} />
        </div>
        <div className="settings-row">
          <div className="settings-row__text">
            <span>{t('settings.followZoom')}</span>
            <HelpTip>{t('settings.followZoomHint')}</HelpTip>
          </div>
          <div className="settings-row__control">
            <Slider
              label={t('settings.followZoomLabel')}
              min={-1}
              max={4}
              step={0.5}
              value={followZoom}
              onChange={onFollowZoomChange}
              disabled={!followCenter}
              valueText={(followZoom >= 0 ? '+' : '') + followZoom.toFixed(1)}
            />
          </div>
        </div>

        <SectionLabel>{t('settings.floors')}</SectionLabel>
        <div className="settings-row">
          <div className="settings-row__text">
            <span>{t('settings.automaticFloorsOnly')}</span>
            <HelpTip>{t('settings.automaticFloorsOnlyHint')}</HelpTip>
          </div>
          <Toggle checked={floorLock} onChange={onFloorLockChange} label={t('settings.automaticFloorsOnlyLabel')} />
        </div>

        <SectionLabel help={t('settings.compactModeHint')}>{t('settings.compactMode')}</SectionLabel>
        {compactOnTopOk === false && <p className="settings-err">{t('settings.compactOnTopFailed')}</p>}

            </div>
          )}
          {tab === 'minimap' && (
            <div className="settings-body">
              <SectionLabel help={`${t('settings.minimapHint')} ${t('settings.minimapLimits')}`}>{t('settings.minimap')}</SectionLabel>
              {minimap ? <MinimapSettings minimap={minimap} /> : <p className="muted">{t('settings.desktopOnly')}</p>}
            </div>
          )}
          {tab === 'hotkeys' && (
            <div className="settings-body">
              <SectionLabel help={t('settings.hotkeysHint')}>{t('settings.hotkeys')}</SectionLabel>
              {hotkeys ? <HotkeySettings hotkeys={hotkeys} /> : <p className="muted">{t('settings.desktopOnly')}</p>}
            </div>
          )}
          {tab === 'party' && (
            <div className="settings-body">
              <SectionLabel help={t('net.test.hint')}>{t('net.test.title')}</SectionLabel>
              <ConnectionTest />
              <SectionLabel help={t('settings.squadServer.hint')}>{t('settings.squadServer.title')}</SectionLabel>
              <SquadServerSettings />
            </div>
          )}
          {tab === 'devices' && (
            <div className="settings-body">
              <LinkSettings />
              <SectionLabel help={t('net.test.hint')}>{t('net.test.title')}</SectionLabel>
              <ConnectionTest />
            </div>
          )}
          {tab === 'integrations' && (
            <div className="settings-body">
        {tracker && (
          <>
            <SectionLabel help={`${t('settings.tracker.hint')} ${t('settings.tracker.modeNote')}`}>{t('settings.tracker.title')}</SectionLabel>
            <TrackerSettings tracker={tracker} />
          </>
        )}

        <SectionLabel>{t('settings.eftInstallFolder')}</SectionLabel>
        {installRoot === null ? (
          <p className="muted">{t('settings.autoDetect')}</p>
        ) : (
          <p><code>{installRoot}</code></p>
        )}
        {resolvedLogsDir ? (
          <p className="settings-ok">{t('settings.logsDirectory')}: <code>{resolvedLogsDir}</code> ✓</p>
        ) : resolveError ? (
          <p className="settings-err">✗ {resolveError}</p>
        ) : null}
        <div className="modal-actions">
          <Button onClick={handleChangeFolder} disabled={busy}>{t('settings.changeFolder')}</Button>
          <Button variant="tertiary" onClick={handleUseAutoDetect} disabled={busy}>
            {t('settings.useAutoDetect')}
          </Button>
        </div>
        {statusMsg && <p className="muted">{statusMsg}</p>}

            </div>
          )}
          {tab === 'about' && (
            <div className="settings-body">
        <SectionLabel>{t('settings.appUpdates')}</SectionLabel>
        <p className="muted">{t('settings.currentVersion', { version: appVersion ?? '—' })}</p>
        <div className="modal-actions">
          <Button onClick={handleCheckUpdate} loading={checking} disabled={installing}>
            {t('settings.checkForUpdates')}
          </Button>
          {foundUpdate && (
            <Button variant="primary" onClick={handleInstallUpdate} loading={installing}>
              {t('settings.installAndRestart')}
            </Button>
          )}
        </div>
        {updateMsg && <p className="muted">{updateMsg}</p>}

        <SectionLabel>{t('settings.about')}</SectionLabel>
        <p className="settings-credits">
          {t('settings.credits')}
        </p>
        <p className="settings-credits">{t('settings.creditsIntro')}</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

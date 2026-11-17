// The icon spine of the Operator Rail — every control in the app hangs off
// this single 48px strip on the user's chosen screen side. Sections toggle the
// adjacent panel; tool + utility buttons act directly. See shell.css.

import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import {
  Crosshair,
  Scroll,
  Binoculars,
  UsersThree,
  ArrowCircleUp,
  ClockCounterClockwise,
  ChatTeardropText,
  Question,
  GearSix,
  ListChecks,
  ArrowsInSimple,
  Wrench,
  Target,
  DeviceMobile,
} from '@phosphor-icons/react';
import { Tooltip } from '../ui';

// The map is NOT a section: it's the top-level selection, pinned above every
// section's panel body (see .rail-panel__map in App.tsx).
export type RailSection = 'quests' | 'intel' | 'squad' | 'planner';

export interface SpineProps {
  side: 'left' | 'right';
  activeSection: RailSection | null;
  onToggleSection: (s: RailSection) => void;
  squadCount?: number;
  /** Quest count for the selected map (badge on the Quests section). */
  questCount?: number;
  // Utilities (draw tools live in the on-map MapToolsDock now)
  updateVersion?: string | null;
  updating?: boolean;
  onUpdate?: () => void;
  onSyncLogs: () => void;
  syncingLogs: boolean;
  onFeedback: () => void;
  onHowTo: () => void;
  onSettings: () => void;
  /** Opens the weapon bench. */
  onGunsmith?: () => void;
  /** Opens the ballistics table. */
  onBallistics?: () => void;
  /** Opens "map on the phone" (QR code). */
  onPhone?: () => void;
  /** Hotkey hints shown in tooltips, keyed by section / tool. */
  hints?: Partial<Record<RailSection | 'compact', string | null>>;
  onCompact?: () => void;
}

function SpineButton({
  label,
  hint,
  side,
  active,
  badge,
  className,
  children,
  ...rest
}: {
  label: string;
  hint?: string;
  side: 'left' | 'right';
  active?: boolean;
  badge?: number;
  className?: string;
  children: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Tooltip content={label} hint={hint} side={side === 'left' ? 'right' : 'left'}>
      <button
        className={['spine__btn', active && 'spine__btn--active', className]
          .filter(Boolean)
          .join(' ')}
        aria-label={label}
        aria-pressed={active}
        {...rest}
      >
        {children}
        {badge !== undefined && badge > 0 && <span className="spine__badge">{badge}</span>}
      </button>
    </Tooltip>
  );
}

export default function Spine({
  side,
  activeSection,
  onToggleSection,
  squadCount,
  questCount,
  updateVersion,
  updating,
  onUpdate,
  onSyncLogs,
  syncingLogs,
  onFeedback,
  onHowTo,
  onSettings,
  onGunsmith,
  onBallistics,
  onPhone,
  hints,
  onCompact,
}: SpineProps) {
  const { t } = useTranslation();
  const section = (id: RailSection, label: string, icon: ReactNode, badge?: number) => (
    <SpineButton
      label={label}
      hint={hints?.[id] ?? undefined}
      side={side}
      active={activeSection === id}
      badge={badge}
      onClick={() => onToggleSection(id)}
    >
      {icon}
    </SpineButton>
  );

  return (
    <nav className="spine" aria-label={t('rail.mainControls')}>
      <div className="spine__mark" title="Tarkov MoA">
        <Crosshair weight="duotone" />
      </div>

      {section(
        'quests',
        t('rail.questsOnMap'),
        <Scroll weight={activeSection === 'quests' ? 'fill' : 'regular'} />,
        questCount,
      )}
      {section(
        'intel',
        t('rail.mapIntel'),
        <Binoculars weight={activeSection === 'intel' ? 'fill' : 'regular'} />,
      )}
      {section(
        'squad',
        t('rail.squadMode'),
        <UsersThree weight={activeSection === 'squad' ? 'fill' : 'regular'} />,
        squadCount,
      )}
      {section(
        'planner',
        t('rail.planner'),
        <ListChecks weight={activeSection === 'planner' ? 'fill' : 'regular'} />,
      )}
      {onGunsmith && (
        <SpineButton label={t('rail.gunsmith')} side={side} onClick={onGunsmith}>
          <Wrench weight="regular" />
        </SpineButton>
      )}
      {onBallistics && (
        <SpineButton label={t('rail.ballistics')} side={side} onClick={onBallistics}>
          <Target weight="regular" />
        </SpineButton>
      )}
      {onPhone && (
        <SpineButton label={t('rail.phone')} side={side} onClick={onPhone}>
          <DeviceMobile weight="regular" />
        </SpineButton>
      )}

      <div className="spine__spacer" />

      {onCompact && (
        <SpineButton label={t('rail.compactMode')} hint={hints?.compact ?? undefined} side={side} onClick={onCompact}>
          <ArrowsInSimple weight="regular" />
        </SpineButton>
      )}

      {updateVersion && (
        <SpineButton
          label={updating ? t('rail.updating') : t('rail.updateTo', { version: updateVersion })}
          side={side}
          className="spine__btn--update"
          disabled={updating}
          onClick={onUpdate}
        >
          <ArrowCircleUp weight="fill" />
        </SpineButton>
      )}
      <SpineButton
        label={syncingLogs ? t('rail.syncingPastLogs') : t('rail.syncPastEftLogs')}
        side={side}
        disabled={syncingLogs}
        onClick={onSyncLogs}
      >
        <ClockCounterClockwise weight="regular" />
      </SpineButton>
      <SpineButton label={t('rail.feedback')} side={side} onClick={onFeedback}>
        <ChatTeardropText weight="regular" />
      </SpineButton>
      <SpineButton label={t('rail.howToUse')} side={side} onClick={onHowTo}>
        <Question weight="regular" />
      </SpineButton>
      <SpineButton label={t('rail.settings')} side={side} onClick={onSettings}>
        <GearSix weight="regular" />
      </SpineButton>
    </nav>
  );
}

import type { ReactNode } from 'react';
import { Question } from '@phosphor-icons/react';
import Tooltip from './Tooltip';

export interface HelpTipProps {
  /** The explanation, shown on hover or keyboard focus. */
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

/**
 * A small "?" that explains a setting or a panel on hover, so the screen
 * keeps one line per thing instead of paragraphs of help.
 */
export default function HelpTip({ children, side = 'top', className }: HelpTipProps) {
  if (children === null || children === undefined || children === false || children === '') return null;
  return (
    <Tooltip content={children} side={side} delay={120} wide>
      <span className={['ui-help', className].filter(Boolean).join(' ')} tabIndex={0} role="img" aria-label={typeof children === 'string' ? children : undefined}>
        <Question weight="bold" />
      </span>
    </Tooltip>
  );
}

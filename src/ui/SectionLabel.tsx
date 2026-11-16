import type { ReactNode } from 'react';
import HelpTip from './HelpTip';

export interface SectionLabelProps {
  children: ReactNode;
  /** Mono count at the end (e.g. number of quests). */
  count?: number;
  className?: string;
  /** Explanation behind a "?" next to the heading. */
  help?: ReactNode;
}

/** Etched section heading with a hairline rule — the FIELD GLASS "engraving". */
export default function SectionLabel({ children, count, className, help }: SectionLabelProps) {
  return (
    <h3 className={['ui-section-label', className].filter(Boolean).join(' ')}>
      {children}
      {help && <HelpTip>{help}</HelpTip>}
      {count !== undefined && <span className="ui-section-label__count">{count}</span>}
    </h3>
  );
}

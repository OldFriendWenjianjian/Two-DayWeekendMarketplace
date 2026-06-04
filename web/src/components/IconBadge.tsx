import type { ReactNode } from 'react';

type IconBadgeProps = {
  children: ReactNode;
  label: string;
  tone?: 'green' | 'coral' | 'blue' | 'gold' | 'pink' | 'mint';
};

export function IconBadge({ children, label, tone = 'green' }: IconBadgeProps) {
  return (
    <span className={`icon-badge icon-badge--${tone}`} title={label} aria-label={label}>
      {children}
    </span>
  );
}

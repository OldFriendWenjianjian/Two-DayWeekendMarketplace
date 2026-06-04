import { ShieldCheck } from 'lucide-react';
import type { LedgerEvent } from '../lib/types';

type LedgerTimelineProps = {
  events: LedgerEvent[];
  compact?: boolean;
};

export function LedgerTimeline({ events, compact = false }: LedgerTimelineProps) {
  if (!events.length) {
    return <div className="empty">暂无账本事件</div>;
  }

  return (
    <div className={`ledger ${compact ? 'ledger--compact' : ''}`}>
      {events.map((event) => (
        <article className="ledger__item" key={event.id}>
          <div className="ledger__icon">
            <ShieldCheck size={16} />
          </div>
          <div className="ledger__body">
            <div className="ledger__head">
              <strong>{event.title}</strong>
              {typeof event.scoreDelta === 'number' && (
                <span className={event.scoreDelta >= 0 ? 'score score--up' : 'score score--down'}>
                  {event.scoreDelta >= 0 ? '+' : ''}
                  {event.scoreDelta}
                </span>
              )}
            </div>
            <p>{event.detail}</p>
            <code>{event.txHash}</code>
            <span className="ledger__meta">区块 #{event.blockHeight} · {event.createdAt}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

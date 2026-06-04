import type { ConsensusActionType, ConsensusEvaluation } from './consensus';

export const LOCAL_CONSENSUS_FEEDBACK_KEY = 'tdwm-local-consensus-feedback';

export type LocalConsensusFeedback = {
  id: string;
  actorKey: string;
  targetStoreId: string;
  productId?: string;
  actionType: ConsensusActionType;
  reason: string;
  consensusVersion: string;
  governanceWeight: number;
  hasTradeAnchor: boolean;
  hasResponsibilityAnchor: boolean;
  createdAt: string;
};

type LocalConsensusFeedbackStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function createLocalConsensusFeedback(input: {
  actorKey: string;
  targetStoreId: string;
  productId?: string;
  reason: string;
  evaluation: ConsensusEvaluation;
}): LocalConsensusFeedback {
  return {
    id: `feedback-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    actorKey: input.actorKey,
    targetStoreId: input.targetStoreId,
    productId: input.productId,
    actionType: input.evaluation.actionType,
    reason: input.reason,
    consensusVersion: input.evaluation.version,
    governanceWeight: input.evaluation.governanceWeight,
    hasTradeAnchor: input.evaluation.hasTradeAnchor,
    hasResponsibilityAnchor: input.evaluation.hasResponsibilityAnchor,
    createdAt: new Date().toISOString(),
  };
}

export function loadLocalConsensusFeedback(storage: LocalConsensusFeedbackStorage): LocalConsensusFeedback[] {
  try {
    const raw = storage.getItem(LOCAL_CONSENSUS_FEEDBACK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLocalConsensusFeedback);
  } catch {
    return [];
  }
}

export function saveLocalConsensusFeedback(
  storage: LocalConsensusFeedbackStorage,
  feedback: LocalConsensusFeedback[]
): { ok: true } | { ok: false; message: string } {
  try {
    storage.setItem(LOCAL_CONSENSUS_FEEDBACK_KEY, JSON.stringify(feedback));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '本机共识反馈保存失败',
    };
  }
}

function isLocalConsensusFeedback(value: unknown): value is LocalConsensusFeedback {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<LocalConsensusFeedback>;
  return Boolean(
    item.id &&
      item.actorKey &&
      item.targetStoreId &&
      item.actionType &&
      item.reason &&
      item.consensusVersion &&
      typeof item.governanceWeight === 'number' &&
      typeof item.hasTradeAnchor === 'boolean' &&
      typeof item.hasResponsibilityAnchor === 'boolean' &&
      item.createdAt
  );
}

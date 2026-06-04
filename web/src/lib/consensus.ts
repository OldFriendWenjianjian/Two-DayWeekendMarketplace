export const CONSENSUS_VERSION = 'dual-anchor-v1';

export type ConsensusActionType = 'comment' | 'order_review' | 'staked_complaint' | 'removal_vote';

export type ConsensusLedgerImpact =
  | 'actor_history'
  | 'target_history'
  | 'target_core_reputation'
  | 'governance_queue';

export type ConsensusActor = {
  id: string;
  completedOrderIds: string[];
  reputationStake: number;
  witnessEndorsements: number;
  maliciousActionCount: number;
};

export type ConsensusAction = {
  type: ConsensusActionType;
  orderId?: string;
  stake?: number;
  witnessSignatures?: string[];
};

export type ConsensusThresholds = {
  minimumResponsibilityStake: number;
  witnessQuorum: number;
  maxStakeWeight: number;
  maxWitnessWeight: number;
  maliciousZeroAt: number;
  maliciousPenaltyPerRecord: number;
};

export type ConsensusEvaluation = {
  version: typeof CONSENSUS_VERSION;
  actionType: ConsensusActionType;
  canAffectCoreReputation: boolean;
  governanceWeight: number;
  ledgerImpact: ConsensusLedgerImpact[];
  hasTradeAnchor: boolean;
  hasResponsibilityAnchor: boolean;
  reason: string;
};

export const defaultConsensusThresholds: ConsensusThresholds = {
  minimumResponsibilityStake: 100,
  witnessQuorum: 3,
  maxStakeWeight: 3,
  maxWitnessWeight: 2,
  maliciousZeroAt: 3,
  maliciousPenaltyPerRecord: 0.35,
};

const rounded = (value: number) => Number(value.toFixed(2));

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const penaltyMultiplier = (actor: ConsensusActor, thresholds: ConsensusThresholds) => {
  if (actor.maliciousActionCount >= thresholds.maliciousZeroAt) return 0;
  return clamp(1 - actor.maliciousActionCount * thresholds.maliciousPenaltyPerRecord, 0, 1);
};

const baseEvaluation = (
  action: ConsensusAction,
  overrides: Omit<ConsensusEvaluation, 'version' | 'actionType'>
): ConsensusEvaluation => ({
  version: CONSENSUS_VERSION,
  actionType: action.type,
  ...overrides,
});

export function evaluateConsensusAction(
  actor: ConsensusActor,
  action: ConsensusAction,
  thresholds: ConsensusThresholds = defaultConsensusThresholds
): ConsensusEvaluation {
  const hasTradeAnchor = Boolean(action.orderId && actor.completedOrderIds.includes(action.orderId));
  const witnessCount = action.witnessSignatures?.length || actor.witnessEndorsements || 0;
  const actionStake = action.stake || 0;
  const effectiveStake = Math.max(actionStake, actor.reputationStake);
  const hasStakeAnchor = effectiveStake >= thresholds.minimumResponsibilityStake;
  const hasWitnessAnchor = witnessCount >= thresholds.witnessQuorum;
  const hasResponsibilityAnchor = hasStakeAnchor || hasWitnessAnchor;
  const penalty = penaltyMultiplier(actor, thresholds);

  if (action.type === 'comment') {
    return baseEvaluation(action, {
      canAffectCoreReputation: false,
      governanceWeight: 0,
      ledgerImpact: ['actor_history', 'target_history'],
      hasTradeAnchor: false,
      hasResponsibilityAnchor: false,
      reason: '普通留言可见并留痕，但不影响任何人的核心信誉。',
    });
  }

  if (action.type === 'order_review') {
    const governanceWeight = hasTradeAnchor ? rounded(1 * penalty) : 0;
    return baseEvaluation(action, {
      canAffectCoreReputation: governanceWeight > 0,
      governanceWeight,
      ledgerImpact: governanceWeight > 0
        ? ['actor_history', 'target_history', 'target_core_reputation']
        : ['actor_history', 'target_history'],
      hasTradeAnchor,
      hasResponsibilityAnchor: false,
      reason: governanceWeight > 0
        ? '已完成订单提供真实交易锚，评价会同时写入双方履历。'
        : '没有匹配的已完成订单，评价只能作为普通留痕。',
    });
  }

  const stakeWeight = hasStakeAnchor
    ? clamp(effectiveStake / thresholds.minimumResponsibilityStake, 0, thresholds.maxStakeWeight)
    : 0;
  const witnessWeight = hasWitnessAnchor
    ? clamp(witnessCount / thresholds.witnessQuorum, 0, thresholds.maxWitnessWeight)
    : 0;
  const responsibilityWeight = Math.max(stakeWeight, witnessWeight);

  if (action.type === 'staked_complaint') {
    const complaintBaseWeight = (hasTradeAnchor ? 1 : 0) + responsibilityWeight;
    const governanceWeight = complaintBaseWeight > 0 ? rounded(complaintBaseWeight * penalty) : 0;
    return baseEvaluation(action, {
      canAffectCoreReputation: governanceWeight > 0,
      governanceWeight,
      ledgerImpact: governanceWeight > 0
        ? ['actor_history', 'target_history', 'target_core_reputation', 'governance_queue']
        : ['actor_history', 'target_history'],
      hasTradeAnchor,
      hasResponsibilityAnchor,
      reason: governanceWeight > 0
        ? '交易锚或责任押注锚成立，投诉会影响核心信誉；若恶意投诉，发起人履历也会被追责。'
        : '没有真实交易、责任押注或见证人 quorum，投诉只作为普通反馈留痕。',
    });
  }

  const removalBaseWeight = (hasTradeAnchor ? 1 : 0) + responsibilityWeight;
  const governanceWeight = removalBaseWeight > 0 ? rounded(removalBaseWeight * penalty) : 0;

  return baseEvaluation(action, {
    canAffectCoreReputation: governanceWeight > 0,
    governanceWeight,
    ledgerImpact: governanceWeight > 0
      ? ['actor_history', 'target_history', 'target_core_reputation', 'governance_queue']
      : ['actor_history', 'target_history'],
    hasTradeAnchor,
    hasResponsibilityAnchor,
    reason: governanceWeight > 0
      ? '交易锚或责任押注锚成立，下架申请进入治理队列，并写入评价者自己的履历。'
      : '账号数量和账号年龄不产生治理权；缺少交易锚或责任押注锚时只能提交 0 权重反馈。',
  });
}

export const sumGovernanceWeight = (evaluations: ConsensusEvaluation[]) =>
  rounded(evaluations.reduce((total, item) => total + item.governanceWeight, 0));

export const formatGovernanceWeight = (weight: number) =>
  Number.isInteger(weight) ? `${weight}` : weight.toFixed(2);

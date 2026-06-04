import { describe, expect, it } from 'vitest';
import {
  evaluateConsensusAction,
  sumGovernanceWeight,
  type ConsensusActor,
} from './consensus';

const actor = (overrides: Partial<ConsensusActor> = {}): ConsensusActor => ({
  id: 'buyer-a',
  completedOrderIds: [],
  reputationStake: 0,
  witnessEndorsements: 0,
  maliciousActionCount: 0,
  ...overrides,
});

describe('dual-anchor reputation consensus', () => {
  it('keeps plain comments visible but powerless against core reputation', () => {
    const result = evaluateConsensusAction(actor(), { type: 'comment' });

    expect(result.canAffectCoreReputation).toBe(false);
    expect(result.governanceWeight).toBe(0);
    expect(result.ledgerImpact).toEqual(['actor_history', 'target_history']);
  });

  it('gives verified completed-order reviews a trade anchor', () => {
    const result = evaluateConsensusAction(
      actor({ completedOrderIds: ['order-1'] }),
      { type: 'order_review', orderId: 'order-1' }
    );

    expect(result.canAffectCoreReputation).toBe(true);
    expect(result.hasTradeAnchor).toBe(true);
    expect(result.governanceWeight).toBe(1);
    expect(result.ledgerImpact).toContain('target_core_reputation');
  });

  it('rejects reviews that cannot prove a completed order', () => {
    const result = evaluateConsensusAction(
      actor({ completedOrderIds: ['order-1'] }),
      { type: 'order_review', orderId: 'order-2' }
    );

    expect(result.canAffectCoreReputation).toBe(false);
    expect(result.hasTradeAnchor).toBe(false);
    expect(result.governanceWeight).toBe(0);
  });

  it('allows serious complaints through responsibility stake or witness quorum', () => {
    const staked = evaluateConsensusAction(actor(), { type: 'staked_complaint', stake: 180 });
    const witnessed = evaluateConsensusAction(actor(), {
      type: 'staked_complaint',
      witnessSignatures: ['w1', 'w2', 'w3'],
    });

    expect(staked.canAffectCoreReputation).toBe(true);
    expect(staked.hasResponsibilityAnchor).toBe(true);
    expect(staked.governanceWeight).toBe(1.8);
    expect(witnessed.canAffectCoreReputation).toBe(true);
    expect(witnessed.governanceWeight).toBe(1);
  });

  it('keeps empty removal votes at zero even with ten thousand aged accounts', () => {
    const emptyVotes = Array.from({ length: 10000 }, (_, index) =>
      evaluateConsensusAction(
        { ...actor({ id: `empty-${index}` }), accountAgeDays: 3650 } as ConsensusActor,
        { type: 'removal_vote' }
      )
    );

    expect(sumGovernanceWeight(emptyVotes)).toBe(0);
    expect(emptyVotes.every((vote) => !vote.canAffectCoreReputation)).toBe(true);
  });

  it('records removal attempts in both histories and only counts anchored votes', () => {
    const emptyVote = evaluateConsensusAction(actor(), { type: 'removal_vote' });
    const orderVote = evaluateConsensusAction(
      actor({ completedOrderIds: ['order-1'] }),
      { type: 'removal_vote', orderId: 'order-1' }
    );

    expect(emptyVote.ledgerImpact).toEqual(['actor_history', 'target_history']);
    expect(emptyVote.governanceWeight).toBe(0);
    expect(orderVote.ledgerImpact).toContain('actor_history');
    expect(orderVote.ledgerImpact).toContain('target_core_reputation');
    expect(orderVote.governanceWeight).toBe(1);
  });

  it('removes influence from actors with repeated malicious records', () => {
    const result = evaluateConsensusAction(
      actor({ completedOrderIds: ['order-1'], maliciousActionCount: 3 }),
      { type: 'removal_vote', orderId: 'order-1' }
    );

    expect(result.canAffectCoreReputation).toBe(false);
    expect(result.governanceWeight).toBe(0);
  });
});

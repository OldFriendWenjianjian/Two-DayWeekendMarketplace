import { describe, expect, it } from 'vitest';
import { evaluateConsensusAction } from './consensus';
import {
  createLocalConsensusFeedback,
  loadLocalConsensusFeedback,
  saveLocalConsensusFeedback,
} from './localConsensusFeedback';

function createStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

describe('local consensus feedback history', () => {
  it('persists zero-weight feedback without needing a remote governance endpoint', () => {
    const storage = createStorage();
    const evaluation = evaluateConsensusAction(
      {
        id: 'empty-account',
        completedOrderIds: [],
        reputationStake: 0,
        witnessEndorsements: 0,
        maliciousActionCount: 0,
      },
      { type: 'removal_vote' }
    );
    const feedback = createLocalConsensusFeedback({
      actorKey: 'empty-account',
      targetStoreId: 'store-a',
      productId: 'p-1',
      reason: '普通反馈',
      evaluation,
    });

    expect(feedback.governanceWeight).toBe(0);
    expect(saveLocalConsensusFeedback(storage, [feedback]).ok).toBe(true);
    expect(loadLocalConsensusFeedback(storage)).toEqual([feedback]);
  });
});

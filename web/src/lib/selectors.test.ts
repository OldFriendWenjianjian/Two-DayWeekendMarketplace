import { describe, expect, it } from 'vitest';
import { mockData } from './mockData';
import { cartTotal, filterProducts } from './selectors';

describe('marketplace selectors', () => {
  it('filters products by search query and category', () => {
    const results = filterProducts(mockData.products, '冷萃', 'fresh');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('p-001');
  });

  it('calculates cart total from product prices', () => {
    const total = cartTotal(
      [
        { productId: 'p-001', quantity: 2 },
        { productId: 'p-003', quantity: 1 },
      ],
      mockData
    );
    expect(total).toBe(157);
  });
});

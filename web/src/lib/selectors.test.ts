import { describe, expect, it } from 'vitest';
import { mockData } from './mockData';
import { cartTotal, completedOrderIdForBuyerProduct, completedOrdersForBuyer, filterProducts } from './selectors';

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

  it('uses only the current buyer completed orders as trade anchors', () => {
    expect(completedOrdersForBuyer(mockData.orders, 'android-buyer-demo').map((order) => order.id)).toEqual([
      'ORD-20260601-004',
    ]);
    expect(completedOrderIdForBuyerProduct(mockData.orders, 'android-buyer-demo', 'p-002')).toBe(
      'ORD-20260601-004'
    );
    expect(completedOrderIdForBuyerProduct(mockData.orders, 'someone-else', 'p-002')).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  createPendingProductUpload,
  loadPendingProductUploads,
  mergePendingProductUploads,
  savePendingProductUploads,
} from './pendingUploads';
import type { Product } from './types';

function createStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const payload = {
  sellerId: 'weekend-shop',
  title: '双休商品',
  description: '等待上传的商品',
  category: 'craft' as const,
  priceCents: 6800,
  currency: 'CNY' as const,
  contact: 'wechat:weekend',
  images: ['data:image/png;base64,abc'],
};

describe('pending product uploads', () => {
  it('persists pending uploads', () => {
    const storage = createStorage();
    const pending = createPendingProductUpload(payload);

    expect(savePendingProductUploads(storage, [pending]).ok).toBe(true);
    expect(loadPendingProductUploads(storage)).toEqual([pending]);
  });

  it('merges pending products before remote products', () => {
    const pending = createPendingProductUpload(payload);
    const remote: Product = {
      id: 'remote-1',
      storeId: 'store',
      title: '远端商品',
      category: 'fresh',
      price: 12,
      stock: 99,
      rating: 4.8,
      sold: 0,
      image: 'remote',
      tags: [],
      description: '',
      specs: {},
    };

    const products = mergePendingProductUploads([remote], [pending]);

    expect(products[0].id).toBe(pending.localProductId);
    expect(products[0].tags).toContain('等待上传');
    expect(products[1]).toEqual(remote);
  });
});

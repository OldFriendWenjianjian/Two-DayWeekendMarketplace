import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postMarketplaceAction } from './api';

describe('marketplace API actions', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem: () => 'http://api.example.test/shc-20260520-a1faaf/weekend-marketplace/api',
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      location: {
        origin: 'http://localhost:8787',
        pathname: '/',
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns a remote failure for HTTP errors instead of mock success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'sellerId is already registered' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );

    const result = await postMarketplaceAction('/sellers/apply', {
      sellerId: 'taken',
    });

    expect(result.ok).toBe(false);
    expect(result.mode).toBe('remote');
    expect(result.message).toBe('sellerId is already registered');
  });

  it('uses mock mode only when the backend cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network failed');
      })
    );

    const result = await postMarketplaceAction('/orders', {
      productId: 'p-001',
    });

    expect(result.ok).toBe(true);
    expect(result.mode).toBe('mock');
  });
});

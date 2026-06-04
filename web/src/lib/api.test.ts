import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchSignalMessages, postMarketplaceAction, postSignalMessage } from './api';

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

  it('posts and fetches P2P signaling messages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ messageId: 'sig-1' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [
              {
                messageId: 'sig-2',
                roomId: 'room-a',
                fromPeer: 'merchant-a',
                toPeer: 'viewer-a',
                type: 'host-answer',
                payload: { ok: true },
                createdAt: '2026-06-04T08:00:00.000Z',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    await postSignalMessage('room-a', {
      fromPeer: 'viewer-a',
      toPeer: 'merchant-a',
      type: 'viewer-offer',
      payload: { offer: { type: 'offer' } },
    });
    const result = await fetchSignalMessages('room-a', 'viewer-a', '2026-06-04T07:59:00.000Z');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://api.example.test/shc-20260520-a1faaf/weekend-marketplace/api/signaling/rooms/room-a/messages',
      expect.objectContaining({ method: 'POST' })
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      '/api/signaling/rooms/room-a/messages?peer=viewer-a&since=2026-06-04T07%3A59%3A00.000Z'
    );
    expect(result.messages[0].type).toBe('host-answer');
  });
});

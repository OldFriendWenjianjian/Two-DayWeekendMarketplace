import { mockData } from './mockData';
import type { ApiHealth, MarketplacePayload } from './types';

const DEFAULT_REMOTE_BASE =
  'http://[2402:4e00:c013:8600:5602:3dc2:a2d0:0]/shc-20260520-a1faaf/weekend-marketplace/api';
const LOCAL_BASE = 'http://localhost:8787/shc-20260520-a1faaf/weekend-marketplace/api';
const API_BASE_STORAGE_KEY = 'tdwm-api-base';

type RuntimeWindow = Window & {
  __MARKETPLACE_API_BASE__?: string;
};

type MarketplaceActionResult = {
  ok: boolean;
  mode: 'remote' | 'mock';
  message: string;
  data?: unknown;
};

const withTimeout = async (url: string, init?: RequestInit, timeoutMs = 2500) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
};

export const getApiBase = () => {
  const fromGlobal = (window as RuntimeWindow).__MARKETPLACE_API_BASE__;
  const fromEnv = import.meta.env.VITE_API_BASE as string | undefined;
  const fromStorage = window.localStorage.getItem(API_BASE_STORAGE_KEY) || undefined;
  return fromStorage || fromGlobal || fromEnv || getSameOriginApiBase() || DEFAULT_REMOTE_BASE;
};

export const setApiBase = (value: string) => {
  window.localStorage.setItem(API_BASE_STORAGE_KEY, value.trim());
};

export const resetApiBase = () => {
  window.localStorage.removeItem(API_BASE_STORAGE_KEY);
};

export const apiPresets = {
  defaultRemote: DEFAULT_REMOTE_BASE,
  local: LOCAL_BASE,
};

function getSameOriginApiBase() {
  const basePath = '/shc-20260520-a1faaf/weekend-marketplace/';
  if (window.location.pathname.startsWith(basePath)) {
    return `${window.location.origin}${basePath}api`;
  }
  return undefined;
}

export async function loadMarketplace(): Promise<{ data: MarketplacePayload; health: ApiHealth }> {
  const apiBase = getApiBase();
  try {
    const response = await withTimeout(`${apiBase}/marketplace`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as MarketplacePayload;
    return {
      data,
      health: {
        online: true,
        apiBase,
        mode: 'remote',
        message: '后端已连接',
      },
    };
  } catch (error) {
    return {
      data: mockData,
      health: {
        online: false,
        apiBase,
        mode: 'mock',
        message: `后端不可用，已使用本地演示数据：${error instanceof Error ? error.message : 'unknown'}`,
      },
    };
  }
}

export async function postMarketplaceAction<T extends Record<string, unknown>>(
  path: string,
  payload: T,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'POST'
): Promise<MarketplaceActionResult> {
  const apiBase = getApiBase();
  try {
    const response = await withTimeout(`${apiBase}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await readResponseBody(response);
    if (!response.ok) {
      return {
        ok: false,
        mode: 'remote',
        message: getErrorMessage(data) || `后端拒绝：HTTP ${response.status}`,
        data,
      };
    }
    return { ok: true, mode: 'remote', message: '已提交到后端', data };
  } catch (error) {
    return { ok: true, mode: 'mock', message: '后端不可用，已在演示模式中记录' };
  }
}

async function readResponseBody(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function getErrorMessage(data: unknown) {
  if (data && typeof data === 'object' && 'error' in data) {
    return String((data as { error: unknown }).error);
  }
  if (typeof data === 'string') return data;
  return '';
}

export function supportsWebRtc() {
  return typeof RTCPeerConnection !== 'undefined';
}

export async function createViewerOffer(roomId: string) {
  if (!supportsWebRtc()) {
    return {
      supported: false,
      offer: '',
      message: '当前 WebView/浏览器不支持 RTCPeerConnection',
    };
  }

  const peer = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  });
  peer.createDataChannel(`viewer-${roomId}`);
  const offer = await peer.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: true,
  });
  await peer.setLocalDescription(offer);
  peer.close();

  return {
    supported: true,
    offer: offer.sdp || '',
    message: '已生成观众端 SDP Offer，可通过信令通道发送给商户主播',
  };
}

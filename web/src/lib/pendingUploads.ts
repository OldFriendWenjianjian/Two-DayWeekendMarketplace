import type { Product, ProductCategory } from './types';

export const PENDING_PRODUCT_UPLOADS_KEY = 'tdwm-pending-product-uploads';

export type ProductUploadPayload = {
  sellerId: string;
  title: string;
  description: string;
  category: ProductCategory;
  priceCents: number;
  currency: 'CNY';
  contact: string;
  images: string[];
};

export type PendingProductUpload = {
  id: string;
  localProductId: string;
  payload: ProductUploadPayload;
  createdAt: string;
  lastAttemptAt?: string;
  status: 'pending' | 'syncing' | 'failed';
  error?: string;
};

type ProductUploadStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function createPendingProductUpload(payload: ProductUploadPayload): PendingProductUpload {
  const id = `pending-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    localProductId: `local-${id}`,
    payload,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
}

export function loadPendingProductUploads(storage: ProductUploadStorage): PendingProductUpload[] {
  try {
    const raw = storage.getItem(PENDING_PRODUCT_UPLOADS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isPendingProductUpload);
  } catch {
    return [];
  }
}

export function savePendingProductUploads(
  storage: ProductUploadStorage,
  uploads: PendingProductUpload[]
): { ok: true } | { ok: false; message: string } {
  try {
    storage.setItem(PENDING_PRODUCT_UPLOADS_KEY, JSON.stringify(uploads));
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : '待上传商品保存失败',
    };
  }
}

export function mergePendingProductUploads(
  products: Product[],
  uploads: PendingProductUpload[]
): Product[] {
  const pendingIds = new Set(uploads.map((upload) => upload.localProductId));
  const withoutOldPending = products.filter(
    (product) => !product.id.startsWith('local-pending-') && !pendingIds.has(product.id)
  );
  return [...uploads.map(toLocalPendingProduct), ...withoutOldPending];
}

export function toLocalPendingProduct(upload: PendingProductUpload): Product {
  const { payload } = upload;
  const statusLabel =
    upload.status === 'syncing' ? '正在上传' : upload.status === 'failed' ? '上传失败' : '等待上传';

  return {
    id: upload.localProductId,
    storeId: payload.sellerId,
    title: payload.title,
    category: payload.category,
    price: payload.priceCents / 100,
    stock: 99,
    rating: 4.8,
    sold: 0,
    image: payload.images[0],
    images: payload.images,
    tags: ['双休承诺', statusLabel],
    description: payload.description,
    specs: {
      联系: payload.contact,
      状态: statusLabel,
      提示: upload.error || '网络恢复后会重新上传到服务器',
    },
  };
}

function isPendingProductUpload(value: unknown): value is PendingProductUpload {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PendingProductUpload>;
  const payload = item.payload as Partial<ProductUploadPayload> | undefined;
  return Boolean(
    item.id &&
      item.localProductId &&
      item.createdAt &&
      ['pending', 'syncing', 'failed'].includes(String(item.status)) &&
      payload &&
      payload.sellerId &&
      payload.title &&
      typeof payload.priceCents === 'number' &&
      Array.isArray(payload.images)
  );
}

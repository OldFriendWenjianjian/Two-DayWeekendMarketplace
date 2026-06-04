import type { CartItem, MarketplacePayload, Product, ProductCategory, Store } from './types';

export const formatCurrency = (value: number) =>
  new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 0 }).format(value);

export const getStore = (data: MarketplacePayload, storeId: string) =>
  data.stores.find((store) => store.id === storeId);

export const getProduct = (data: MarketplacePayload, productId: string) =>
  data.products.find((product) => product.id === productId);

export const filterProducts = (
  products: Product[],
  query: string,
  category: ProductCategory | 'all',
  storeId?: string
) => {
  const normalized = query.trim().toLowerCase();
  return products.filter((product) => {
    const matchesQuery =
      !normalized ||
      product.title.toLowerCase().includes(normalized) ||
      product.tags.some((tag) => tag.toLowerCase().includes(normalized)) ||
      product.description.toLowerCase().includes(normalized);
    const matchesCategory = category === 'all' || product.category === category;
    const matchesStore = !storeId || product.storeId === storeId;
    return matchesQuery && matchesCategory && matchesStore;
  });
};

export const cartTotal = (items: CartItem[], data: MarketplacePayload) =>
  items.reduce((sum, item) => {
    const product = getProduct(data, item.productId);
    return sum + (product?.price || 0) * item.quantity;
  }, 0);

export const storeProducts = (data: MarketplacePayload, store: Store) =>
  data.products.filter((product) => product.storeId === store.id);

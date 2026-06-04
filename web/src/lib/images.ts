import type { CSSProperties } from 'react';
import type { Product } from './types';

const fallbackGradient = 'linear-gradient(135deg, #dff4df, #2f8f83)';

export function isRasterImageSource(value?: string) {
  return Boolean(value && /^(data:image\/|https?:\/\/|blob:)/i.test(value.trim()));
}

export function getProductImages(product?: Pick<Product, 'image' | 'images'>) {
  if (!product) return [];
  const images = Array.isArray(product.images) ? product.images.filter(isRasterImageSource) : [];
  if (images.length > 0) return images;
  return isRasterImageSource(product.image) ? [product.image] : [];
}

export function getProductCover(product?: Pick<Product, 'image' | 'images'>) {
  return getProductImages(product)[0] || product?.image || fallbackGradient;
}

export function visualBackgroundStyle(value?: string): CSSProperties {
  return isRasterImageSource(value) ? {} : { background: value || fallbackGradient };
}

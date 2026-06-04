import { ShoppingBag, Star } from 'lucide-react';
import type { Product, Store } from '../lib/types';
import { formatCurrency } from '../lib/selectors';
import { getProductCover, isRasterImageSource, visualBackgroundStyle } from '../lib/images';

type ProductCardProps = {
  product: Product;
  store?: Store;
  onOpen: (id: string) => void;
  onAdd: (id: string) => void;
};

export function ProductCard({ product, store, onOpen, onAdd }: ProductCardProps) {
  const cover = getProductCover(product);
  const hasPhoto = isRasterImageSource(cover);

  return (
    <article className="product-card">
      <button
        className={`product-card__image${hasPhoto ? ' product-card__image--photo' : ''}`}
        style={visualBackgroundStyle(cover)}
        onClick={() => onOpen(product.id)}
      >
        {hasPhoto ? <img src={cover} alt={product.title} /> : <span>{product.title.slice(0, 2)}</span>}
      </button>
      <div className="product-card__body">
        <button className="text-button product-card__title" onClick={() => onOpen(product.id)}>
          {product.title}
        </button>
        <div className="product-card__store">{store?.name || '未知店铺'}</div>
        <div className="tag-row">
          {product.tags.slice(0, 2).map((tag) => (
            <span className="tag" key={tag}>
              {tag}
            </span>
          ))}
        </div>
        <div className="product-card__meta">
          <strong>{formatCurrency(product.price)}</strong>
          <span>
            <Star size={13} fill="currentColor" /> {product.rating}
          </span>
        </div>
      </div>
      <button className="icon-button product-card__cart" onClick={() => onAdd(product.id)} aria-label="加入购物车">
        <ShoppingBag size={18} />
      </button>
    </article>
  );
}

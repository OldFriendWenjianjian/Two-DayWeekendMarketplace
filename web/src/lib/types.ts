export type ProductCategory = 'fresh' | 'craft' | 'digital' | 'home' | 'fashion' | 'service';

export type WeekendVerificationLevel = '已承诺' | '材料核验' | '员工确认' | '持续核验' | '争议中' | '已撤销';

export type Product = {
  id: string;
  storeId: string;
  title: string;
  category: ProductCategory;
  price: number;
  originalPrice?: number;
  stock: number;
  rating: number;
  sold: number;
  image: string;
  images?: string[];
  tags: string[];
  description: string;
  specs: Record<string, string>;
};

export type Store = {
  id: string;
  name: string;
  owner: string;
  uniqueChainId: string;
  avatar: string;
  banner: string;
  reputation: number;
  followers: number;
  liveId?: string;
  status: 'verified' | 'pending' | 'restricted';
  joinedAt: string;
  laborPolicy?: string;
  noOvertimePledge?: boolean;
  verificationLevel?: WeekendVerificationLevel | string;
  verificationSummary?: string;
};

export type LedgerEvent = {
  id: string;
  storeId: string;
  type: 'review' | 'complaint' | 'governance_downvote' | 'governance_removed' | 'store_verified';
  title: string;
  detail: string;
  scoreDelta?: number;
  txHash: string;
  blockHeight: number;
  createdAt: string;
};

export type Review = {
  id: string;
  productId: string;
  storeId: string;
  user: string;
  rating: number;
  content: string;
  createdAt: string;
  txHash: string;
};

export type CartItem = {
  productId: string;
  quantity: number;
};

export type Order = {
  id: string;
  buyerKey?: string;
  status: '待付款' | '待发货' | '运输中' | '已完成' | '申诉中';
  items: CartItem[];
  total: number;
  createdAt: string;
};

export type LiveRoom = {
  id: string;
  storeId: string;
  title: string;
  cover: string;
  status: 'live' | 'scheduled' | 'ended';
  startedAt?: string;
  scheduledAt?: string;
  viewers: number;
  signalingChannel: string;
  hostPeerId: string;
};

export type CategoryInfo = {
  id: ProductCategory;
  label: string;
  accent: string;
};

export type MarketplacePayload = {
  categories: CategoryInfo[];
  products: Product[];
  stores: Store[];
  ledgerEvents: LedgerEvent[];
  reviews: Review[];
  orders: Order[];
  liveRooms: LiveRoom[];
};

export type ApiHealth = {
  online: boolean;
  apiBase: string;
  mode: 'remote' | 'mock';
  message: string;
};

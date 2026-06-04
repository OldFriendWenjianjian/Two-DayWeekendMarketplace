import {
  Bell,
  Boxes,
  Camera,
  ChevronLeft,
  CheckCircle,
  CircleUserRound,
  CloudUpload,
  ClipboardList,
  Flag,
  Home,
  ListFilter,
  PackagePlus,
  Palette,
  Radio,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Store as StoreIcon,
  ThumbsDown,
  Trash2,
  UploadCloud,
  UserPlus,
  Wand2,
  Wifi,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LedgerTimeline } from './components/LedgerTimeline';
import { LiveFeed } from './components/LiveFeed';
import { LivePanel } from './components/LivePanel';
import { ProductCard } from './components/ProductCard';
import { apiPresets, getApiBase, loadMarketplace, postMarketplaceAction, resetApiBase, setApiBase } from './lib/api';
import { evaluateConsensusAction, formatGovernanceWeight, type ConsensusActor } from './lib/consensus';
import { getProductCover, getProductImages, isRasterImageSource, visualBackgroundStyle } from './lib/images';
import { mockData } from './lib/mockData';
import {
  createPendingProductUpload,
  loadPendingProductUploads,
  mergePendingProductUploads,
  savePendingProductUploads,
  type PendingProductUpload,
  type ProductUploadPayload,
} from './lib/pendingUploads';
import { cartTotal, filterProducts, formatCurrency, getProduct, getStore, storeProducts } from './lib/selectors';
import type { ApiHealth, CartItem, MarketplacePayload, ProductCategory } from './lib/types';

type Tab = 'home' | 'category' | 'live' | 'cart' | 'seller' | 'profile';
type Screen = 'main' | 'product' | 'store' | 'orders' | 'complaints' | 'settings' | 'listing';
type CoverTone = 'clean' | 'warm' | 'fresh';

const tabItems: Array<{ id: Tab; label: string; icon: typeof Home }> = [
  { id: 'home', label: '发现', icon: Home },
  { id: 'category', label: '分类', icon: Boxes },
  { id: 'live', label: '直播', icon: Radio },
  { id: 'cart', label: '购物车', icon: ShoppingCart },
  { id: 'seller', label: '卖家', icon: StoreIcon },
  { id: 'profile', label: '我的', icon: CircleUserRound },
];

const createSellerId = () => `weekend-shop-${Date.now().toString(36).slice(-5)}`;

const maxListingImages = 6;
const serverIpv6Address = '2402:4e00:c013:8600:5602:3dc2:a2d0:0';
const coverBackgrounds = ['#2f8f83', '#4f7fcf', '#d5684e', '#b5527e', '#4e8f9b', '#6b8f3a'];
const coverAccents = ['#f8d36b', '#ffffff', '#ffd6c8', '#bce6dc', '#d8e8ff', '#f4d0df'];
const coverTones: Array<{ id: CoverTone; label: string }> = [
  { id: 'clean', label: '清爽' },
  { id: 'warm', label: '温暖' },
  { id: 'fresh', label: '鲜明' },
];

const currentUserKey = 'android-buyer-demo';

function withPendingProducts(payload: MarketplacePayload, uploads: PendingProductUpload[]): MarketplacePayload {
  return {
    ...payload,
    products: mergePendingProductUploads(payload.products, uploads),
  };
}

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });

const loadImage = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片解析失败'));
    image.src = source;
  });

async function compressImageFile(file: File) {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件');
  }
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);
  const maxSide = 1180;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持图片压缩');
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
) {
  const chars = Array.from(text);
  let line = '';
  let lineCount = 0;
  for (const char of chars) {
    const testLine = line + char;
    if (context.measureText(testLine).width > maxWidth && line) {
      context.fillText(line, x, y + lineCount * lineHeight);
      line = char;
      lineCount += 1;
      if (lineCount >= maxLines) return;
    } else {
      line = testLine;
    }
  }
  if (line && lineCount < maxLines) {
    context.fillText(line, x, y + lineCount * lineHeight);
  }
}

function App() {
  const [data, setData] = useState<MarketplacePayload>(mockData);
  const [health, setHealth] = useState<ApiHealth>({
    online: false,
    apiBase: getApiBase(),
    mode: 'mock',
    message: '正在连接后端',
  });
  const [lastConnectivityCheck, setLastConnectivityCheck] = useState('');
  const [pendingUploads, setPendingUploads] = useState<PendingProductUpload[]>(() =>
    loadPendingProductUploads(window.localStorage)
  );
  const [pendingUploadStorageError, setPendingUploadStorageError] = useState('');
  const [isRetryingUploads, setIsRetryingUploads] = useState(false);
  const lastAutoRetryKeyRef = useRef('');
  const [tab, setTab] = useState<Tab>('home');
  const [screen, setScreen] = useState<Screen>('main');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ProductCategory | 'all'>('all');
  const [selectedProductId, setSelectedProductId] = useState('p-001');
  const [selectedStoreId, setSelectedStoreId] = useState('store-green-001');
  const [selectedLiveRoomId, setSelectedLiveRoomId] = useState('');
  const [cart, setCart] = useState<CartItem[]>([
    { productId: 'p-001', quantity: 1 },
    { productId: 'p-003', quantity: 1 },
  ]);
  const [toast, setToast] = useState('');
  const [apiBaseInput, setApiBaseInput] = useState(getApiBase());
  const [downVotes, setDownVotes] = useState<Record<string, number>>({ 'p-006': 31 });
  const [selectedDetailImage, setSelectedDetailImage] = useState(0);
  const [sellerDraft, setSellerDraft] = useState({
    sellerId: createSellerId(),
    brandName: '新的双休店铺',
    ownerContact: 'wechat:new-weekend-shop',
    category: '手作好物 / 本地服务',
    noOvertimePledge: true,
  });
  const [productDraft, setProductDraft] = useState({
    sellerId: '',
    title: '双休限定新品',
    price: '68',
    category: 'craft' as ProductCategory,
    contact: 'wechat:new-weekend-shop',
    description: '普通商品信息通过业务 API 保存，不写入区块链账本。',
    images: [] as string[],
  });
  const [coverDraft, setCoverDraft] = useState({
    title: '双休限定新品',
    subtitle: '只上架双休不加班公司的产品',
    badge: '双休不加班',
    background: coverBackgrounds[0],
    accent: coverAccents[0],
    tone: 'clean' as CoverTone,
  });

  useEffect(() => {
    refreshMarketplace();
  }, []);

  useEffect(() => {
    const result = savePendingProductUploads(window.localStorage, pendingUploads);
    setPendingUploadStorageError(result.ok ? '' : result.message);
    setData((current) => withPendingProducts(current, pendingUploads));
  }, [pendingUploads]);

  const refreshMarketplace = async () => {
    const result = await loadMarketplace();
    setData(withPendingProducts(result.data, pendingUploads));
    setHealth(result.health);
    setApiBaseInput(result.health.apiBase);
    setLastConnectivityCheck(new Date().toISOString());
  };

  const products = useMemo(
    () => filterProducts(data.products, query, category),
    [category, data.products, query]
  );
  const selectedProduct = getProduct(data, selectedProductId) || data.products[0];
  const selectedStore = getStore(data, selectedStoreId) || data.stores[0];
  const total = cartTotal(cart, data);
  const selectedProductCompletedOrderId = useMemo(
    () =>
      data.orders.find((order) =>
        order.status === '已完成' && order.items.some((item) => item.productId === selectedProduct.id)
      )?.id,
    [data.orders, selectedProduct.id]
  );
  const currentActor: ConsensusActor = useMemo(() => {
    const completedOrderIds = data.orders
      .filter((order) => order.status === '已完成')
      .map((order) => order.id);

    return {
      id: currentUserKey,
      completedOrderIds,
      reputationStake: 0,
      witnessEndorsements: 0,
      maliciousActionCount: 0,
    };
  }, [data.orders]);
  const profileConsensus = useMemo(
    () => evaluateConsensusAction(currentActor, {
      type: 'removal_vote',
      orderId: currentActor.completedOrderIds[0],
    }),
    [currentActor]
  );
  const productConsensus = useMemo(
    () => evaluateConsensusAction(currentActor, { type: 'removal_vote', orderId: selectedProductCompletedOrderId }),
    [currentActor, selectedProductCompletedOrderId]
  );
  const complaintConsensus = useMemo(
    () => evaluateConsensusAction(currentActor, { type: 'staked_complaint', orderId: selectedProductCompletedOrderId }),
    [currentActor, selectedProductCompletedOrderId]
  );

  const notify = (value: string) => {
    setToast(value);
    window.setTimeout(() => setToast(''), 2200);
  };

  const openProduct = (id: string) => {
    const product = getProduct(data, id);
    setSelectedProductId(id);
    if (product) setSelectedStoreId(product.storeId);
    setSelectedDetailImage(0);
    setScreen('product');
  };

  const openStore = (id: string) => {
    setSelectedStoreId(id);
    setScreen('store');
  };

  const openLiveRoom = (roomId: string) => {
    setSelectedLiveRoomId(roomId);
    setTab('live');
    setScreen('main');
  };

  const addToCart = (productId: string) => {
    setCart((items) => {
      const existing = items.find((item) => item.productId === productId);
      if (existing) {
        return items.map((item) =>
          item.productId === productId ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...items, { productId, quantity: 1 }];
    });
    notify('已加入购物车');
  };

  const voteDown = async (productId: string) => {
    const evaluation = productId === selectedProduct.id
      ? productConsensus
      : evaluateConsensusAction(currentActor, { type: 'removal_vote' });
    const result = await postMarketplaceAction(`/products/${productId}/reports`, {
      reporterKey: currentUserKey,
      reason: evaluation.canAffectCoreReputation
        ? '用户基于双锚共识发起治理下架'
        : '用户提交 0 权重普通反馈',
      consensus: {
        version: evaluation.version,
        governanceWeight: evaluation.governanceWeight,
        hasTradeAnchor: evaluation.hasTradeAnchor,
        hasResponsibilityAnchor: evaluation.hasResponsibilityAnchor,
        ledgerImpact: evaluation.ledgerImpact,
      },
    });
    if (!result.ok) {
      notify(result.message);
      return;
    }
    if (evaluation.governanceWeight > 0) {
      setDownVotes((votes) => ({ ...votes, [productId]: (votes[productId] || 0) + evaluation.governanceWeight }));
    }
    notify(
      evaluation.governanceWeight > 0
        ? `共识权重 ${formatGovernanceWeight(evaluation.governanceWeight)} 已进入治理队列`
        : '已记录普通反馈：无交易/押注锚，不影响核心信誉'
    );
    if (result.mode === 'remote') refreshMarketplace();
  };

  const submitComplaint = async () => {
    const result = await postMarketplaceAction(`/sellers/${selectedStore.id}/complaints`, {
      complainantKey: currentUserKey,
      productId: selectedProduct?.id,
      reason: complaintConsensus.canAffectCoreReputation
        ? '商品描述与履约争议，按双锚共识进入治理'
        : '商品描述与履约争议，先作为普通反馈留痕',
      consensus: {
        version: complaintConsensus.version,
        governanceWeight: complaintConsensus.governanceWeight,
        hasTradeAnchor: complaintConsensus.hasTradeAnchor,
        hasResponsibilityAnchor: complaintConsensus.hasResponsibilityAnchor,
        ledgerImpact: complaintConsensus.ledgerImpact,
      },
    });
    if (!result.ok) {
      notify(result.message);
      return;
    }
    notify(
      complaintConsensus.governanceWeight > 0
        ? '投诉已带共识锚进入治理账本'
        : '投诉已作为普通反馈留痕'
    );
    if (result.mode === 'remote') refreshMarketplace();
  };

  const checkout = async () => {
    const firstItem = cart[0];
    if (!firstItem) {
      notify('购物车为空');
      return;
    }
    const result = await postMarketplaceAction('/orders', {
      productId: firstItem.productId,
      buyerContact: 'wechat:android-buyer-demo',
      buyerMessage: '请卖家联系我确认交易。',
    });
    if (!result.ok) {
      notify(result.message);
      return;
    }
    notify(result.mode === 'mock' ? '演示订单已创建' : '订单联系记录已创建');
    if (result.mode === 'remote') refreshMarketplace();
  };

  const submitSellerApplication = async () => {
    const sellerId = sellerDraft.sellerId.trim().toLowerCase();
    if (!sellerDraft.noOvertimePledge) {
      notify('请先确认双休不加班承诺');
      return;
    }
    const result = await postMarketplaceAction('/sellers/apply', {
      sellerId,
      brandName: sellerDraft.brandName.trim(),
      ownerContact: sellerDraft.ownerContact.trim(),
      profile: {
        category: sellerDraft.category.trim(),
        laborPolicy: '双休不加班',
        noOvertimePledge: true,
        source: 'android-webview',
      },
    });
    if (!result.ok) {
      notify(result.message);
      return;
    }
    setSelectedStoreId(sellerId);
    setProductDraft((draft) => ({
      ...draft,
      sellerId,
      contact: draft.contact || sellerDraft.ownerContact,
    }));
    notify(result.mode === 'mock' ? '演示模式：入驻申请已记录' : '双休承诺与店家 ID 已写入账本');
    if (result.mode === 'remote') refreshMarketplace();
  };

  const handleProductImageFiles = async (files: FileList | null) => {
    const capacity = maxListingImages - productDraft.images.length;
    const selectedFiles = Array.from(files || []).slice(0, Math.max(0, capacity));
    if (selectedFiles.length === 0) {
      notify(`最多可添加 ${maxListingImages} 张商品图片`);
      return;
    }
    notify('正在压缩商品图片');
    try {
      const images = await Promise.all(selectedFiles.map(compressImageFile));
      setProductDraft((draft) => ({
        ...draft,
        images: [...draft.images, ...images].slice(0, maxListingImages),
      }));
      notify(`已添加 ${images.length} 张图片`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '图片处理失败');
    }
  };

  const promoteProductImage = (index: number) => {
    if (index <= 0) return;
    setProductDraft((draft) => {
      const images = [...draft.images];
      const [cover] = images.splice(index, 1);
      return { ...draft, images: cover ? [cover, ...images] : images };
    });
  };

  const removeProductImage = (index: number) => {
    setProductDraft((draft) => ({
      ...draft,
      images: draft.images.filter((_, imageIndex) => imageIndex !== index),
    }));
  };

  const generateDesignedCover = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 900;
    const context = canvas.getContext('2d');
    if (!context) {
      notify('当前浏览器不支持封面生成');
      return;
    }

    const toneEnd: Record<CoverTone, string> = {
      clean: '#f7fbf8',
      warm: '#fff0dc',
      fresh: '#d8e8ff',
    };
    const title = coverDraft.title.trim() || productDraft.title.trim() || '双休商品';
    const subtitle = coverDraft.subtitle.trim() || '只上架双休不加班公司的产品';
    const sellerId = (productDraft.sellerId || selectedStore?.id || 'weekend-shop').trim();
    const fontFamily = '"Microsoft YaHei", "PingFang SC", sans-serif';
    const gradient = context.createLinearGradient(0, 0, 1200, 900);
    gradient.addColorStop(0, coverDraft.background);
    gradient.addColorStop(1, toneEnd[coverDraft.tone]);
    context.fillStyle = gradient;
    context.fillRect(0, 0, 1200, 900);

    context.globalAlpha = 0.22;
    context.fillStyle = coverDraft.accent;
    context.beginPath();
    context.moveTo(760, 0);
    context.lineTo(1200, 0);
    context.lineTo(1200, 900);
    context.lineTo(940, 900);
    context.closePath();
    context.fill();
    context.globalAlpha = 1;

    context.fillStyle = 'rgba(255, 255, 255, 0.88)';
    drawRoundedRect(context, 72, 72, 324, 74, 28);
    context.fill();
    context.fillStyle = '#1f352f';
    context.font = `900 34px ${fontFamily}`;
    context.fillText('双休超市', 108, 121);

    context.fillStyle = '#ffffff';
    context.shadowColor = 'rgba(31, 53, 47, 0.28)';
    context.shadowBlur = 18;
    context.shadowOffsetY = 8;
    context.font = `900 86px ${fontFamily}`;
    drawWrappedText(context, title, 72, 340, 960, 104, 2);
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;

    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.font = `800 38px ${fontFamily}`;
    drawWrappedText(context, subtitle, 76, 570, 880, 50, 2);

    context.fillStyle = 'rgba(255, 255, 255, 0.92)';
    drawRoundedRect(context, 72, 700, 1056, 112, 26);
    context.fill();
    context.fillStyle = '#1f352f';
    context.font = `900 34px ${fontFamily}`;
    context.fillText(coverDraft.badge.trim() || '双休不加班', 112, 766);
    context.fillStyle = '#557069';
    context.font = `700 24px ${fontFamily}`;
    context.fillText(`店家 ID: ${sellerId}`, 416, 766);

    const image = canvas.toDataURL('image/jpeg', 0.86);
    setProductDraft((draft) => ({
      ...draft,
      images: [image, ...draft.images].slice(0, maxListingImages),
    }));
    notify('封面已生成并设为主图');
  };

  const submitProductListing = async () => {
    const sellerId = (productDraft.sellerId || selectedStore?.id || data.stores[0]?.id || '').trim();
    const price = Number(productDraft.price);
    const title = productDraft.title.trim();
    const contact = productDraft.contact.trim();
    if (!sellerId) {
      notify('请先填写店家 ID');
      return;
    }
    if (!title) {
      notify('请填写商品标题');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      notify('价格格式不正确');
      return;
    }
    if (!contact) {
      notify('请填写买卖联系信息');
      return;
    }
    if (productDraft.images.length === 0) {
      notify('请先上传图片或生成商品封面');
      return;
    }
    const payload: ProductUploadPayload = {
      sellerId,
      title,
      description: productDraft.description.trim(),
      category: productDraft.category,
      priceCents: Math.round(price * 100),
      currency: 'CNY',
      contact,
      images: productDraft.images,
    };
    const result = await postMarketplaceAction('/products', payload);
    if (!result.ok) {
      notify(result.message);
      return;
    }
    notify(result.mode === 'mock' ? '服务器未确认，已保存到待上传队列' : '商品已上架，仅展示双休不加班公司的产品');
    if (result.mode === 'remote') {
      await refreshMarketplace();
      const createdId =
        result.data && typeof result.data === 'object' && 'productId' in result.data
          ? String((result.data as { productId?: unknown }).productId || '')
          : '';
      if (createdId) {
        setSelectedProductId(createdId);
        setSelectedDetailImage(0);
        setScreen('product');
      }
      return;
    }
    const pendingUpload = createPendingProductUpload(payload);
    setPendingUploads((uploads) => [pendingUpload, ...uploads]);
    setSelectedProductId(pendingUpload.localProductId);
    setSelectedDetailImage(0);
    setScreen('product');
  };

  const retryPendingUploads = async (targetId?: string) => {
    if (isRetryingUploads) return;
    const targets = pendingUploads.filter((upload) => !targetId || upload.id === targetId);
    if (targets.length === 0) {
      notify('没有待上传商品');
      return;
    }

    setIsRetryingUploads(true);
    setPendingUploads((uploads) =>
      uploads.map((upload) =>
        targets.some((target) => target.id === upload.id)
          ? { ...upload, status: 'syncing', error: undefined, lastAttemptAt: new Date().toISOString() }
          : upload
      )
    );

    let uploaded = 0;
    let failed = 0;
    for (const upload of targets) {
      const result = await postMarketplaceAction('/products', upload.payload);
      if (result.ok && result.mode === 'remote') {
        uploaded += 1;
        setPendingUploads((uploads) => uploads.filter((item) => item.id !== upload.id));
      } else {
        failed += 1;
        const message =
          result.mode === 'mock' ? 'IPv6 服务器仍未确认，保留待上传' : result.message || '服务器拒绝上传';
        setPendingUploads((uploads) =>
          uploads.map((item) =>
            item.id === upload.id
              ? { ...item, status: 'failed', error: message, lastAttemptAt: new Date().toISOString() }
              : item
          )
        );
      }
    }

    setIsRetryingUploads(false);
    if (uploaded > 0) {
      await refreshMarketplace();
    }
    notify(
      uploaded > 0 && failed === 0
        ? `已上传 ${uploaded} 件待同步商品`
        : `上传完成：成功 ${uploaded} 件，待处理 ${failed} 件`
    );
  };

  useEffect(() => {
    if (health.mode !== 'remote' || pendingUploads.length === 0 || isRetryingUploads) return;
    const autoRetryKey = pendingUploads.map((upload) => `${upload.id}:${upload.status}`).join('|');
    if (lastAutoRetryKeyRef.current === autoRetryKey) return;
    lastAutoRetryKeyRef.current = autoRetryKey;
    void retryPendingUploads();
  }, [health.mode, pendingUploads.length]);

  const saveApiBase = async (base: string) => {
    setApiBase(base);
    const result = await loadMarketplace();
    setData(withPendingProducts(result.data, pendingUploads));
    setHealth(result.health);
    setApiBaseInput(result.health.apiBase);
    setLastConnectivityCheck(new Date().toISOString());
    notify('API 基路径已更新');
  };

  const resetApi = async () => {
    resetApiBase();
    const result = await loadMarketplace();
    setData(withPendingProducts(result.data, pendingUploads));
    setHealth(result.health);
    setApiBaseInput(result.health.apiBase);
    setLastConnectivityCheck(new Date().toISOString());
    notify('已恢复默认 API');
  };

  const goMain = (targetTab?: Tab) => {
    if (targetTab) setTab(targetTab);
    setScreen('main');
  };

  const renderMain = () => {
    if (tab === 'home') {
      return (
        <>
          <section className="hero-strip">
            <div>
              <span className="eyebrow">只上架双休不加班公司的产品</span>
              <h1>双休超市</h1>
              <p>支持好产品，也支持做出好产品的人按时下班。店家唯一 ID、评价投诉与治理下架记录进入不可篡改账本。</p>
            </div>
            <button className="round-action" onClick={() => setScreen('settings')} aria-label="设置">
              <Settings size={20} />
            </button>
          </section>
          <SearchBar />
          <ServerStatusPanel />
          <section className="policy-banner">
            <strong>上架原则</strong>
            <span>本超市只展示承诺双休、不强制加班公司的产品；不符合理念的商品可投诉，并按双锚共识进入治理。</span>
          </section>
          <section className="quick-grid">
            <button onClick={() => goMain('category')}>
              <ListFilter size={19} /> 分类找货
            </button>
            <button onClick={() => setScreen('orders')}>
              <ClipboardList size={19} /> 订单
            </button>
            <button onClick={() => setScreen('listing')}>
              <PackagePlus size={19} /> 上架
            </button>
            <button onClick={() => setScreen('complaints')}>
              <Flag size={19} /> 投诉
            </button>
          </section>
          <LivePanel rooms={data.liveRooms} stores={data.stores} onChanged={refreshMarketplace} onOpenRoom={openLiveRoom} />
          <ProductSection title="发现好物" products={products} />
        </>
      );
    }

    if (tab === 'category') {
      return (
        <>
          <SearchBar />
          <section className="category-grid">
            <button className={category === 'all' ? 'active' : ''} onClick={() => setCategory('all')}>
              全部
            </button>
            {data.categories.map((item) => (
              <button
                className={category === item.id ? 'active' : ''}
                key={item.id}
                style={{ '--accent': item.accent } as React.CSSProperties}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </section>
          <ProductSection title="商品列表" products={products} />
        </>
      );
    }

    if (tab === 'live') {
      return (
        <LiveFeed
          rooms={data.liveRooms}
          stores={data.stores}
          products={data.products}
          initialRoomId={selectedLiveRoomId}
          onOpenStore={openStore}
          onOpenProduct={openProduct}
        />
      );
    }

    if (tab === 'cart') {
      return <CartView />;
    }

    if (tab === 'seller') {
      return <SellerView />;
    }

    return <ProfileView />;
  };

  const SearchBar = () => (
    <label className="search-bar">
      <Search size={18} />
      <input
        value={query}
        placeholder="搜索商品、标签、店铺"
        onChange={(event) => setQuery(event.target.value)}
      />
    </label>
  );

  const ServerStatusPanel = () => {
    const checkedAt = lastConnectivityCheck
      ? new Date(lastConnectivityCheck).toLocaleTimeString('zh-CN', { hour12: false })
      : '未检查';

    return (
      <section className={`server-status server-status--${health.mode}`}>
        <div className="server-status__main">
          <span className={`dot dot--${health.mode}`} />
          <Wifi size={16} />
          <div>
            <strong>{health.mode === 'remote' ? 'IPv6 服务器已连通' : 'IPv6 服务器未确认'}</strong>
            <small>{serverIpv6Address}</small>
          </div>
        </div>
        <div className="server-status__meta">
          <span>{health.message}</span>
          <span>上次检查 {checkedAt}</span>
          {pendingUploads.length > 0 && <span>{pendingUploads.length} 件商品待上传</span>}
        </div>
        <div className="server-status__actions">
          <button className="soft-button" onClick={refreshMarketplace}>
            <RefreshCw size={15} /> 检查
          </button>
          {pendingUploads.length > 0 && (
            <button className="primary-button" onClick={() => retryPendingUploads()} disabled={isRetryingUploads}>
              <CloudUpload size={15} /> {isRetryingUploads ? '上传中' : '重传商品'}
            </button>
          )}
        </div>
      </section>
    );
  };

  const PendingUploadBanner = () => {
    if (pendingUploads.length === 0 && !pendingUploadStorageError) return null;

    return (
      <section className="pending-upload-banner">
        <div className="pending-upload-banner__head">
          <CloudUpload size={17} />
          <strong>{pendingUploads.length > 0 ? '商品等待上传服务器' : '待上传状态异常'}</strong>
          {pendingUploads.length > 0 && <span>{pendingUploads.length} 件</span>}
        </div>
        {pendingUploadStorageError && <p>本地持久保存失败：{pendingUploadStorageError}</p>}
        {pendingUploads.length > 0 && (
          <>
            <p>这些商品已经保存在本机队列里，网络恢复后可自动或手动重新上传。</p>
            <div className="pending-upload-list">
              {pendingUploads.slice(0, 3).map((upload) => (
                <article key={upload.id}>
                  <div>
                    <strong>{upload.payload.title}</strong>
                    <span>{upload.error || (upload.status === 'syncing' ? '正在上传' : '等待服务器确认')}</span>
                  </div>
                  <button
                    className="soft-button"
                    disabled={isRetryingUploads || upload.status === 'syncing'}
                    onClick={() => retryPendingUploads(upload.id)}
                  >
                    <RefreshCw size={14} /> 重传
                  </button>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    );
  };

  const ProductSection = ({ title, products: listed }: { title: string; products: typeof data.products }) => (
    <section className="panel">
      <div className="section-title">
        <span>{title}</span>
        <small>{listed.length} 件</small>
      </div>
      <div className="product-grid">
        {listed.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            store={getStore(data, product.storeId)}
            onOpen={openProduct}
            onAdd={addToCart}
          />
        ))}
      </div>
    </section>
  );

  const CartView = () => (
    <section className="panel full-panel">
      <div className="section-title">
        <span>购物车</span>
        <small>{cart.length} 类商品</small>
      </div>
      <div className="cart-list">
        {cart.map((item) => {
          const product = getProduct(data, item.productId);
          if (!product) return null;
          const thumb = getProductCover(product);
          const hasThumb = isRasterImageSource(thumb);
          return (
            <article className="cart-row" key={item.productId}>
              <div
                className={`cart-row__thumb${hasThumb ? ' cart-row__thumb--photo' : ''}`}
                style={visualBackgroundStyle(thumb)}
              >
                {hasThumb && <img src={thumb} alt={product.title} />}
              </div>
              <div>
                <strong>{product.title}</strong>
                <span>{formatCurrency(product.price)}</span>
              </div>
              <div className="stepper">
                <button onClick={() => setCart((items) => items.map((row) => row.productId === item.productId ? { ...row, quantity: Math.max(1, row.quantity - 1) } : row))}>-</button>
                <span>{item.quantity}</span>
                <button onClick={() => addToCart(item.productId)}>+</button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="checkout-bar">
        <div>
          <span>合计</span>
          <strong>{formatCurrency(total)}</strong>
        </div>
        <button className="primary-button" onClick={checkout}>去结算</button>
      </div>
    </section>
  );

  const SellerView = () => (
    <>
      <section className="panel seller-panel">
        <div className="section-title">
          <span>卖家入驻</span>
          <button className="soft-button" onClick={submitSellerApplication}>
            <UserPlus size={16} /> 申请
          </button>
        </div>
        <div className="seller-form">
          <input
            placeholder="店家 ID（全局唯一，不可删除）"
            value={sellerDraft.sellerId}
            onChange={(event) => setSellerDraft((draft) => ({ ...draft, sellerId: event.target.value }))}
          />
          <input
            placeholder="店铺名称"
            value={sellerDraft.brandName}
            onChange={(event) => setSellerDraft((draft) => ({ ...draft, brandName: event.target.value }))}
          />
          <input
            placeholder="经营者联系方式"
            value={sellerDraft.ownerContact}
            onChange={(event) => setSellerDraft((draft) => ({ ...draft, ownerContact: event.target.value }))}
          />
          <input
            placeholder="主营类目"
            value={sellerDraft.category}
            onChange={(event) => setSellerDraft((draft) => ({ ...draft, category: event.target.value }))}
          />
          <label className="policy-check">
            <input
              type="checkbox"
              checked={sellerDraft.noOvertimePledge}
              onChange={(event) =>
                setSellerDraft((draft) => ({ ...draft, noOvertimePledge: event.target.checked }))
              }
            />
            <span>我承诺本店所属公司双休、不强制加班，才申请入驻双休超市。</span>
          </label>
          <p>店家 ID 登记后全局唯一、不可重复、不可删除；双休不加班承诺与信誉治理事件进入账本。</p>
        </div>
      </section>
      <section className="panel seller-action-panel">
        <div className="section-title">
          <span>商品上架</span>
          <button className="soft-button" onClick={() => setScreen('listing')}>
            <PackagePlus size={16} /> 去上架
          </button>
        </div>
        <p className="chain-note">上架商品有独立页面，可上传多张图片、生成双休理念封面，并预览详情页效果。普通商品资料不进入账本。</p>
      </section>
      <section className="store-list">
        {data.stores.map((store) => (
          <button className="store-row" key={store.id} onClick={() => openStore(store.id)}>
            <span className="avatar">{store.avatar}</span>
            <span>
              <strong>{store.name}</strong>
              <small>{store.uniqueChainId} · 信誉 {store.reputation}</small>
            </span>
          </button>
        ))}
      </section>
    </>
  );

  const renderListing = () => {
    const previewCover =
      productDraft.images[0] || `linear-gradient(135deg, ${coverDraft.background}, ${coverDraft.accent})`;
    const previewHasPhoto = isRasterImageSource(previewCover);
    const categoryLabel =
      data.categories.find((item) => item.id === productDraft.category)?.label || productDraft.category;

    return (
      <section className="listing-page">
        <HeaderBack title="上架商品" />
        <section className="panel">
          <div className="section-title">
            <span>商品资料</span>
            <small>普通信息不上链</small>
          </div>
          <div className="field-grid">
            <label>
              <span>店家 ID</span>
              <input
                placeholder="店家 ID"
                value={productDraft.sellerId || selectedStore?.id || ''}
                onChange={(event) => setProductDraft((draft) => ({ ...draft, sellerId: event.target.value }))}
              />
            </label>
            <label>
              <span>商品标题</span>
              <input
                placeholder="例如：双休限定手作礼盒"
                value={productDraft.title}
                onChange={(event) => {
                  const title = event.target.value;
                  setProductDraft((draft) => ({ ...draft, title }));
                  setCoverDraft((draft) => ({ ...draft, title: draft.title === productDraft.title ? title : draft.title }));
                }}
              />
            </label>
            <div className="two-column-fields">
              <label>
                <span>价格</span>
                <input
                  placeholder="价格"
                  value={productDraft.price}
                  inputMode="decimal"
                  onChange={(event) => setProductDraft((draft) => ({ ...draft, price: event.target.value }))}
                />
              </label>
              <label>
                <span>类目</span>
                <select
                  value={productDraft.category}
                  onChange={(event) =>
                    setProductDraft((draft) => ({ ...draft, category: event.target.value as ProductCategory }))
                  }
                >
                  {data.categories.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>买卖联系信息</span>
              <input
                placeholder="微信、电话、邮箱或站内说明"
                value={productDraft.contact}
                onChange={(event) => setProductDraft((draft) => ({ ...draft, contact: event.target.value }))}
              />
            </label>
            <label>
              <span>商品详情</span>
              <textarea
                placeholder="介绍规格、发货方式、售后和双休不加班承诺"
                value={productDraft.description}
                onChange={(event) => setProductDraft((draft) => ({ ...draft, description: event.target.value }))}
              />
            </label>
          </div>
        </section>

        <section className="panel image-tool-panel">
          <div className="section-title">
            <span>商品图片</span>
            <small>{productDraft.images.length}/{maxListingImages}</small>
          </div>
          <div className="upload-actions">
            <label className="upload-tile">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => {
                  handleProductImageFiles(event.currentTarget.files);
                  event.currentTarget.value = '';
                }}
              />
              <UploadCloud size={24} />
              <span>选择图片</span>
              <small>支持多图，自动压缩后保存。</small>
            </label>
            <label className="upload-tile">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(event) => {
                  handleProductImageFiles(event.currentTarget.files);
                  event.currentTarget.value = '';
                }}
              />
              <Camera size={24} />
              <span>拍照上传</span>
              <small>使用时再申请摄像头权限。</small>
            </label>
          </div>
          {productDraft.images.length > 0 && (
            <div className="image-strip">
              {productDraft.images.map((image, index) => (
                <div className="image-thumb" key={`${image.slice(0, 28)}-${index}`}>
                  <img src={image} alt={`商品图片 ${index + 1}`} />
                  {index === 0 && <span className="image-thumb__badge">封面</span>}
                  <div className="image-thumb__actions">
                    <button
                      className={index === 0 ? 'active' : ''}
                      onClick={() => promoteProductImage(index)}
                      aria-label={index === 0 ? '当前封面' : '设为封面'}
                    >
                      <CheckCircle size={15} />
                    </button>
                    <button onClick={() => removeProductImage(index)} aria-label="删除图片">
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel cover-designer">
          <div className="section-title">
            <span>封面设计</span>
            <Palette size={18} />
          </div>
          <div
            className={`cover-preview cover-preview--${coverDraft.tone}`}
            style={
              {
                '--cover-bg': coverDraft.background,
                '--cover-accent': coverDraft.accent,
              } as React.CSSProperties
            }
          >
            <span>双休超市</span>
            <strong>{coverDraft.title || productDraft.title}</strong>
            <small>{coverDraft.subtitle}</small>
          </div>
          <div className="field-grid">
            <label>
              <span>封面标题</span>
              <input
                value={coverDraft.title}
                onChange={(event) => setCoverDraft((draft) => ({ ...draft, title: event.target.value }))}
              />
            </label>
            <label>
              <span>封面副标题</span>
              <input
                value={coverDraft.subtitle}
                onChange={(event) => setCoverDraft((draft) => ({ ...draft, subtitle: event.target.value }))}
              />
            </label>
            <label>
              <span>角标文案</span>
              <input
                value={coverDraft.badge}
                onChange={(event) => setCoverDraft((draft) => ({ ...draft, badge: event.target.value }))}
              />
            </label>
          </div>
          <div className="designer-control">
            <span>背景色</span>
            <div className="swatch-row">
              {coverBackgrounds.map((color) => (
                <button
                  className={coverDraft.background === color ? 'active' : ''}
                  key={color}
                  style={{ background: color }}
                  onClick={() => setCoverDraft((draft) => ({ ...draft, background: color }))}
                  title={`背景色 ${color}`}
                  aria-label={`背景色 ${color}`}
                />
              ))}
            </div>
          </div>
          <div className="designer-control">
            <span>强调色</span>
            <div className="swatch-row">
              {coverAccents.map((color) => (
                <button
                  className={coverDraft.accent === color ? 'active' : ''}
                  key={color}
                  style={{ background: color }}
                  onClick={() => setCoverDraft((draft) => ({ ...draft, accent: color }))}
                  title={`强调色 ${color}`}
                  aria-label={`强调色 ${color}`}
                />
              ))}
            </div>
          </div>
          <div className="segmented-control" aria-label="封面风格">
            {coverTones.map((tone) => (
              <button
                className={coverDraft.tone === tone.id ? 'active' : ''}
                key={tone.id}
                onClick={() => setCoverDraft((draft) => ({ ...draft, tone: tone.id }))}
              >
                {tone.label}
              </button>
            ))}
          </div>
          <button className="primary-button" onClick={generateDesignedCover}>
            <Wand2 size={17} /> 生成封面
          </button>
        </section>

        <section className="panel">
          <div className="section-title">
            <span>上架预览</span>
            <small>{categoryLabel}</small>
          </div>
          <article className="listing-preview-card">
            <div
              className={`listing-preview-card__image${previewHasPhoto ? ' listing-preview-card__image--photo' : ''}`}
              style={visualBackgroundStyle(previewCover)}
            >
              {previewHasPhoto ? <img src={previewCover} alt="商品封面预览" /> : <span>{productDraft.title.slice(0, 2)}</span>}
            </div>
            <div>
              <span className="eyebrow">双休不加班公司产品</span>
              <strong>{productDraft.title || '商品标题'}</strong>
              <small>{formatCurrency(Number(productDraft.price) || 0)} · {productDraft.contact || '待填写联系信息'}</small>
              <p>{productDraft.description || '补充商品描述后，买家会在详情页看到完整说明。'}</p>
            </div>
          </article>
        </section>

        <div className="bottom-action listing-submit">
          <span>{productDraft.images.length > 0 ? `${productDraft.images.length} 张图片` : '待添加图片'}</span>
          <button className="primary-button" onClick={submitProductListing}>
            <PackagePlus size={17} /> 提交上架
          </button>
        </div>
      </section>
    );
  };

  const ProfileView = () => (
    <>
      <section className="profile-head">
        <div className="avatar avatar--large">我</div>
        <div>
          <h2>双休买家</h2>
          <span>Android WebView / PWA 用户</span>
        </div>
        <button className="round-action" onClick={() => setScreen('settings')} aria-label="设置">
          <Settings size={20} />
        </button>
      </section>
      <section className="quick-grid">
        <button onClick={() => setScreen('orders')}>
          <ClipboardList size={19} /> 我的订单
        </button>
        <button onClick={() => setScreen('complaints')}>
          <Flag size={19} /> 评价投诉
        </button>
        <button onClick={() => goMain('seller')}>
          <StoreIcon size={19} /> 我的店铺
        </button>
        <button onClick={() => setScreen('settings')}>
          <Settings size={19} /> API 设置
        </button>
      </section>
      <section className="panel consensus-panel">
        <div className="section-title">
          <span>我的共识权</span>
          <ShieldCheck size={18} />
        </div>
        <div className="consensus-score">
          <span>当前可用权重</span>
          <strong>{formatGovernanceWeight(profileConsensus.governanceWeight)}</strong>
        </div>
        <p>账号数量和账号年龄不产生治理权；只有真实交易锚或责任押注锚，才会影响核心信誉。</p>
        <div className="anchor-grid">
          <span>
            <strong>{currentActor.completedOrderIds.length}</strong>
            已完成订单锚
          </span>
          <span>
            <strong>{currentActor.reputationStake}</strong>
            责任押注额度
          </span>
          <span>
            <strong>{currentActor.witnessEndorsements}</strong>
            见证背书
          </span>
        </div>
        <small>评价别人，也会写入自己的履历；恶意投诉会降低后续共识权。</small>
      </section>
      <section className="panel">
        <div className="section-title">
          <span>全站治理账本</span>
          <ShieldCheck size={18} />
        </div>
        <LedgerTimeline events={data.ledgerEvents} compact />
      </section>
    </>
  );

  const renderProduct = () => {
    const productImages = getProductImages(selectedProduct);
    const detailCover = productImages[selectedDetailImage] || getProductCover(selectedProduct);
    const detailHasPhoto = isRasterImageSource(detailCover);

    return (
    <article className="detail">
      <div
        className={`detail__media${detailHasPhoto ? ' detail__media--photo' : ''}`}
        style={visualBackgroundStyle(detailCover)}
      >
        {detailHasPhoto && <img src={detailCover} alt={selectedProduct.title} />}
        <button className="back-button" onClick={() => setScreen('main')} aria-label="返回">
          <ChevronLeft size={22} />
        </button>
        <span className="detail__media-title">{selectedProduct.title}</span>
      </div>
      {productImages.length > 1 && (
        <div className="detail-gallery">
          {productImages.map((image, index) => (
            <button
              className={selectedDetailImage === index ? 'active' : ''}
              key={`${image.slice(0, 28)}-${index}`}
              onClick={() => setSelectedDetailImage(index)}
              aria-label={`查看第 ${index + 1} 张商品图`}
            >
              <img src={image} alt="" />
            </button>
          ))}
        </div>
      )}
      <section className="detail__body">
        <div className="detail__price">{formatCurrency(selectedProduct.price)}</div>
        <h2>{selectedProduct.title}</h2>
        <button className="store-link" onClick={() => openStore(selectedProduct.storeId)}>
          <span className="avatar">{getStore(data, selectedProduct.storeId)?.avatar}</span>
          {getStore(data, selectedProduct.storeId)?.name}
        </button>
        <div className="tag-row">
          {selectedProduct.tags.map((tag) => (
            <span className="tag" key={tag}>{tag}</span>
          ))}
        </div>
        <p>{selectedProduct.description}</p>
        <div className="spec-grid">
          {Object.entries(selectedProduct.specs).map(([key, value]) => (
            <span key={key}><strong>{key}</strong>{value}</span>
          ))}
        </div>
        <section className="governance-box">
          <div className="governance-box__head">
            <strong>双锚治理</strong>
            <span>权重 {formatGovernanceWeight(productConsensus.governanceWeight)}</span>
          </div>
          <span>空号、号龄和批量注册不算票；只有真实交易锚或责任押注锚，才会影响商户核心信誉。</span>
          <div className="anchor-grid anchor-grid--compact">
            <span className={productConsensus.hasTradeAnchor ? 'active' : ''}>
              <strong>{productConsensus.hasTradeAnchor ? '已成立' : '未成立'}</strong>
              真实交易锚
            </span>
            <span className={productConsensus.hasResponsibilityAnchor ? 'active' : ''}>
              <strong>{productConsensus.hasResponsibilityAnchor ? '已成立' : '未成立'}</strong>
              责任押注锚
            </span>
          </div>
          <small>{productConsensus.reason}</small>
          <button
            className={productConsensus.governanceWeight > 0 ? 'danger-button' : 'soft-button'}
            onClick={() => voteDown(selectedProduct.id)}
          >
            <ThumbsDown size={16} />
            {productConsensus.governanceWeight > 0
              ? `共识下架（${formatGovernanceWeight(downVotes[selectedProduct.id] || 0)}）`
              : '提交反馈（权重 0）'}
          </button>
        </section>
        <section>
          <div className="section-title">
            <span>评价</span>
            <button className="soft-button" onClick={submitComplaint}><Flag size={16} /> 投诉</button>
          </div>
          {data.reviews.filter((review) => review.productId === selectedProduct.id).map((review) => (
            <article className="review" key={review.id}>
              <strong>{review.user} · {review.rating} 分</strong>
              <p>{review.content}</p>
              <code>{review.txHash}</code>
            </article>
          ))}
        </section>
      </section>
      <div className="bottom-action">
        <button className="soft-button" onClick={() => openStore(selectedProduct.storeId)}>进店</button>
        <button className="primary-button" onClick={() => addToCart(selectedProduct.id)}>加入购物车</button>
      </div>
    </article>
    );
  };

  const renderStore = () => (
    <>
      <section className="store-hero" style={{ background: selectedStore.banner }}>
        <button className="back-button" onClick={() => setScreen('main')} aria-label="返回">
          <ChevronLeft size={22} />
        </button>
        <div className="avatar avatar--large">{selectedStore.avatar}</div>
        <h2>{selectedStore.name}</h2>
        <span>{selectedStore.uniqueChainId}</span>
      </section>
      <section className="panel">
        <div className="store-stats">
          <span><strong>{selectedStore.reputation}</strong>信誉</span>
          <span><strong>{selectedStore.followers}</strong>关注</span>
          <span><strong>{selectedStore.status}</strong>状态</span>
        </div>
        <p className="chain-note">店家 ID 是账本身份锚点；双休不加班承诺、投诉、评价、治理下架等信誉事件不可篡改展示。</p>
      </section>
      <LivePanel
        rooms={data.liveRooms}
        stores={data.stores}
        selectedStoreId={selectedStore.id}
        onChanged={refreshMarketplace}
        onOpenRoom={openLiveRoom}
      />
      <ProductSection title="店铺商品" products={storeProducts(data, selectedStore)} />
      <section className="panel">
        <div className="section-title"><span>店铺账本</span><ShieldCheck size={18} /></div>
        <LedgerTimeline events={data.ledgerEvents.filter((event) => event.storeId === selectedStore.id)} />
      </section>
    </>
  );

  const renderOrders = () => (
    <section className="panel full-panel">
      <HeaderBack title="订单" />
      {data.orders.map((order) => (
        <article className="order-card" key={order.id}>
          <div className="section-title">
            <span>{order.id}</span>
            <small>{order.status}</small>
          </div>
          {order.items.map((item) => {
            const product = getProduct(data, item.productId);
            return <p key={item.productId}>{product?.title} x {item.quantity}</p>;
          })}
          <strong>{formatCurrency(order.total)}</strong>
          <span>{order.createdAt}</span>
        </article>
      ))}
    </section>
  );

  const renderComplaints = () => (
    <section className="panel full-panel">
      <HeaderBack title="评价 / 投诉" />
      <div className="seller-form">
        <input value={selectedStore.name} readOnly />
        <textarea defaultValue="描述争议、证据或建议。没有交易锚或责任押注锚时，只作为普通反馈留痕。" />
        <button className="primary-button" onClick={submitComplaint}><Flag size={16} /> 提交投诉</button>
      </div>
      <LedgerTimeline events={data.ledgerEvents.filter((event) => event.type === 'complaint' || event.type === 'review')} />
    </section>
  );

  const renderSettings = () => (
    <section className="panel full-panel">
      <HeaderBack title="API 设置" />
      <ServerStatusPanel />
      <div className="api-box">
        <label>
          <span>当前 API 基路径</span>
          <textarea value={apiBaseInput} onChange={(event) => setApiBaseInput(event.target.value)} />
        </label>
        <button className="primary-button" onClick={() => saveApiBase(apiBaseInput)}>保存并重连</button>
        <button className="soft-button" onClick={() => saveApiBase(apiPresets.local)}>使用本地 8787</button>
        <button className="soft-button" onClick={resetApi}>恢复默认 IPv6</button>
        <p>{health.message}</p>
      </div>
    </section>
  );

  const HeaderBack = ({ title }: { title: string }) => (
    <div className="page-head">
      <button className="round-action" onClick={() => setScreen('main')} aria-label="返回">
        <ChevronLeft size={21} />
      </button>
      <strong>{title}</strong>
      <span />
    </div>
  );

  return (
    <div className="app-shell">
      <main className={screen === 'main' ? 'app-main app-main--tabs' : 'app-main'}>
        <PendingUploadBanner />
        {screen === 'main' && renderMain()}
        {screen === 'product' && renderProduct()}
        {screen === 'store' && renderStore()}
        {screen === 'orders' && renderOrders()}
        {screen === 'complaints' && renderComplaints()}
        {screen === 'settings' && renderSettings()}
        {screen === 'listing' && renderListing()}
      </main>
      {screen === 'main' && (
        <nav
          className="bottom-nav"
          aria-label="主导航"
          style={{ '--nav-count': tabItems.length } as React.CSSProperties}
        >
          {tabItems.map((item) => {
            const Icon = item.icon;
            return (
              <button className={tab === item.id ? 'active' : ''} key={item.id} onClick={() => setTab(item.id)}>
                <Icon size={20} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      )}
      {toast && (
        <div className="toast">
          <Bell size={16} /> {toast}
        </div>
      )}
    </div>
  );
}

export default App;

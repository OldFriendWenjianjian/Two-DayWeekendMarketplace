import { ChevronDown, ChevronUp, Radio, Store as StoreIcon, Volume2, VolumeX, Wifi } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supportsWebRtc } from '../lib/api';
import { P2PViewerSession, type LiveEngineStatus } from '../lib/p2pLive';
import { getProductCover, isRasterImageSource, visualBackgroundStyle } from '../lib/images';
import type { LiveRoom, Product, Store } from '../lib/types';

type LiveFeedProps = {
  rooms: LiveRoom[];
  stores: Store[];
  products: Product[];
  initialRoomId?: string;
  onOpenStore: (storeId: string) => void;
  onOpenProduct: (productId: string) => void;
};

export function LiveFeed({ rooms, stores, products, initialRoomId, onOpenStore, onOpenProduct }: LiveFeedProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewerStatus, setViewerStatus] = useState<LiveEngineStatus>('idle');
  const [viewerMessage, setViewerMessage] = useState('上下切换直播间，当前直播会自动尝试 P2P 直连。');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(true);
  const sessionRef = useRef<P2PViewerSession | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const liveRooms = useMemo(() => rooms.filter((room) => room.status === 'live'), [rooms]);
  const activeRoom = liveRooms[activeIndex];

  const activeStore = useMemo(
    () => stores.find((store) => store.id === activeRoom?.storeId),
    [activeRoom?.storeId, stores]
  );
  const storeProducts = useMemo(
    () => products.filter((product) => product.storeId === activeRoom?.storeId).slice(0, 3),
    [activeRoom?.storeId, products]
  );

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = remoteStream;
      videoRef.current.muted = muted;
    }
  }, [remoteStream, muted]);

  useEffect(() => {
    if (!initialRoomId) return;
    const index = liveRooms.findIndex((room) => room.id === initialRoomId);
    if (index >= 0) setActiveIndex(index);
  }, [initialRoomId, liveRooms]);

  useEffect(() => {
    if (activeIndex >= liveRooms.length) {
      setActiveIndex(Math.max(0, liveRooms.length - 1));
    }
  }, [activeIndex, liveRooms.length]);

  useEffect(() => {
    sessionRef.current?.close();
    sessionRef.current = null;
    setRemoteStream(null);

    if (!activeRoom) {
      setViewerStatus('idle');
      setViewerMessage('当前没有商户开播。');
      return;
    }
    if (!supportsWebRtc()) {
      setViewerStatus('failed');
      setViewerMessage('当前 WebView/浏览器不支持 WebRTC，无法观看 P2P 直播。');
      return;
    }

    const session = new P2PViewerSession(activeRoom, {
      onUpdate: (update) => {
        setViewerStatus(update.status);
        setViewerMessage(update.message);
        if ('stream' in update) {
          setRemoteStream(update.stream || null);
        }
      },
    });
    sessionRef.current = session;
    void session.start();

    return () => {
      session.close();
    };
  }, [activeRoom?.id]);

  const goTo = (nextIndex: number) => {
    if (liveRooms.length === 0) return;
    const wrapped = (nextIndex + liveRooms.length) % liveRooms.length;
    setActiveIndex(wrapped);
  };

  if (liveRooms.length === 0) {
    return (
      <section className="live-feed live-feed--empty">
        <Radio size={32} />
        <strong>暂时没有商户开播</strong>
        <span>商户点击“打开摄像头开播”后，会出现在这里。</span>
      </section>
    );
  }

  const coverStyle = visualBackgroundStyle(activeRoom.cover);
  const isConnected = viewerStatus === 'live';

  return (
    <section className="live-feed">
      <div className="live-feed__stage" style={coverStyle}>
        {remoteStream ? (
          <video ref={videoRef} autoPlay playsInline muted={muted} />
        ) : (
          <div className="live-feed__placeholder">
            <Radio size={34} />
            <strong>{isConnected ? '正在接入画面' : 'P2P 直连中'}</strong>
          </div>
        )}
        <div className="live-feed__shade" />
        <div className="live-feed__top">
          <span className={`live-feed__badge live-feed__badge--${viewerStatus}`}>
            <Wifi size={13} /> {isConnected ? 'P2P 已连接' : 'P2P 连接中'}
          </span>
          <span>{activeIndex + 1}/{liveRooms.length}</span>
        </div>
        <div className="live-feed__body">
          <span>{activeStore?.name || '未知店铺'}</span>
          <h2>{activeRoom.title}</h2>
          <p>{viewerMessage}</p>
          <div className="live-feed__actions">
            <button onClick={() => activeStore && onOpenStore(activeStore.id)}>
              <StoreIcon size={16} /> 进店
            </button>
            <button onClick={() => setMuted((value) => !value)}>
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />} {muted ? '开声音' : '静音'}
            </button>
          </div>
          {storeProducts.length > 0 && (
            <div className="live-feed__products">
              {storeProducts.map((product) => {
                const cover = getProductCover(product);
                const hasPhoto = isRasterImageSource(cover);
                return (
                  <button key={product.id} onClick={() => onOpenProduct(product.id)}>
                    <span style={visualBackgroundStyle(cover)}>
                      {hasPhoto ? <img src={cover} alt="" /> : product.title.slice(0, 1)}
                    </span>
                    <strong>{product.title}</strong>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="live-feed__switcher">
          <button onClick={() => goTo(activeIndex - 1)} aria-label="上一场直播">
            <ChevronUp size={21} />
          </button>
          <button onClick={() => goTo(activeIndex + 1)} aria-label="下一场直播">
            <ChevronDown size={21} />
          </button>
        </div>
      </div>
    </section>
  );
}

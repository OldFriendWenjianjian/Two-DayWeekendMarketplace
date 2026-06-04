import { Radio, Send, Users, Video } from 'lucide-react';
import { useState } from 'react';
import { createViewerOffer, postMarketplaceAction, supportsWebRtc } from '../lib/api';
import type { LiveRoom, Store } from '../lib/types';

type LivePanelProps = {
  rooms: LiveRoom[];
  stores: Store[];
  selectedStoreId?: string;
  onChanged?: () => void;
};

export function LivePanel({ rooms, stores, selectedStoreId, onChanged }: LivePanelProps) {
  const [offer, setOffer] = useState('');
  const [message, setMessage] = useState('');
  const [roomStatus, setRoomStatus] = useState('未登记');
  const visibleRooms = selectedStoreId ? rooms.filter((room) => room.storeId === selectedStoreId) : rooms;

  const joinRoom = async (room: LiveRoom) => {
    const result = await createViewerOffer(room.id);
    setOffer(result.offer);
    setMessage(result.message);
  };

  const registerLive = async () => {
    const sellerId = selectedStoreId || stores[0]?.id;
    if (!sellerId) {
      setRoomStatus('没有可登记的店家');
      return;
    }
    const result = await postMarketplaceAction(
      `/live/sessions/${sellerId}`,
      {
        roomId: `room-${sellerId}`,
        endpoint: {
          mode: 'webrtc-direct',
          relay: false,
          discoveredBy: 'android-webview',
        },
        candidates: [],
        metadata: {
          title: '手机端商户开播登记',
          viewers: 1,
        },
      },
      'PUT'
    );
    setRoomStatus(result.message);
    if (result.mode === 'remote') onChanged?.();
  };

  return (
    <section className="panel">
      <div className="section-title">
        <span>直播广场</span>
        <button className="soft-button" onClick={registerLive}>
          <Radio size={16} /> 登记开播
        </button>
      </div>
      <div className="live-note">
        <Video size={16} />
        <span>
          观众使用 WebRTC 直接连接商户主播；服务器只承载房间登记与信令，不转发音视频流。
        </span>
      </div>
      <div className="live-grid">
        {visibleRooms.map((room) => {
          const store = stores.find((item) => item.id === room.storeId);
          return (
            <article className="live-card" key={room.id}>
              <div className="live-card__cover" style={{ background: room.cover }}>
                <span className={`live-pill live-pill--${room.status}`}>{room.status === 'live' ? '直播中' : '预约'}</span>
              </div>
              <div className="live-card__body">
                <strong>{room.title}</strong>
                <span>{store?.name}</span>
                <span className="live-card__viewers">
                  <Users size={14} /> {room.viewers} 人
                </span>
                <button className="primary-button" onClick={() => joinRoom(room)}>
                  <Send size={16} /> 生成信令
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="signal-box">
        <strong>{supportsWebRtc() ? 'WebRTC 可用' : 'WebRTC 不可用'}</strong>
        <span>{message || roomStatus}</span>
        {offer && <textarea value={offer} readOnly aria-label="SDP Offer" />}
      </div>
    </section>
  );
}

import { Radio, Send, Users, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  postMarketplaceAction,
  startHostCapture,
  supportsMediaCapture,
  supportsWebRtc,
} from '../lib/api';
import { P2PHostSession } from '../lib/p2pLive';
import type { LiveRoom, Store } from '../lib/types';

type LivePanelProps = {
  rooms: LiveRoom[];
  stores: Store[];
  selectedStoreId?: string;
  onChanged?: () => void;
  onOpenRoom?: (roomId: string) => void;
};

export function LivePanel({ rooms, stores, selectedStoreId, onChanged, onOpenRoom }: LivePanelProps) {
  const [offer, setOffer] = useState('');
  const [message, setMessage] = useState('');
  const [roomStatus, setRoomStatus] = useState('未登记');
  const [hostStream, setHostStream] = useState<MediaStream | null>(null);
  const [hostPreviewMessage, setHostPreviewMessage] = useState('');
  const [connectedViewers, setConnectedViewers] = useState(0);
  const hostSessionRef = useRef<P2PHostSession | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const visibleRooms = selectedStoreId ? rooms.filter((room) => room.storeId === selectedStoreId) : rooms;

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = hostStream;
    }
  }, [hostStream]);

  useEffect(
    () => () => {
      hostSessionRef.current?.close();
      hostStream?.getTracks().forEach((track) => track.stop());
    },
    [hostStream]
  );

  const joinRoom = async (room: LiveRoom) => {
    setOffer('');
    if (room.status !== 'live') {
      setMessage(`${room.title} 还没有开播，暂时不能 P2P 观看。`);
      return;
    }
    onOpenRoom?.(room.id);
    setMessage(`${room.title} 已进入直播流。`);
  };

  const registerLive = async () => {
    const sellerId = selectedStoreId || stores[0]?.id;
    if (!sellerId) {
      setRoomStatus('没有可登记的店家');
      return;
    }
    setOffer('');
    setMessage('');
    setRoomStatus('正在打开摄像头与麦克风');
    let stream = hostStream;
    try {
      if (!stream) {
        stream = await startHostCapture();
        setHostStream(stream);
      }
      setHostPreviewMessage('摄像头已打开，正在登记直播房间');
    } catch (error) {
      setRoomStatus(error instanceof Error ? error.message : '摄像头打开失败');
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
    setHostPreviewMessage(result.mode === 'mock' ? '本地预览已开启，后端不可用时仅做演示登记' : '商户摄像头预览已开启，直播房间已登记');
    if (result.mode === 'remote') {
      const room: LiveRoom = {
        id: `room-${sellerId}`,
        storeId: sellerId,
        title: '手机端商户开播登记',
        cover: 'linear-gradient(135deg, #2f8f83, #4f7fcf)',
        status: 'live',
        startedAt: new Date().toISOString(),
        viewers: 1,
        signalingChannel: `/api/signaling/rooms/room-${sellerId}`,
        hostPeerId: `merchant-${sellerId}`,
      };
      hostSessionRef.current?.close();
      hostSessionRef.current = new P2PHostSession(room, stream, {
        onUpdate: (update) => {
          setHostPreviewMessage(update.message);
          if (typeof update.viewerCount === 'number') setConnectedViewers(update.viewerCount);
        },
      });
      hostSessionRef.current.start();
      onChanged?.();
    }
  };

  const stopHostCapture = () => {
    hostSessionRef.current?.close();
    hostSessionRef.current = null;
    hostStream?.getTracks().forEach((track) => track.stop());
    setHostStream(null);
    setConnectedViewers(0);
    setHostPreviewMessage('摄像头已关闭');
  };

  return (
    <section className="panel">
      <div className="section-title">
        <span>直播广场</span>
        <button className="soft-button" onClick={registerLive}>
          <Radio size={16} /> 打开摄像头开播
        </button>
      </div>
      <div className="live-note">
        <Video size={16} />
        <span>
          商户点击开播时才申请摄像头/麦克风权限；服务器只承载房间登记与信令，不转发音视频流。
        </span>
      </div>
      {(hostStream || hostPreviewMessage) && (
        <div className="host-preview">
          <div className="host-preview__video">
            {hostStream ? (
              <video ref={videoRef} autoPlay muted playsInline />
            ) : (
              <span>摄像头未开启</span>
            )}
          </div>
          <div className="host-preview__body">
            <strong>{hostStream ? '商户直播预览中' : '商户直播预览'}</strong>
            <span>{hostPreviewMessage || '点击开播后会在这里显示本机摄像头画面。'}</span>
            {hostStream && <span>{connectedViewers} 位观众 P2P 直连</span>}
            {hostStream && (
              <button className="soft-button" onClick={stopHostCapture}>
                关闭摄像头
              </button>
            )}
          </div>
        </div>
      )}
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
                  <Send size={16} /> {room.status === 'live' ? '去直播流观看' : '查看预约'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="signal-box">
        <strong>{supportsWebRtc() ? 'WebRTC 可用' : 'WebRTC 不可用'} · {supportsMediaCapture() ? '摄像头 API 可用' : '摄像头 API 不可用'}</strong>
        <span>{message || roomStatus}</span>
        {offer && <textarea value={offer} readOnly aria-label="SDP Offer" />}
      </div>
    </section>
  );
}

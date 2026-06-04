import { fetchSignalMessages, postSignalMessage, type SignalMessage } from './api';
import type { LiveRoom } from './types';

const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
const pollMs = 1200;
const staleMs = 45000;

export type LiveEngineStatus = 'idle' | 'connecting' | 'live' | 'failed' | 'closed';

export type LiveEngineUpdate = {
  status: LiveEngineStatus;
  message: string;
  viewerCount?: number;
  stream?: MediaStream | null;
};

type HostConnection = {
  peer: RTCPeerConnection;
  lastSeen: number;
};

type LiveEngineOptions = {
  onUpdate?: (update: LiveEngineUpdate) => void;
};

export class P2PHostSession {
  private readonly room: LiveRoom;
  private readonly stream: MediaStream;
  private readonly options: LiveEngineOptions;
  private readonly peerId: string;
  private readonly connections = new Map<string, HostConnection>();
  private seenMessages = new Set<string>();
  private pollTimer: number | undefined;
  private lastSignalTime = '';
  private closed = false;

  constructor(room: LiveRoom, stream: MediaStream, options: LiveEngineOptions = {}) {
    this.room = room;
    this.stream = stream;
    this.options = options;
    this.peerId = room.hostPeerId;
  }

  start() {
    this.closed = false;
    this.emit('live', '主播端已开播，等待观众连接', this.connections.size);
    void this.poll();
  }

  close() {
    this.closed = true;
    if (this.pollTimer) window.clearTimeout(this.pollTimer);
    this.connections.forEach(({ peer }) => peer.close());
    this.connections.clear();
    this.emit('closed', '直播连接已关闭', 0);
  }

  private async poll() {
    if (this.closed) return;
    const result = await fetchSignalMessages(this.room.id, this.peerId, this.lastSignalTime || undefined);
    if (result.mode === 'remote') {
      for (const message of result.messages) {
        this.lastSignalTime = maxIsoTime(this.lastSignalTime, message.createdAt);
        if (this.seenMessages.has(message.messageId)) continue;
        this.seenMessages.add(message.messageId);
        await this.handleMessage(message);
      }
      this.pruneStaleConnections();
    }
    this.pollTimer = window.setTimeout(() => void this.poll(), pollMs);
  }

  private async handleMessage(message: SignalMessage) {
    if (message.fromPeer === this.peerId) return;
    if (message.type === 'viewer-offer') {
      await this.answerViewerOffer(message);
      return;
    }
    if (message.type === 'viewer-ice') {
      const connection = this.connections.get(message.fromPeer);
      const candidate = message.payload.candidate;
      if (connection && candidate) {
        await connection.peer.addIceCandidate(candidate as RTCIceCandidateInit).catch(() => undefined);
        connection.lastSeen = Date.now();
      }
      return;
    }
    if (message.type === 'viewer-leave') {
      this.removeConnection(message.fromPeer);
    }
  }

  private async answerViewerOffer(message: SignalMessage) {
    const offer = message.payload.offer as RTCSessionDescriptionInit | undefined;
    if (!offer) return;
    this.removeConnection(message.fromPeer);

    const peer = new RTCPeerConnection({ iceServers });
    this.stream.getTracks().forEach((track) => peer.addTrack(track, this.stream));
    this.connections.set(message.fromPeer, { peer, lastSeen: Date.now() });

    peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      void postSignalMessage(this.room.id, {
        fromPeer: this.peerId,
        toPeer: message.fromPeer,
        type: 'host-ice',
        payload: { candidate: event.candidate.toJSON() },
      });
    };
    peer.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
        this.removeConnection(message.fromPeer);
      } else {
        this.emit('live', `观众连接状态：${peer.connectionState}`, this.connections.size);
      }
    };

    await peer.setRemoteDescription(offer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await postSignalMessage(this.room.id, {
      fromPeer: this.peerId,
      toPeer: message.fromPeer,
      type: 'host-answer',
      payload: { answer: peer.localDescription?.toJSON() || answer },
    });
    this.emit('live', `已有 ${this.connections.size} 位观众直连`, this.connections.size);
  }

  private removeConnection(viewerPeerId: string) {
    const connection = this.connections.get(viewerPeerId);
    if (connection) {
      connection.peer.close();
      this.connections.delete(viewerPeerId);
      this.emit('live', `已有 ${this.connections.size} 位观众直连`, this.connections.size);
    }
  }

  private pruneStaleConnections() {
    const now = Date.now();
    for (const [viewerPeerId, connection] of this.connections) {
      if (now - connection.lastSeen > staleMs && connection.peer.connectionState === 'disconnected') {
        this.removeConnection(viewerPeerId);
      }
    }
  }

  private emit(status: LiveEngineStatus, message: string, viewerCount?: number) {
    this.options.onUpdate?.({ status, message, viewerCount });
  }
}

export class P2PViewerSession {
  private readonly room: LiveRoom;
  private readonly options: LiveEngineOptions;
  private readonly peerId: string;
  private readonly peer: RTCPeerConnection;
  private readonly remoteStream = new MediaStream();
  private seenMessages = new Set<string>();
  private pollTimer: number | undefined;
  private lastSignalTime = '';
  private closed = false;

  constructor(room: LiveRoom, options: LiveEngineOptions = {}) {
    this.room = room;
    this.options = options;
    this.peerId = `viewer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.peer = new RTCPeerConnection({ iceServers });
  }

  async start() {
    this.closed = false;
    this.emit('connecting', '正在向商户主播发起 P2P 连接', this.remoteStream);
    this.peer.addTransceiver('video', { direction: 'recvonly' });
    this.peer.addTransceiver('audio', { direction: 'recvonly' });
    this.peer.ontrack = (event) => {
      event.streams[0]?.getTracks().forEach((track) => this.remoteStream.addTrack(track));
      this.emit('live', '已接入商户直播', this.remoteStream);
    };
    this.peer.onicecandidate = (event) => {
      if (!event.candidate) return;
      void postSignalMessage(this.room.id, {
        fromPeer: this.peerId,
        toPeer: this.room.hostPeerId,
        type: 'viewer-ice',
        payload: { candidate: event.candidate.toJSON() },
      });
    };
    this.peer.onconnectionstatechange = () => {
      const state = this.peer.connectionState;
      if (state === 'connected') {
        this.emit('live', '已建立 P2P 直连', this.remoteStream);
      } else if (['failed', 'disconnected'].includes(state)) {
        this.emit('failed', `P2P 连接${state === 'failed' ? '失败' : '断开'}`, this.remoteStream);
      }
    };

    const offer = await this.peer.createOffer();
    await this.peer.setLocalDescription(offer);
    await postSignalMessage(this.room.id, {
      fromPeer: this.peerId,
      toPeer: this.room.hostPeerId,
      type: 'viewer-offer',
      payload: { offer: this.peer.localDescription?.toJSON() || offer },
    });
    void this.poll();
  }

  close() {
    this.closed = true;
    if (this.pollTimer) window.clearTimeout(this.pollTimer);
    void postSignalMessage(this.room.id, {
      fromPeer: this.peerId,
      toPeer: this.room.hostPeerId,
      type: 'viewer-leave',
      payload: {},
    });
    this.peer.close();
    this.emit('closed', '已退出直播', null);
  }

  private async poll() {
    if (this.closed) return;
    const result = await fetchSignalMessages(this.room.id, this.peerId, this.lastSignalTime || undefined);
    if (result.mode === 'remote') {
      for (const message of result.messages) {
        this.lastSignalTime = maxIsoTime(this.lastSignalTime, message.createdAt);
        if (this.seenMessages.has(message.messageId) || message.fromPeer === this.peerId) continue;
        this.seenMessages.add(message.messageId);
        await this.handleMessage(message);
      }
    } else {
      this.emit('failed', '信令服务器未连接，暂时无法观看直播', this.remoteStream);
    }
    this.pollTimer = window.setTimeout(() => void this.poll(), pollMs);
  }

  private async handleMessage(message: SignalMessage) {
    if (message.type === 'host-answer') {
      const answer = message.payload.answer as RTCSessionDescriptionInit | undefined;
      if (answer && this.peer.signalingState !== 'stable') {
        await this.peer.setRemoteDescription(answer).catch(() => undefined);
      }
      return;
    }
    if (message.type === 'host-ice') {
      const candidate = message.payload.candidate;
      if (candidate) {
        await this.peer.addIceCandidate(candidate as RTCIceCandidateInit).catch(() => undefined);
      }
    }
  }

  private emit(status: LiveEngineStatus, message: string, stream: MediaStream | null) {
    this.options.onUpdate?.({ status, message, stream });
  }
}

function maxIsoTime(current: string, next: string) {
  if (!current) return next;
  return next > current ? next : current;
}

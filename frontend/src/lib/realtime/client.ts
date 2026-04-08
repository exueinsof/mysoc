import { useEffect, useRef, useState } from 'react';

import type { RealtimeMessage, RealtimeStatus, RealtimeTopic } from '../api/types';

type MessageListener = (message: RealtimeMessage) => void;
type StatusListener = (status: RealtimeStatus) => void;

const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_RECONNECT_DELAY_MS = 15_000;
const MAX_RECONNECT_ATTEMPTS = 6;
const MAX_REALTIME_MESSAGE_CHARS = 512 * 1024;
const ALLOWED_REALTIME_TOPICS: RealtimeTopic[] = ['dashboard', 'logs', 'timeline', 'map', 'graph', 'alerts'];

function logRealtimeError(message: string, error?: unknown): void {
  if (import.meta.env.DEV) {
    console.error(message, error);
  }
}

function normalizeRealtimeTopics(topics: string[]): RealtimeTopic[] {
  return topics.filter((topic): topic is RealtimeTopic => ALLOWED_REALTIME_TOPICS.some((allowedTopic) => allowedTopic === topic));
}

class RealtimeClient {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectAttempt = 0;
  private topics = new Set<RealtimeTopic>(['dashboard']);
  private messageListeners = new Set<MessageListener>();
  private statusListeners = new Set<StatusListener>();
  private currentStatus: RealtimeStatus = 'offline';

  get status(): RealtimeStatus {
    return this.currentStatus;
  }

  connect(topics: RealtimeTopic[] = ['dashboard']): void {
    topics.forEach((topic) => this.topics.add(topic));

    const readyState = this.socket?.readyState;
    if (this.socket && (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING)) {
      if (readyState === WebSocket.OPEN) {
        this.send({ type: 'subscribe', topics: Array.from(this.topics) });
      }
      return;
    }

    this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    const socket = new WebSocket(this.buildUrl());
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }
      this.reconnectAttempt = 0;
      this.setStatus('live');
      this.send({ type: 'subscribe', topics: Array.from(this.topics) });
      this.startHeartbeat();
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string' || event.data.length > MAX_REALTIME_MESSAGE_CHARS) {
        logRealtimeError('Realtime payload too large or invalid type');
        return;
      }

      try {
        const payload = JSON.parse(event.data) as RealtimeMessage;
        this.messageListeners.forEach((listener) => listener(payload));
      } catch (error) {
        logRealtimeError('Invalid realtime payload', error);
      }
    });

    socket.addEventListener('close', () => {
      if (this.socket !== socket) {
        return;
      }
      this.stopHeartbeat();
      this.socket = null;
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.socket?.close();
    this.socket = null;
    this.setStatus('offline');
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.currentStatus);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private buildUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/live`;
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(payload));
  }

  private setStatus(status: RealtimeStatus): void {
    this.currentStatus = status;
    this.statusListeners.forEach((listener) => listener(status));
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      if (this.reconnectTimer) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.setStatus('offline');
      return;
    }

    this.setStatus(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
    }
    const waitMs = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = window.setTimeout(() => this.connect(), waitMs);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      this.send({ type: 'ping' });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

export const realtimeClient = new RealtimeClient();

export function useRealtime(topics: RealtimeTopic[], onMessage?: (message: RealtimeMessage) => void): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>(realtimeClient.status);
  const onMessageRef = useRef(onMessage);
  const topicKey = topics.join('|');

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const nextTopics: RealtimeTopic[] = topicKey ? normalizeRealtimeTopics(topicKey.split('|')) : ['dashboard'];
    realtimeClient.connect(nextTopics);
    const unsubscribeStatus = realtimeClient.onStatus(setStatus);
    const unsubscribeMessage = realtimeClient.onMessage((message) => onMessageRef.current?.(message));

    return () => {
      unsubscribeStatus();
      unsubscribeMessage();
    };
  }, [topicKey]);

  return status;
}

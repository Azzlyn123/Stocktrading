import { useEffect, useRef, useState, useCallback } from "react";

interface WSMessage {
  type: string;
  data: any;
}

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const listenersRef = useRef<Map<string, Set<(data: any) => void>>>(new Map());
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      setIsConnected(true);
      fetch("/api/user", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((u) => {
          if (u?.id && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "identify", data: { userId: u.id } }));
          }
        })
        .catch(() => {});
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        setLastMessage(msg);
        const handlers = listenersRef.current.get(msg.type);
        if (handlers) {
          handlers.forEach((handler) => handler(msg.data));
        }
      } catch (e) {}
    };

    ws.onclose = () => {
      setIsConnected(false);
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  const subscribe = useCallback(
    (type: string, handler: (data: any) => void) => {
      if (!listenersRef.current.has(type)) {
        listenersRef.current.set(type, new Set());
      }
      listenersRef.current.get(type)!.add(handler);
      return () => {
        listenersRef.current.get(type)?.delete(handler);
      };
    },
    []
  );

  const send = useCallback((type: string, data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data }));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { isConnected, lastMessage, subscribe, send };
}

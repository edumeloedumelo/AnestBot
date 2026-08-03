"use client";

/** Cliente da API do Hospital OS. Sessão em sessionStorage (token JWT de 15 min). */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export type Session = { token: string; tenantId: string; fullName: string; roles: string[] };

const SESSION_KEY = "hospital-os.session";

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export function setSession(session: Session | null): void {
  if (session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown
  ) {
    super(`API ${status}`);
  }
}

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.auth !== false) {
    const session = getSession();
    if (session) headers.Authorization = `Bearer ${session.token}`;
  }
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && options.auth !== false) {
      setSession(null);
      window.location.href = "/login";
    }
    throw new ApiError(response.status, body);
  }
  return body as T;
}

/** Conexão de tempo real; onMessage recebe {topic, payload}. Retorna cleanup. */
export function connectEvents(onMessage: (event: { topic: string; payload: Record<string, unknown> }) => void, onState?: (open: boolean) => void): () => void {
  const session = getSession();
  if (!session) return () => undefined;
  const url = `${API_URL.replace(/^http/, "ws")}/events?token=${encodeURIComponent(session.token)}`;
  const socket = new WebSocket(url);
  socket.onopen = () => onState?.(true);
  socket.onclose = () => onState?.(false);
  socket.onmessage = (message) => {
    try {
      onMessage(JSON.parse(message.data as string));
    } catch {
      // mensagem malformada é ignorada
    }
  };
  return () => socket.close();
}

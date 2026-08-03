import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Server as HttpServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { EventBroadcaster } from "./events.service";

/**
 * Gateway WebSocket do mapa em tempo real (F2-E2).
 * Conexão em /events?token=<JWT>; token inválido fecha a conexão.
 * Cada socket entra no grupo do SEU tenant — eventos de outros tenants
 * nunca são entregues (o filtro de tenant acontece aqui, na borda).
 */
@Injectable()
export class EventsGateway implements EventBroadcaster {
  private readonly logger = new Logger(EventsGateway.name);
  private readonly byTenant = new Map<string, Set<WebSocket>>();

  constructor(private readonly jwt: JwtService) {}

  attach(server: HttpServer): void {
    const wss = new WebSocketServer({ server, path: "/events" });
    wss.on("connection", async (socket, request) => {
      const token = new URL(request.url ?? "", "http://localhost").searchParams.get("token");
      let tenantId: string;
      try {
        const payload = await this.jwt.verifyAsync<{ tenant: string }>(token ?? "");
        tenantId = payload.tenant;
      } catch {
        socket.close(4401, "invalid token");
        return;
      }
      let group = this.byTenant.get(tenantId);
      if (!group) {
        group = new Set();
        this.byTenant.set(tenantId, group);
      }
      group.add(socket);
      socket.on("close", () => {
        group.delete(socket);
        if (group.size === 0) this.byTenant.delete(tenantId);
      });
    });
    this.logger.log("WebSocket gateway attached at /events");
  }

  broadcast(tenantId: string, topic: string, payload: Record<string, unknown>): void {
    const group = this.byTenant.get(tenantId);
    if (!group) return;
    const message = JSON.stringify({ topic, payload });
    for (const socket of group) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    }
  }
}

/**
 * Node-Media-Server 生命周期管理服务。
 *
 * 职责：
 * - 启动/停止 NMS（RTMP 接收 + HTTP-FLV 分发）
 * - 校验推流流名合法性（流名格式 /live/<roomId>）
 * - 推流开始/结束时广播 stream-status 事件给房间内成员
 *
 * 不负责：
 * - 子模式切换（由 StreamPushHandler 处理）
 * - OBS 配置生成（由 router 处理）
 */

import type { Server as SocketIOServer } from 'socket.io';
import NodeMediaServer from 'node-media-server';
import { AppDataSource } from '../../data-source';
import { Room } from '../../entities/Room';
import { MEDIA_DIR } from '../../services/paths';
import type { PublishValidationResult } from './dto/stream-push.dto';

/**
 * NMS 服务单例。
 *
 * 设计：
 * - nmsInstance 和 nmsAvailable 为模块级状态，通过方法暴露
 * - start() 返回 stop 函数，用于主进程退出时清理
 * - 校验逻辑独立为 validatePublishStream，便于测试
 */
class NmsService {
  private nmsInstance: NodeMediaServer | null = null;
  private nmsAvailable = false;
  /** 当前活跃的推流会话 id -> roomId（用于 donePublish/postClose 时无需再查库即可广播） */
  private activePublishers = new Map<string | number, string>();

  /** NMS 是否已成功启动 */
  isAvailable(): boolean {
    return this.nmsAvailable;
  }

  /**
   * 校验推流流名是否为有效房间且为 stream-push 子模式。
   *
   * 流名格式：/live/<streamKey>
   * OBS 配置方式：服务器=rtmp://host:3334/live，推流码=streamKey
   * 通过 streamKey 查询 Room 表，避免暴露 roomId 并支持独立密钥管理。
   */
  async validatePublishStream(
    streamPath: string | undefined,
  ): Promise<PublishValidationResult> {
    if (!streamPath) return { valid: false, roomId: null };
    const match = streamPath.match(/^\/live\/(.+)$/);
    if (!match) return { valid: false, roomId: null };

    const streamKey = match[1];
    const roomRepo = AppDataSource.getRepository(Room);
    const room = await roomRepo.findOneBy({ streamKey });
    if (!room) return { valid: false, roomId: null };
    if (room.status !== 'active') return { valid: false, roomId: null };
    if (room.mode !== 'screen-share') return { valid: false, roomId: null };
    if (room.shareMethod !== 'stream-push') return { valid: false, roomId: null };

    return { valid: true, roomId: room.roomId };
  }

  /**
   * 启动 Node-Media-Server。
   *
   * - 端口通过 RTMP_PORT / HTTP_FLV_PORT 环境变量可配置（默认 3334 / 3335）
   * - 启动失败仅 console.error，不影响主进程
   * - prePublish 同步校验流名合法性，失败拒绝发布，成功广播 stream-status: live
   * - donePublish / postClose 均广播 stream-status: offline（修复旧版 postClose 不广播的缺陷）
   *
   * @returns stop 函数，用于主进程退出时停止 NMS
   */
  start(io: SocketIOServer): () => void {
    const rtmpPort = process.env.RTMP_PORT
      ? parseInt(process.env.RTMP_PORT, 10)
      : 3334;
    const httpFlvPort = process.env.HTTP_FLV_PORT
      ? parseInt(process.env.HTTP_FLV_PORT, 10)
      : 3335;

    const config = {
      rtmp: {
        port: rtmpPort,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60,
      },
      http: {
        port: httpFlvPort,
        // NMS 推流媒体切片统一存放到 config/media，便于升级时整体保留 config 目录
        mediaroot: MEDIA_DIR,
        allow_origin: '*',
      },
      auth: {
        play: false,
        // 启用 NMS 同步鉴权钩子，在 prePublish 中通过 streamKey
        // 查询 Room 表进行业务层校验（房间存在、活跃、screen-share + stream-push）。
        publish: true,
        secret: 'zviewer-stream-push',
      },
    };

    try {
      this.nmsInstance = new NodeMediaServer(config);

      // NMS 内部的 HTTP/RTMP 服务器在端口被占用时会异步触发 'error' 事件。
      // Node.js 对未监听 'error' 事件的 EventEmitter 默认行为是抛出异常并终止进程。
      // 此处提前注册 error 监听器，将端口冲突降级为警告而非崩溃。
      type ErrorEmitter = { on?: (event: string, cb: (err: Error) => void) => void };
      const nmsAny = this.nmsInstance as unknown as {
        httpServer?: { httpServer?: ErrorEmitter; wsServer?: ErrorEmitter };
        rtmpServer?: { tcpServer?: ErrorEmitter };
      };

      const handleServerError = (label: string) => (err: Error) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('EADDRINUSE')) {
          console.error(
            `[NMS] ${label} 端口被占用，跳过启动。请确保端口 ${rtmpPort}/${httpFlvPort} 未被其他进程占用。`,
          );
        } else {
          console.error(`[NMS] ${label} 服务器错误:`, err);
        }
        this.nmsAvailable = false;
      };

      // 注册 HTTP / WebSocket / RTMP 服务器的 error 事件
      // 使用 if 显式判空，避免 TS2722（Cannot invoke possibly undefined）
      const httpEmitter = nmsAny.httpServer?.httpServer;
      const wsEmitter = nmsAny.httpServer?.wsServer;
      const rtmpEmitter = nmsAny.rtmpServer?.tcpServer;
      if (httpEmitter?.on) httpEmitter.on('error', handleServerError('HTTP'));
      if (wsEmitter?.on) wsEmitter.on('error', handleServerError('WebSocket'));
      if (rtmpEmitter?.on) rtmpEmitter.on('error', handleServerError('RTMP'));

      // NMS 4 emits a session object and performs auth synchronously. Validate in
      // prePublish through its broadcast auth hook, before a publisher is installed.
      type PublishSession = {
        id: string; streamPath: string; close(): void;
        socket?: { destroy(): void };
        rtmp?: { onPacketCallback: (...args: unknown[]) => void };
        broadcast: { verifyAuth: (secret: string, session: PublishSession) => boolean };
      };
      const events = this.nmsInstance as unknown as {
        on(event: string, handler: (session: PublishSession) => void): void;
      };
      const accepted = new Map<string, string>();
      events.on('prePublish', session => {
        session.broadcast.verifyAuth = (_secret, candidate) => {
          const key = /^\/live\/([A-Za-z0-9_-]+)$/.exec(candidate.streamPath)?.[1];
          const reject = () => {
            // NMS 4 keeps parsing the current TCP buffer after auth failure.
            // Discard subsequent packets as well as closing the connection.
            if (candidate.rtmp) candidate.rtmp.onPacketCallback = () => {};
            candidate.socket?.destroy();
            return false;
          };
          if (!key) return reject();
          // sql.js is the application's configured driver. Its synchronous statement
          // avoids accepting packets during an asynchronous EventEmitter callback.
          const db = (AppDataSource.driver as unknown as { databaseConnection: {
            prepare(sql: string): { bind(values: string[]): void; step(): boolean;
              getAsObject(): Record<string, unknown>; free(): void };
          } }).databaseConnection;
          const stmt = db.prepare('SELECT roomId FROM room WHERE streamKey = ? AND status = ? AND mode = ? AND shareMethod = ?');
          try {
            stmt.bind([key, 'active', 'screen-share', 'stream-push']);
            if (!stmt.step()) return reject();
            accepted.set(candidate.id, String(stmt.getAsObject().roomId));
            return true;
          } finally { stmt.free(); }
        };
      });
      events.on('postPublish', session => {
        const roomId = accepted.get(session.id);
        accepted.delete(session.id);
        if (!roomId) { session.close(); return; }
        this.activePublishers.set(session.id, roomId);
        io.to(roomId).emit('stream-status', { roomId, status: 'live' });
      });
      const onStopped = (session: PublishSession) => {
        accepted.delete(session.id);
        const roomId = this.activePublishers.get(session.id);
        if (!roomId) return;
        this.activePublishers.delete(session.id);
        io.to(roomId).emit('stream-status', { roomId, status: 'offline' });
      };
      events.on('donePublish', onStopped);
      events.on('postClose', onStopped);

      this.nmsInstance.run();
      this.nmsAvailable = true;
      console.log(
        `[NMS] Node-Media-Server started: RTMP=:${rtmpPort} HTTP-FLV=:${httpFlvPort}`,
      );
    } catch (err) {
      console.error('[NMS] failed to start Node-Media-Server:', err);
      this.nmsAvailable = false;
    }

    return () => {
      if (this.nmsInstance) {
        try {
          // Node-Media-Server 实例可能未暴露 stop 方法（版本差异），
          // 使用可选调用避免 TypeError。
          if (typeof this.nmsInstance.stop === 'function') {
            this.nmsInstance.stop();
          }
          console.log('[NMS] Node-Media-Server stopped');
        } catch (err) {
          console.error('[NMS] stop error:', err);
        }
      }
      this.nmsAvailable = false;
      this.nmsInstance = null;
    };
  }
}

/** 全局单例 */
export const nmsService = new NmsService();

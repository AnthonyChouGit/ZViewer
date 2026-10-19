import type { Socket } from 'socket.io';
import { assertTokenActive, verifyAccessToken, tokenRevocations } from './auth';

export async function socketAuthMiddleware(
  socket: Socket, next: (err?: Error) => void,
): Promise<void> {
  if (socket.handshake.auth.agent === 'zcontrol-cli') {
    socket.data.isCliAgent = true;
    return next();
  }
  try {
    const cookie = socket.handshake.headers.cookie?.split(';')
      .find((part) => part.trim().startsWith('access_token='));
    const token = cookie
      ? decodeURIComponent(cookie.trim().slice('access_token='.length))
      : socket.handshake.auth.token || socket.handshake.query.token;
    if (typeof token !== 'string' || !token) return next(new Error('未提供认证令牌'));
    const payload = verifyAccessToken(token);
    await assertTokenActive(payload);
    Object.assign(socket.data, payload);
    const revoke = () => socket.disconnect(true);
    const event = String(payload.userId);
    tokenRevocations.on(event, revoke);
    const expiry = setTimeout(revoke, Math.max(0, ((payload.exp ?? 0) * 1000) - Date.now()));
    expiry.unref();
    socket.once('disconnect', () => { tokenRevocations.off(event, revoke); clearTimeout(expiry); });
    // Existing connections must lose access too, not only new handshakes.
    socket.use(async (_packet, packetNext) => {
      try {
        verifyAccessToken(token);
        await assertTokenActive(payload);
        packetNext();
      } catch {
        packetNext(new Error('认证令牌已撤销或已过期'));
        socket.disconnect(true);
      }
    });
    next();
  } catch {
    next(new Error('认证令牌无效或已过期'));
  }
}

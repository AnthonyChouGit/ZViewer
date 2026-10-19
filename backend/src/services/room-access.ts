import type { NextFunction, Response } from 'express';
import { IsNull } from 'typeorm';
import { AppDataSource } from '../data-source';
import { Room } from '../entities/Room';
import { Session } from '../entities/Session';
import { Movie } from '../entities/Movie';
import type { AuthenticatedRequest, JwtPayload } from '../middleware/auth';

/** REST/media requests inherit admission from an active primary room session. */
export async function canReadRoom(roomId: string, actor: JwtPayload): Promise<boolean> {
  const room = await AppDataSource.getRepository(Room).findOneBy({ roomId });
  if (!room) return false;
  if (actor.role === 'root' || (actor.userId > 0 && room.ownerUserId === actor.userId)) return true;
  if (room.status !== 'active') return false;
  if (actor.userId === 0 && !actor.guestId) return false;
  return AppDataSource.getRepository(Session).existsBy({
    roomId,
    userId: actor.userId,
    ...(actor.userId === 0 ? { guestId: actor.guestId } : {}),
    endedAt: IsNull(),
  });
}

export async function requireRoomReadAccess(
  req: AuthenticatedRequest, res: Response, next: NextFunction,
): Promise<void> {
  const roomId = String(req.params.roomId ?? '');
  if (!await AppDataSource.getRepository(Room).existsBy({ roomId })) {
    res.status(404).json({ success: false, message: '房间不存在' });
    return;
  }
  if (!req.user || !await canReadRoom(roomId, req.user)) {
    res.status(403).json({ success: false, message: '请先通过房间准入验证' });
    return;
  }
  next();
}

export async function requireMovieReadAccess(
  req: AuthenticatedRequest, res: Response, next: NextFunction,
): Promise<void> {
  const id = Number(req.query.movieId ?? req.params.movieId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ success: false, message: 'movieId 参数无效' });
    return;
  }
  const movie = await AppDataSource.getRepository(Movie).findOneBy({ id });
  if (!movie) {
    res.status(404).json({ success: false, message: '影片不存在' });
    return;
  }
  if (!req.user || !await canReadRoom(movie.roomId, req.user)) {
    res.status(403).json({ success: false, message: '请先通过房间准入验证' });
    return;
  }
  next();
}

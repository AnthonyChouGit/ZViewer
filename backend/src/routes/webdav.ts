/**
 * WebDAV 挂载路由
 *
 * 挂载路径：/api/webdav
 *
 * 端点列表：
 * - GET    /mounts              列出当前用户的 WebDAV 挂载
 * - POST   /mounts/test         测试连接（含挂载 path 可访问性）
 * - POST   /mounts              创建挂载
 * - PUT    /mounts/:id          更新挂载
 * - DELETE /mounts/:id          删除挂载
 * - GET    /mounts/:id/browse   浏览目录（60s 缓存）
 * - GET    /resolve             解析文件（返回 /proxy 相对 URL）
 * - GET    /proxy               代理流（mountId + path，凭证取挂载记录）
 * - GET    /direct-url          获取直链（AList API 优先，失败回退拼接）
 * - GET    /stream              代理流（movieId，房间内任何成员可访问）
 *
 * 业务全部下沉 modules/webdav/webdav-mount.service.ts，此处只做参数校验与响应组装。
 * 早期这里是 WebDAV/OpenList 共用路由工厂；OpenList 改用 AList HTTP API 独立实现后
 * 工厂只剩 WebDAV 一个实例，故收敛为单一源路由（行为不变）。
 */
import { Router, type Response } from 'express';
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth';
import { pipeRangeStream, resolveUserMount, StreamMovieError } from '../services/proxy';
import { detectMediaFormat, getContentType } from '../services/mediaFormat';
import { sendStreamMovieErrorResponse } from '../utils/stream-response';
import { stripPassword } from '../modules/shared/mount-utils';
import {
  WEBDAV_DISPLAY_NAME,
  WEBDAV_LOG_TAG,
  WEBDAV_MOUNT_TYPE,
  WebDAVMountError,
  browseMount,
  createMount,
  deleteMount,
  listMounts,
  openMountStream,
  openMovieStream,
  resolveMountDirectUrl,
  resolveMountFile,
  testMountConnection,
  updateMount,
} from '../modules/webdav/webdav-mount.service';

const router = Router();

router.use(authenticateToken);

/** 业务错误 → HTTP 响应（code 为空时由 JSON 序列化自动省略）。 */
function sendMountError(res: Response, err: WebDAVMountError): void {
  res.status(err.status).json({ success: false, message: err.message, code: err.code });
}

/** 解析路径参数中的挂载 ID；非法时返回 null（调用方回 400）。 */
function parseMountId(raw: string | string[]): number | null {
  const id = Number(raw);
  return Number.isNaN(id) ? null : id;
}

// 2.1 挂载 CRUD - GET /mounts
router.get('/mounts', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const mounts = await listMounts(req.user!.userId);
    res.json({ success: true, mounts: mounts.map(stripPassword) });
  } catch (err) {
    console.error(`[${WEBDAV_LOG_TAG}] list mounts error:`, err);
    res.status(500).json({ success: false, message: `获取 ${WEBDAV_DISPLAY_NAME} 挂载列表失败` });
  }
});

// 2.2 测试连接 - POST /mounts/test（必须在 /:id 之前注册）
router.post('/mounts/test', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { itemCount } = await testMountConnection(req.body ?? {});
    res.json({ success: true, itemCount });
  } catch (err) {
    if (err instanceof WebDAVMountError) {
      sendMountError(res, err);
      return;
    }
    console.error(`[${WEBDAV_LOG_TAG}] test mount error:`, err);
    res.status(500).json({ success: false, message: `测试 ${WEBDAV_DISPLAY_NAME} 连接失败` });
  }
});

// 2.3 挂载 CRUD - POST /mounts
router.post('/mounts', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const { mount, warning } = await createMount(req.user!.userId, req.body ?? {});
    res.status(201).json({
      success: true,
      mount: stripPassword(mount),
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    if (err instanceof WebDAVMountError) {
      sendMountError(res, err);
      return;
    }
    console.error(`[${WEBDAV_LOG_TAG}] create mount error:`, err);
    res.status(500).json({ success: false, message: `创建 ${WEBDAV_DISPLAY_NAME} 挂载失败` });
  }
});

// 2.4 挂载 CRUD - PUT /mounts/:id
router.put('/mounts/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = parseMountId(req.params.id);
    if (id === null) {
      res.status(400).json({ success: false, message: '挂载 ID 不正确' });
      return;
    }
    const { mount, warning } = await updateMount(req.user!.userId, id, req.body ?? {});
    res.json({
      success: true,
      mount: stripPassword(mount),
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    if (err instanceof WebDAVMountError) {
      sendMountError(res, err);
      return;
    }
    console.error(`[${WEBDAV_LOG_TAG}] update mount error:`, err);
    res.status(500).json({ success: false, message: `更新 ${WEBDAV_DISPLAY_NAME} 挂载失败` });
  }
});

// 2.5 挂载 CRUD - DELETE /mounts/:id
router.delete('/mounts/:id', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = parseMountId(req.params.id);
    if (id === null) {
      res.status(400).json({ success: false, message: '挂载 ID 不正确' });
      return;
    }
    await deleteMount(req.user!.userId, id);
    res.json({ success: true });
  } catch (err) {
    if (err instanceof WebDAVMountError) {
      sendMountError(res, err);
      return;
    }
    console.error(`[${WEBDAV_LOG_TAG}] delete mount error:`, err);
    res.status(500).json({ success: false, message: `删除 ${WEBDAV_DISPLAY_NAME} 挂载失败` });
  }
});

// 2.6 浏览 - GET /mounts/:id/browse?path=
router.get('/mounts/:id/browse', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const id = parseMountId(req.params.id);
    if (id === null) {
      res.status(400).json({ success: false, message: '挂载 ID 不正确' });
      return;
    }
    const browsePath = typeof req.query.path === 'string' ? req.query.path : undefined;
    const entries = await browseMount(req.user!.userId, id, browsePath);
    res.json({ success: true, entries });
  } catch (err) {
    if (err instanceof WebDAVMountError) {
      sendMountError(res, err);
      return;
    }
    console.error(`[${WEBDAV_LOG_TAG}] browse mount error:`, err);
    res.status(500).json({ success: false, message: `浏览 ${WEBDAV_DISPLAY_NAME} 挂载失败` });
  }
});

// 2.7 解析 - GET /resolve?mountId=&path=
router.get('/resolve', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const mountIdRaw = req.query.mountId;
    const pathRaw = req.query.path;
    if (mountIdRaw === undefined || pathRaw === undefined) {
      res
        .status(400)
        .json({ success: false, message: '缺少 mountId 或 path 参数', code: 'INVALID_PARAMS' });
      return;
    }

    const mountId = parseMountId(String(mountIdRaw));
    if (mountId === null) {
      res.status(400).json({ success: false, message: 'mountId 不正确', code: 'INVALID_PARAMS' });
      return;
    }
    const targetPath = typeof pathRaw === 'string' ? pathRaw : '';
    if (!targetPath.trim()) {
      res.status(400).json({ success: false, message: 'path 不能为空', code: 'INVALID_PARAMS' });
      return;
    }

    const body = await resolveMountFile(req.user!.userId, mountId, targetPath);
    res.json({ success: true, ...body });
  } catch (err) {
    if (err instanceof WebDAVMountError) {
      sendMountError(res, err);
      return;
    }
    console.error(`[${WEBDAV_LOG_TAG}] resolve error:`, err);
    res.status(500).json({ success: false, message: `解析 ${WEBDAV_DISPLAY_NAME} 文件失败` });
  }
});

// 2.8 代理 - GET /proxy?mountId=&path=
router.get('/proxy', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    // 代理端点通过 query 暴露 mountId+path，但凭证仅从 DB 读取，不会出现在 URL 中
    const resolved = await resolveUserMount(req, res, WEBDAV_MOUNT_TYPE);
    if (!resolved) return;
    const { mount, targetPath } = resolved;

    const stream = await openMountStream(mount, targetPath, req.headers.range);
    pipeRangeStream(res, {
      stream: stream.stream,
      contentType: getContentType(detectMediaFormat(targetPath)),
      fileSize: stream.fileSize,
      start: stream.start,
      end: stream.end,
      // 用实际语义而非客户端请求头：退化全量 GET（无 Range/fileSize 未知/
      // 非法 Range）时必须回 200，否则 206 + 错误 Content-Range 会挂掉播放
      ranged: stream.ranged,
      logTag: WEBDAV_LOG_TAG,
      errorMessage: `${WEBDAV_DISPLAY_NAME} 代理流错误`,
      errorCode: 'UNREACHABLE',
    });
  } catch (err) {
    if (err instanceof WebDAVMountError) {
      sendMountError(res, err);
      return;
    }
    console.error(`[${WEBDAV_LOG_TAG}] proxy error:`, err);
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: `代理 ${WEBDAV_DISPLAY_NAME} 媒体失败` });
    } else {
      res.destroy();
    }
  }
});

// 2.9 获取直链 - GET /direct-url?mountId=&path=
// 房主添加影片时调用：后端使用挂载凭证返回直链 URL。
router.get('/direct-url', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const mountIdRaw = req.query.mountId;
    const pathRaw = req.query.path;
    if (mountIdRaw === undefined || pathRaw === undefined) {
      res.status(400).json({ success: false, message: '缺少 mountId 或 path 参数' });
      return;
    }
    const mountId = parseMountId(String(mountIdRaw));
    if (mountId === null) {
      res.status(400).json({ success: false, message: 'mountId 不正确' });
      return;
    }
    const targetPath = typeof pathRaw === 'string' ? pathRaw.trim() : '';
    if (!targetPath) {
      res.status(400).json({ success: false, message: 'path 不能为空' });
      return;
    }

    const directUrl = await resolveMountDirectUrl(req.user!.userId, mountId, targetPath);
    res.json({ success: true, directUrl });
  } catch (err) {
    if (err instanceof WebDAVMountError) {
      sendMountError(res, err);
      return;
    }
    console.error(`[${WEBDAV_LOG_TAG}] direct-url error:`, err);
    res.status(500).json({ success: false, message: `获取 ${WEBDAV_DISPLAY_NAME} 直链失败` });
  }
});

// 2.10 基于影片 ID 的流代理 - GET /stream?movieId=
// 与 /proxy 的区别：/stream 不依赖 userId 查挂载，而是直接从 Movie 表读取凭证，
// 这样房间内任何成员（含观众）都能通过 movieId 访问影片流。
router.get('/stream', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const movieIdRaw = req.query.movieId;
    if (movieIdRaw === undefined) {
      res.status(400).json({ success: false, message: '缺少 movieId 参数' });
      return;
    }
    const movieId = Number(movieIdRaw);
    if (Number.isNaN(movieId)) {
      res.status(400).json({ success: false, message: 'movieId 不正确' });
      return;
    }

    const stream = await openMovieStream(movieId, req.headers.range);
    pipeRangeStream(res, {
      stream: stream.stream,
      contentType: getContentType(detectMediaFormat(stream.movie.path!)),
      fileSize: stream.fileSize,
      start: stream.start,
      end: stream.end,
      // 用实际语义而非客户端请求头（同 /proxy，防退化路径产出错误 206）
      ranged: stream.ranged,
      logTag: `${WEBDAV_LOG_TAG}-stream`,
      errorMessage: `${WEBDAV_DISPLAY_NAME} 影片流错误`,
      errorCode: 'UNREACHABLE',
    });
  } catch (err) {
    // 业务错误（影片不存在/未挂载）单行 warn：这类错误会被客户端重试放大
    // （实测 3 天 3717 次），完整堆栈会把日志撑到数 MB
    if (err instanceof StreamMovieError) {
      sendStreamMovieErrorResponse(res, err, {
        logTag: WEBDAV_LOG_TAG,
        extraLog: `(movieId=${req.query.movieId})`,
      });
      return;
    }
    if (err instanceof WebDAVMountError) {
      sendMountError(res, err);
      return;
    }
    console.error(`[${WEBDAV_LOG_TAG}] stream error:`, err);
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: `代理 ${WEBDAV_DISPLAY_NAME} 影片失败` });
    } else {
      res.destroy();
    }
  }
});

export default router;

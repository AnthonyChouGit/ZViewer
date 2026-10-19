/**
 * 字幕自动搜索 & 目录浏览路由
 *
 * 挂载路径：/api/subtitles
 *
 * 功能：
 *   GET /search?movieId=                搜索影片同目录下的同名字幕文件
 *   GET /browse?movieId=&path=          浏览影片所在目录（或指定子目录），返回文件列表
 *   GET /load?movieId=&path=            读取指定字幕文件内容
 *   GET /embedded-tracks?movieId=       列出 Emby/Jellyfin 视频的内嵌字幕轨道
 *   GET /embedded-extract?movieId=&index= 提取指定内嵌字幕轨道内容
 *
 * 设计要点：
 * - 通过 movieId 从 Movie 表获取 source/path/serverUrl/username/password
 * - 支持 webdav / openlist（AList HTTP API）/ ftp / server-files 四种源
 * - 每源编排已下沉 modules/subtitle/subtitle-source.service.ts，此处只做
 *   参数校验、影片 404、源类型门禁与响应组装
 * - load 返回字幕文件内容（非 URL），前端解析后转为 data URL 供 socket 同步
 *
 * v2 重构：OpenList 不再复用 WebDAV 协议，改用 AList HTTP API
 * （listOpenListDirectory / fetchOpenListFileInfo），密码使用 SHA-256 哈希。
 */
import { requireMovieReadAccess } from '../services/room-access';
import { Router, type Response } from 'express';
import { AppDataSource } from '../data-source';
import { Movie } from '../entities/Movie';
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth';
import {
  SubtitleServiceError,
  browseMovieDirectory,
  dirname,
  extractEmbyEmbeddedTrack,
  listEmbyEmbeddedTracks,
  loadSubtitleFile,
  searchSubtitlesInMovieDir,
} from '../modules/subtitle/subtitle-source.service';

const router = Router();

// 所有字幕搜索接口需要认证
router.use(authenticateToken, requireMovieReadAccess);

/**
 * GET /search?movieId=
 *
 * 根据影片 ID 搜索同目录下的字幕文件，返回匹配的字幕内容。
 *
 * 响应：
 *   200 { success: true, subtitles: SubtitleSearchResult[] }
 *   400/404/500 { success: false, message: string }
 */
router.get('/search', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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

    const movie = await AppDataSource.getRepository(Movie).findOneBy({
      id: movieId,
    });
    if (!movie) {
      res.status(404).json({ success: false, message: '影片不存在' });
      return;
    }

    const subtitles = await searchSubtitlesInMovieDir(movie);
    res.json({ success: true, subtitles });
  } catch (err) {
    console.error('[subtitles] search error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: err instanceof Error ? err.message : '搜索字幕失败',
      });
    }
  }
});

/**
 * GET /browse?movieId=&path=
 *
 * 浏览影片所在目录（或指定子目录），返回文件列表。
 * path 省略时默认浏览影片所在目录。
 *
 * 响应：
 *   200 { success: true, entries: BrowseEntry[], currentPath: string, parentPath: string | null }
 *   400/404/500 { success: false, message: string }
 */
router.get('/browse', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
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

    const movie = await AppDataSource.getRepository(Movie).findOneBy({
      id: movieId,
    });
    if (!movie) {
      res.status(404).json({ success: false, message: '影片不存在' });
      return;
    }

    const source = (movie.source || '').toLowerCase();
    if (!['webdav', 'openlist', 'ftp', 'server-files'].includes(source)) {
      res.status(400).json({ success: false, message: '该影片源类型不支持目录浏览' });
      return;
    }

    if (!movie.path) {
      res.status(400).json({ success: false, message: '影片没有路径信息' });
      return;
    }

    // 目标目录：优先使用 query path，否则使用影片所在目录
    const targetPath =
      typeof req.query.path === 'string' && req.query.path.trim()
        ? req.query.path.trim()
        : dirname(movie.path);

    const { entries, currentPath, parentPath } = await browseMovieDirectory(movie, targetPath);
    res.json({ success: true, entries, currentPath, parentPath });
  } catch (err) {
    console.error('[subtitles] browse error:', err);
    if (!res.headersSent) {
      const status = err instanceof SubtitleServiceError ? err.status : 500;
      res.status(status).json({
        success: false,
        message: err instanceof Error ? err.message : '浏览目录失败',
      });
    }
  }
});

/**
 * GET /load?movieId=&path=
 *
 * 读取指定路径的字幕文件内容。
 *
 * 响应：
 *   200 { success: true, filename: string, format: string, content: string }
 *   400/404/500 { success: false, message: string }
 */
router.get('/load', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const movieIdRaw = req.query.movieId;
    const filePath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    if (movieIdRaw === undefined) {
      res.status(400).json({ success: false, message: '缺少 movieId 参数' });
      return;
    }
    if (!filePath) {
      res.status(400).json({ success: false, message: '缺少 path 参数' });
      return;
    }
    const movieId = Number(movieIdRaw);
    if (Number.isNaN(movieId)) {
      res.status(400).json({ success: false, message: 'movieId 不正确' });
      return;
    }

    const movie = await AppDataSource.getRepository(Movie).findOneBy({
      id: movieId,
    });
    if (!movie) {
      res.status(404).json({ success: false, message: '影片不存在' });
      return;
    }

    const source = (movie.source || '').toLowerCase();
    if (!['webdav', 'openlist', 'ftp', 'server-files'].includes(source)) {
      res.status(400).json({ success: false, message: '该影片源类型不支持字幕加载' });
      return;
    }

    const { filename, format, content } = await loadSubtitleFile(movie, filePath);
    res.json({ success: true, filename, format, content });
  } catch (err) {
    console.error('[subtitles] load error:', err);
    if (!res.headersSent) {
      const status = err instanceof SubtitleServiceError ? err.status : 500;
      res.status(status).json({
        success: false,
        message: err instanceof Error ? err.message : '加载字幕失败',
      });
    }
  }
});

// ==================== 内嵌字幕 ====================

/**
 * 列出视频的内嵌字幕轨道：
 * - emby：直接读 Emby PlaybackInfo 的 MediaStreams（Type===Subtitle）
 * - 其余来源：内嵌字幕提取已前端化（浏览器端 MKV demux），后端不再支持
 */
router.get('/embedded-tracks', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const movieId = Number(req.query.movieId);
    if (!Number.isFinite(movieId)) {
      res.status(400).json({ success: false, message: '缺少或无效的 movieId 参数' });
      return;
    }
    const movie = await AppDataSource.getRepository(Movie).findOneBy({
      id: movieId,
    });
    if (!movie) {
      res.status(400).json({ success: false, message: '影片不存在' });
      return;
    }
    const source = (movie.source || '').toLowerCase();

    if (source === 'emby' || source === 'jellyfin') {
      const tracks = await listEmbyEmbeddedTracks(movie);
      res.json({ success: true, tracks });
      return;
    }

    res.status(400).json({
      success: false,
      message: '该来源的内嵌字幕提取已前端化，后端不再提供探测',
    });
  } catch (err) {
    console.error('[subtitles] embedded-tracks error:', err);
    res.status(400).json({
      success: false,
      message: err instanceof Error ? err.message : '获取内嵌字幕轨道失败',
    });
  }
});

/**
 * 提取指定内嵌字幕轨道内容：
 * - emby：调 Emby Subtitles Stream 端点（Emby 自动转封装为 SRT/ASS/VTT）
 * - 其余来源：内嵌字幕提取已前端化（浏览器端 MKV demux），后端不再支持
 */
router.get('/embedded-extract', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const movieId = Number(req.query.movieId);
    const streamIndex = Number(req.query.index);
    if (!Number.isFinite(movieId) || !Number.isFinite(streamIndex)) {
      res.status(400).json({ success: false, message: '缺少或无效的 movieId/index 参数' });
      return;
    }
    const movie = await AppDataSource.getRepository(Movie).findOneBy({
      id: movieId,
    });
    if (!movie) {
      res.status(400).json({ success: false, message: '影片不存在' });
      return;
    }
    const source = (movie.source || '').toLowerCase();

    if (source === 'emby' || source === 'jellyfin') {
      const { content, format, label, language } = await extractEmbyEmbeddedTrack(
        movie,
        streamIndex,
      );
      res.json({ success: true, content, format, label, language });
      return;
    }

    res.status(400).json({
      success: false,
      message: '该来源的内嵌字幕提取已前端化，后端不再提供提取',
    });
  } catch (err) {
    console.error('[subtitles] embedded-extract error:', err);
    const status = err instanceof SubtitleServiceError ? err.status : 400;
    res.status(status).json({
      success: false,
      message: err instanceof Error ? err.message : '提取内嵌字幕失败',
    });
  }
});

export default router;

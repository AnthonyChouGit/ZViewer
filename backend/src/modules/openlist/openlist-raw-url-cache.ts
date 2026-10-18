/**
 * OpenList raw_url 直链缓存（纯搬迁自 routes/openlist.ts 的流代理基础设施）。
 *
 * AList 的 raw_url 通常带签名（sign 参数），签名有效期取决于存储后端配置；
 * 该缓存避免每次 /proxy、/stream Range 请求都调用上游 /api/fs/get。
 */
import type { Response } from 'express';
import { fetchOpenListFileInfo } from '../../services/openlist';
import { TtlCache } from '../../utils/ttl-cache';

/** raw_url 缓存条目：避免每次 /stream 都调用 /api/fs/get */
export interface RawUrlCacheEntry {
  rawUrl: string;
  name: string;
  size: number;
  /** 过期时间戳（毫秒） */
  expireAt: number;
}

const RAW_URL_TTL_MS = 5 * 60 * 1000;

/**
 * raw_url 缓存（按 movieId|path 维度，5 分钟 TTL）。
 * 使用 TtlCache（LRU 上限）替代无界 Map：过期惰性清理 + 容量超限按最久未使用淘汰，
 * 避免长期运行（多房间多影片）下缓存条目只增不减。
 */
const rawUrlCache = new TtlCache<RawUrlCacheEntry>({
  ttlMs: 5 * 60 * 1000,
  maxSize: 500,
});

/** 单飞去重：并发解析同一 cacheKey（多人同时进房间/同影片并发 Range）时共享同一个上游 /api/fs/get */
const rawUrlInFlight = new Map<string, Promise<RawUrlCacheEntry>>();

/**
 * 获取 raw_url（带缓存 + 单飞去重）。
 * 优先从缓存读取；未命中或过期时调用 fetchOpenListFileInfo 获取新直链。
 * 5 分钟 TTL 在绝大多数场景下足够。
 */
export async function getCachedRawUrl(
  serverUrl: string,
  username: string | undefined,
  password: string | undefined,
  path: string,
  cacheKey: string,
): Promise<RawUrlCacheEntry> {
  const cached = rawUrlCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // 单飞：并发未命中只触发一次上游解析（对齐 movie-direct-resolver 的 inFlight 模式）
  const pending = rawUrlInFlight.get(cacheKey);
  if (pending) {
    return pending;
  }
  const promise = (async () => {
    const info = await fetchOpenListFileInfo(serverUrl, username, password, path);
    const entry: RawUrlCacheEntry = {
      rawUrl: info.rawUrl,
      name: info.name,
      size: info.size,
      expireAt: Date.now() + RAW_URL_TTL_MS,
    };
    rawUrlCache.set(cacheKey, entry);
    return entry;
  })().finally(() => {
    rawUrlInFlight.delete(cacheKey);
  });
  rawUrlInFlight.set(cacheKey, promise);
  return promise;
}

/** 失效指定 movieId 的 raw_url 缓存 */
export function invalidateRawUrlCache(cacheKey: string): void {
  rawUrlCache.delete(cacheKey);
}

/**
 * 上游认证/签名类错误（401/403/410）时失效 raw_url 缓存。
 * proxyHttpUpstream 在发头前已设置 res.statusCode 为上游状态码，调用点位于
 * 其 await 返回之后——此处仅做缓存失效，不重发响应（客户端下一次 Range
 * 请求自然拿到新直链）。
 */
export function invalidateRawUrlCacheOnUpstreamAuthError(res: Response, cacheKey: string): void {
  const status = res.statusCode;
  if (status === 401 || status === 403 || status === 410) {
    invalidateRawUrlCache(cacheKey);
  }
}

import { bilibiliFetch } from './client';
import { getCachedVipStatus, setCachedVipStatus } from './cache';

/**
 * Bilibili 权限识别统一模块
 * 归并会员状态查询、清晰度过滤、fnval 计算、默认清晰度选择
 */

/** 非会员默认清晰度：1080P */
export const DEFAULT_QN = 80;
/** 会员默认清晰度：4K 超清 */
export const VIP_DEFAULT_QN = 120;
/** HDR 真彩（HEVC Main10 / HLG） */
export const QN_HDR = 125;
/** 杜比视界（浏览器无法解码，仅识别不暴露） */
export const QN_DOLBY_VISION = 126;
/** 8K 清晰度 qn */
export const QN_8K = 127;

/**
 * playurl 的 fnval 位标志（依据 B站公开接口语义）。
 *
 * 注意：实测（2026-10）B站 对大会员账号会一次性返回所有可用轨道，
 * 这些 bit 更像「能力声明」而非硬门槛；但语义必须写对，否则 8K / 杜比
 * 这类冷门档位在部分稿件上会拿不到。
 */
export const FNVAL_BITS = {
  /** 单流 MP4（durl） */
  MP4: 1,
  /** DASH 分离流 */
  DASH: 16,
  /** HDR（qn=125） */
  HDR: 64,
  /** 4K（qn=120） */
  FOUR_K: 128,
  /** 杜比音频（dash.dolby） */
  DOLBY_AUDIO: 256,
  /** 杜比视界（qn=126，浏览器基本无法解码） */
  DOLBY_VISION: 512,
  /** 8K（qn=127） */
  EIGHT_K: 1024,
  /** AV1 编码轨道 */
  AV1: 2048,
} as const;

/** VIP 专属清晰度列表（非会员不可用） */
export const VIP_ONLY_QNS = [112, 116, 120, 125, 126, 127];

/** qn 到标签/分辨率的兜底映射表 */
export const QN_QUALITY_MAP: Record<number, { label: string; resolution?: string }> = {
  127: { label: '8K 超高清', resolution: '7680x4320' },
  126: { label: '杜比视界', resolution: '3840x2160' },
  125: { label: 'HDR 真彩', resolution: '3840x2160' },
  120: { label: '4K 超清', resolution: '3840x2160' },
  116: { label: '1080P60', resolution: '1920x1080' },
  112: { label: '1080P+', resolution: '1920x1080' },
  80: { label: '1080P', resolution: '1920x1080' },
  74: { label: '720P60', resolution: '1280x720' },
  64: { label: '720P', resolution: '1280x720' },
  32: { label: '480P', resolution: '854x480' },
  16: { label: '360P', resolution: '640x360' },
};

interface BilibiliNavData {
  isLogin?: boolean;
  vipStatus?: number;
  vipType?: number;
}

/**
 * 查询用户大会员状态。
 * 内部处理 !cookie 短路和缓存读写，不需要 checkVip 包装。
 */
export async function getVipStatus(cookie: string | undefined): Promise<boolean> {
  if (!cookie) return false;

  const trimmedCookie = cookie.trim();
  if (!trimmedCookie) return false;

  const cached = getCachedVipStatus(trimmedCookie);
  if (cached !== null) return cached;

  try {
    const res = await bilibiliFetch<BilibiliNavData>(
      'https://api.bilibili.com/x/web-interface/nav',
      { cookie: trimmedCookie },
    );

    if (!res.data.isLogin) {
      setCachedVipStatus(trimmedCookie, false);
      return false;
    }

    const isVip = res.data.vipStatus === 1 || (res.data.vipType ?? 0) > 0;
    setCachedVipStatus(trimmedCookie, isVip);
    return isVip;
  } catch (err) {
    console.error('[bilibili] getVipStatus error:', err);
    return false;
  }
}

/**
 * 根据会员状态和登录态过滤可用清晰度列表。
 * - 未登录 B站：仅保留 480P 及以下（qn ≤ ANONYMOUS_MAX_QN），B站对未登录用户的限制
 * - 已登录非会员：过滤 VIP_ONLY_QNS，过滤后为空时回退到 1080P
 * - 已登录会员：返回全部
 */
export function filterQualitiesByVip(
  list: { id: number; label: string; resolution?: string }[] | undefined,
  isVip: boolean,
  hasCookie: boolean = true,
): { id: number; label: string; resolution?: string }[] {
  const original = list ?? [];
  if (isVip) {
    return original;
  }
  // 未登录 B站：仅保留 480P 及以下
  if (!hasCookie) {
    const anonymousFiltered = original.filter(
      (q) => q.id <= ANONYMOUS_MAX_QN,
    );
    if (anonymousFiltered.length === 0) {
      return [
        { id: 32, label: '480P', resolution: '854x480' },
        { id: 16, label: '360P', resolution: '640x360' },
      ];
    }
    return anonymousFiltered;
  }
  // 已登录非会员：严格过滤 VIP 专属清晰度
  const filtered = original.filter((q) => !VIP_ONLY_QNS.includes(q.id));
  // 若过滤后为空，回退到 1080P 单条目
  if (filtered.length === 0) {
    return [{ id: 80, label: '1080P', resolution: '1920x1080' }];
  }
  return filtered;
}

/**
 * 根据 VIP 状态和请求的 qn 计算 fnval 位标志。
 *
 * - 非会员：仅 DASH（16）
 * - 会员：DASH + HDR + 4K（208）
 * - qn=127：额外启用 8K 位（1024）
 * - qn=126：额外启用杜比视界位（512），仅当调用方显式允许（默认关闭，
 *   因为 Chromium 内核浏览器无法解码 DoVi，暴露即黑屏）
 * - 编码偏好 av1：额外启用 AV1 位（2048）
 *
 * 杜比音频位（256）不单独请求：Android/iOS 端才常用，且 dash.dolby 会随
 * 上述位一起返回。
 */
export function computeFnval(
  isVip: boolean,
  qn?: number,
  opts?: { codec?: string; allowDolbyVision?: boolean },
): number {
  if (!isVip) {
    return FNVAL_BITS.DASH;
  }

  let fnval = FNVAL_BITS.DASH | FNVAL_BITS.HDR | FNVAL_BITS.FOUR_K;
  if (qn === QN_8K) {
    fnval |= FNVAL_BITS.EIGHT_K;
  }
  if (qn === QN_DOLBY_VISION && opts?.allowDolbyVision) {
    fnval |= FNVAL_BITS.DOLBY_VISION;
  }
  if (opts?.codec === 'av1') {
    fnval |= FNVAL_BITS.AV1;
  }
  return fnval;
}

/** 未登录 B站 时允许访问的最高清晰度 qn（480P）。B站对未登录用户限制为 480P 及以下。 */
export const ANONYMOUS_MAX_QN = 32;

/**
 * 根据 VIP 状态和登录态返回默认清晰度。
 * - 未登录 B站：480P（32）—— B站对未登录用户限制为 480P 及以下
 * - 已登录非会员：1080P（80）
 * - 已登录会员：4K（120）
 */
export function getDefaultQn(isVip: boolean, hasCookie: boolean = true): number {
  if (!hasCookie) return ANONYMOUS_MAX_QN;
  return isVip ? VIP_DEFAULT_QN : DEFAULT_QN;
}

/**
 * 视频解码 / HDR 能力探测。
 *
 * 目标：
 * 1. 起播前判断当前浏览器（含 Wails 的 WebView2）能否解码目标编码，
 *    避免 HDR（HEVC Main10）在不支持的设备上黑屏；
 * 2. 给清晰度列表提供「本机不支持」标注所需的结论。
 *
 * 说明：`isTypeSupported` 返回 false 时，MSE 必然无法 append，属于硬结论；
 * 返回 true 只代表可解码，是否真正以 HDR 呈现还取决于显示器与系统 HDR 开关，
 * 这一层不做拦截（避免误伤 SDR 显示器上的正常播放）。
 */

export type HdrSupportLevel = 'full' | 'decode' | 'none'

/** HEVC Main10 代表性编码串（B站 HDR 轨为 hvc1.2.4.H150.90，同属 Main10） */
const HEVC_MAIN10_PROBES = [
  'hvc1.2.4.L150.B0',
  'hev1.2.4.L150.B0',
  'hvc1.2.4.H150.90',
]

/** 音频编码前缀（决定 MSE mime 用 audio/mp4 还是 video/mp4） */
const AUDIO_CODEC_RE = /^(mp4a|ac-3|ec-3|opus|flac|dts|alac)/i

let cachedLevel: HdrSupportLevel | null = null
let cachedHevc: boolean | null = null

function hasMse(): boolean {
  return (
    typeof MediaSource !== 'undefined' &&
    typeof MediaSource.isTypeSupported === 'function'
  )
}

function mseSupports(codecs: string, mime: 'video/mp4' | 'audio/mp4'): boolean {
  if (!hasMse()) return false
  try {
    return MediaSource.isTypeSupported(`${mime}; codecs="${codecs}"`)
  } catch {
    return false
  }
}

/**
 * 判断单个/组合编码串能否被 MSE 解码。
 *
 * - 空值视为「未知」，返回 true（不拦截，交给实际播放报错）；
 * - 组合串（`avc1.64001E,mp4a.40.2`）逐个校验，全通过才算支持；
 * - 全是音频编码时用 `audio/mp4`，否则用 `video/mp4`。
 */
export function canDecodeCodecs(codecs?: string | null): boolean {
  if (!codecs) return true
  if (!hasMse()) return false
  const parts = codecs
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return true
  const mime = parts.every((p) => AUDIO_CODEC_RE.test(p))
    ? 'audio/mp4'
    : 'video/mp4'
  return parts.every((p) => mseSupports(p, mime))
}

/** 当前环境是否具备 HEVC（Main10）解码能力 */
export function isHevcDecodable(): boolean {
  if (cachedHevc !== null) return cachedHevc
  cachedHevc = HEVC_MAIN10_PROBES.some((c) => mseSupports(c, 'video/mp4'))
  return cachedHevc
}

/** 当前显示环境是否声明支持 HDR（Chrome 系为 dynamic-range 媒体查询） */
export function isHdrDisplay(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false
  }
  try {
    if (window.matchMedia('(dynamic-range: high)').matches) return true
  } catch {
    /* ignore */
  }
  try {
    return window.matchMedia('(video-dynamic-range: high)').matches
  } catch {
    return false
  }
}

/**
 * HDR 支持等级：
 * - `none`：无法解码 HEVC Main10，HDR 档位不可用；
 * - `decode`：能解码，但显示器/系统未声明 HDR（可能被色调映射为 SDR）；
 * - `full`：能解码且当前显示环境声明 HDR。
 */
export function getHdrSupport(): HdrSupportLevel {
  if (cachedLevel) return cachedLevel
  if (!isHevcDecodable()) {
    cachedLevel = 'none'
    return cachedLevel
  }
  cachedLevel = isHdrDisplay() ? 'full' : 'decode'
  return cachedLevel
}

/** 是否属于 HDR 清晰度档位（B站：125=HDR 真彩，126=杜比视界） */
export function isHdrQn(qn?: number): boolean {
  return qn === 125 || qn === 126
}

/**
 * 清晰度选项的「本机不支持」后缀。
 * 仅在明确无法解码时返回文案，其余返回空串。
 */
export function unsupportedHdrHint(qn?: number): string {
  if (!isHdrQn(qn)) return ''
  return getHdrSupport() === 'none' ? '本机不支持' : ''
}

/** 测试/热更新用：清空探测缓存 */
export function resetHdrCapabilityCache(): void {
  cachedLevel = null
  cachedHevc = null
}

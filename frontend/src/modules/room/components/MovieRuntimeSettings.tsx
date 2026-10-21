/**
 * 影片级「播放设置」折叠区（影片卡片内）。
 *
 * 与「B站解析设置」同款交互：默认收起，展开后是两张子卡开关。
 * 与添加影片面板的区别：这里的改动直接写回影片记录（updateMovie）并广播
 * 给全房间，属性能实时生效的运行开关，而非「对下一次添加生效」。
 *
 * - 服务器中转（movie.serverProxy）：仅数据源类 anime / cms。
 *   解析链路每次播放都读该字段（resolveAnimeOnline / resolveCmsOnline），
 *   所以改完需要重解析当前源；Kazumi 的播放地址在添加时已固化，没有可
 *   重解析的元数据，故不提供该开关。
 * - 浏览器转码（movie.playsvideoEnabled）：所有非 B站 影片。
 *   该字段是引擎门控（shouldUsePlaysVideo），改完需要重挂载才会重新选引擎。
 *
 * 仅房主可操作；观众看到的是房主设定后的当前状态。
 */
import { useState } from 'react'
import { ChevronDown, MonitorPlay, Server, Settings2 } from 'lucide-react'
import { Switch } from '@/components/ui'
import { message } from '@/components/ui/message'
import { useRoomStore } from '@/store/roomStore'
import { cn } from '@/lib/utils'

interface SwitchCardProps {
  icon: React.ReactNode
  title: string
  subtitle: string
  hint: string
  checked: boolean
  disabled?: boolean
  onToggle: () => void
}

/** 单个开关子卡：图标 + 标题/英文小标 + 右侧开关 + 一行状态说明 */
function SwitchCard({
  icon,
  title,
  subtitle,
  hint,
  checked,
  disabled = false,
  onToggle,
}: SwitchCardProps) {
  return (
    <div
      className="rounded-[var(--md-sys-shape-corner)] p-1.5"
      style={{
        backgroundColor: 'var(--md-sys-color-surface-container-high)',
        border: checked
          ? '1px solid color-mix(in srgb, var(--md-sys-color-tertiary) 45%, transparent)'
          : undefined,
      }}
    >
      <div className="flex items-center gap-1.5">
        <div
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          style={{
            background:
              'linear-gradient(135deg, color-mix(in srgb, var(--md-sys-color-tertiary) 22%, transparent), color-mix(in srgb, var(--md-sys-color-secondary) 18%, transparent))',
          }}
        >
          {icon}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span
            className="text-[10px] font-bold leading-tight"
            style={{ color: 'var(--md-sys-color-on-surface)' }}
          >
            {title}
          </span>
          <span
            className="text-[8px] font-medium uppercase tracking-wide"
            style={{ color: 'var(--md-sys-color-on-surface-variant)' }}
          >
            {subtitle}
          </span>
        </div>
        <Switch
          checked={checked}
          disabled={disabled}
          onChange={() => onToggle()}
          aria-label={title}
          className="shrink-0"
        />
      </div>
      <div
        className="mt-1 text-[9px] leading-snug"
        style={{ color: 'var(--md-sys-color-on-surface-variant)' }}
      >
        {hint}
      </div>
    </div>
  )
}

export interface MovieRuntimeSettingsProps {
  movieId: number
  /** 当前用户是否为房主（决定开关是否可操作） */
  isHost: boolean
}

export function MovieRuntimeSettings({
  movieId,
  isHost,
}: MovieRuntimeSettingsProps) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState(false)
  const movie = useRoomStore((s) => s.movies.find((m) => m.id === movieId))
  const roomId = useRoomStore((s) => s.roomId)
  const currentMovieId = useRoomStore((s) => s.currentMovieId)
  const updateMovie = useRoomStore((s) => s.updateMovie)
  const triggerMovieSourceReload = useRoomStore(
    (s) => s.triggerMovieSourceReload
  )

  if (!movie) return null

  // 只有数据源类影片有「服务器中转」概念（Kazumi 地址已固化，见文件头注释）
  const showServerProxy =
    movie.sourceType === 'anime' || movie.sourceType === 'cms'
  const serverProxy = movie.serverProxy === true
  // 缺省视为开启，与 shouldUsePlaysVideo 的 `!== false` 宽松语义一致
  const playsvideoEnabled = movie.playsvideoEnabled !== false

  const summary = [
    showServerProxy ? (serverProxy ? '中转' : '直连') : null,
    playsvideoEnabled ? '转码' : '原生',
  ]
    .filter(Boolean)
    .join(' · ')

  const applySetting = async (patch: {
    serverProxy?: boolean
    playsvideoEnabled?: boolean
  }) => {
    if (!isHost || !roomId || saving) return
    setSaving(true)
    try {
      await updateMovie(roomId, movieId, patch)
      // 正在播放的影片才需要即时重解析/重挂载；其余影片的值在下次加载时生效
      if (movieId === currentMovieId) {
        triggerMovieSourceReload()
      }
    } catch (err) {
      console.error('[MovieRuntimeSettings] update setting error:', err)
      message.error(err instanceof Error ? err.message : '切换播放设置失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-[var(--md-sys-shape-corner)] px-1.5 py-1 text-[10px] transition-colors hover:bg-[var(--md-sys-color-surface-container-highest)]"
        style={{ color: 'var(--md-sys-color-on-surface-variant)' }}
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-1 font-medium">
          <Settings2 className="h-3 w-3" />
          播放设置
        </span>
        <span className="flex items-center gap-1">
          <span className="text-[9px]">{summary}</span>
          <ChevronDown
            className={cn(
              'h-3 w-3 transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </span>
      </button>
      {expanded && (
        <div
          className="mt-1 flex flex-col gap-2.5 rounded-[var(--md-sys-shape-corner)] p-2"
          style={{
            backgroundColor: 'var(--md-sys-color-surface-container)',
            border: '1px solid var(--md-sys-color-outline-variant)',
          }}
        >
          {showServerProxy && (
            <SwitchCard
              icon={
                <Server
                  className="h-3 w-3"
                  style={{ color: 'var(--md-sys-color-tertiary)' }}
                />
              }
              title="服务器中转"
              subtitle="SERVER RELAY"
              checked={serverProxy}
              disabled={!isHost || saving}
              onToggle={() => void applySetting({ serverProxy: !serverProxy })}
              hint={
                !isHost
                  ? '由房主统一管理'
                  : serverProxy
                    ? '媒体流经服务器转发，带防盗链的源需开启'
                    : '直连源站，服务器不转发媒体流'
              }
            />
          )}
          <SwitchCard
            icon={
              <MonitorPlay
                className="h-3 w-3"
                style={{ color: 'var(--md-sys-color-tertiary)' }}
              />
            }
            title="浏览器转码"
            subtitle="BROWSER TRANSCODE"
            checked={playsvideoEnabled}
            disabled={!isHost || saving}
            onToggle={() =>
              void applySetting({ playsvideoEnabled: !playsvideoEnabled })
            }
            hint={
              !isHost
                ? '由房主统一管理'
                : playsvideoEnabled
                  ? 'MKV / DTS 等非常规格式由浏览器重封装后播放'
                  : '强制原生播放，浏览器不支持的编码会没有画面或声音'
            }
          />
        </div>
      )}
    </div>
  )
}

/**
 * 添加影片卡片底部的「播放设置」折叠区。
 *
 * 服务器中转（仅数据源类 ani/kazumi/cms）与浏览器转码（仅非 B站 来源）
 * 都只作用于「下一次添加」，常驻表单会白白挤占高度，因此收进默认收起的
 * 折叠面板，展开后沿用影片卡片里「B站解析设置」的子卡样式。
 * 两个开关都不适用于当前来源时，整块不渲染。
 */
import { useState } from 'react'
import { ChevronDown, MonitorPlay, Server, Settings2 } from 'lucide-react'
import { Switch } from '@/components/ui'
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

export interface MoviePlaybackSettingsProps {
  /** 数据源类（ani/kazumi/cms）才有服务器中转的概念 */
  showServerProxy: boolean
  serverProxy: boolean
  onServerProxyChange: (next: boolean) => void
  /** B站 解析出的流浏览器必定原生可播，不展示转码开关 */
  showTranscode: boolean
  playsvideoEnabled: boolean
  onPlaysvideoChange: (next: boolean) => void
  /** 非房主不可修改，仅展示当前状态 */
  disabled?: boolean
}

export function MoviePlaybackSettings({
  showServerProxy,
  serverProxy,
  onServerProxyChange,
  showTranscode,
  playsvideoEnabled,
  onPlaysvideoChange,
  disabled = false,
}: MoviePlaybackSettingsProps) {
  const [expanded, setExpanded] = useState(false)

  if (!showServerProxy && !showTranscode) return null

  // 收起时把当前状态缩成「直连 · 原生」这样的一行摘要，不展开也能看到。
  const summary = [
    showServerProxy ? (serverProxy ? '中转' : '直连') : null,
    showTranscode ? (playsvideoEnabled ? '转码' : '原生') : null,
  ]
    .filter(Boolean)
    .join(' · ')

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
              disabled={disabled}
              onToggle={() => onServerProxyChange(!serverProxy)}
              hint={
                serverProxy
                  ? '媒体流一律经服务器中转，带防盗链的源需要这样才可播放。'
                  : '媒体流直连源站，服务器不转发；带防盗链的源请开启。'
              }
            />
          )}
          {showTranscode && (
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
              disabled={disabled}
              onToggle={() => onPlaysvideoChange(!playsvideoEnabled)}
              hint={
                playsvideoEnabled
                  ? 'MKV/DTS 等非常规格式由浏览器重封装后播放。'
                  : '强制原生直连，浏览器不支持的编码会没有画面或声音。'
              }
            />
          )}
        </div>
      )}
    </div>
  )
}

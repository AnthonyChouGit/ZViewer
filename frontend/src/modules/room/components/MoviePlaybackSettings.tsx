import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { message } from '@/components/ui/message'
import { useRoomStore, type Movie } from '@/store/roomStore'

/** 影片级开关；保存成功后由服务端广播刷新所有成员的列表。 */
export function MoviePlaybackSettings({
  movie,
  canEdit,
}: {
  movie: Movie
  canEdit: boolean
}) {
  const roomId = useRoomStore((state) => state.roomId)
  const updateMovie = useRoomStore((state) => state.updateMovie)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  if (movie.sourceType === 'bilibili') return null

  const toggle = async (key: 'serverProxy' | 'playsvideoEnabled') => {
    if (!canEdit || !roomId || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const enabled =
        key === 'serverProxy'
          ? movie.serverProxy === true
          : movie.playsvideoEnabled !== false
      await updateMovie(roomId, movie.id, { [key]: !enabled })
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新播放设置失败')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const renderToggle = (
    key: 'serverProxy' | 'playsvideoEnabled',
    label: string,
    enabled: boolean
  ) => (
    <Button
      type="button"
      size="sm"
      variant={enabled ? 'primary' : 'secondary'}
      className="h-5 px-1.5 text-[10px] leading-none"
      aria-label={label}
      aria-pressed={enabled}
      aria-busy={saving}
      disabled={!canEdit || !roomId || saving}
      title={`${label}：${enabled ? '已开启' : '已关闭'}${canEdit ? '，点击切换' : ''}`}
      onClick={() => void toggle(key)}
    >
      {label}
    </Button>
  )

  return (
    <div
      className="flex shrink-0 flex-col gap-1"
      role="group"
      aria-label={`${movie.title}的播放设置`}
    >
      {['anime', 'kazumi', 'cms'].includes(movie.sourceType) &&
        renderToggle('serverProxy', '服务器中转', movie.serverProxy === true)}
      {renderToggle(
        'playsvideoEnabled',
        '浏览器转码',
        movie.playsvideoEnabled !== false
      )}
    </div>
  )
}

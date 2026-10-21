/**
 * 运行环境标识：桌面 GUI 壳（ZViewer Desktop）与独立服务端。
 *
 * GUI 壳在拉起后端时注入 `ZVIEWER_DESKTOP=1`。此时整套运行时（后端产物、
 * 前端静态文件、livekit、配置）都在 GUI 分发包内，版本由 GUI 自己按整包
 * 检查并替换；网页管理端若再「检查更新 / 一键更新」，只会替换 runtime/
 * 里的后端产物，导致后端版本与 GUI 壳版本脱节。因此网页端更新入口在
 * 该模式下整体禁用，并提示改用 GUI 的更新功能。
 */

/** 当前后端是否由 ZViewer Desktop 桌面端托管 */
export function isDesktopManaged(): boolean {
  return process.env.ZVIEWER_DESKTOP === '1';
}

/** 桌面端托管时更新入口统一的提示文案 */
export const DESKTOP_UPDATE_HINT =
  '当前由 ZViewer Desktop 桌面端管理，请去 GUI 的更新功能中更新';

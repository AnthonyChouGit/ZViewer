/**
 * OpenList 挂载领域规则（纯搬迁自 routes/openlist.ts）。
 * 路由层只保留参数校验与响应组装；密码规范化与直链模式裁决在此。
 */
import { hashAlistPassword, isAlistHashedPassword } from '../../services/openlist-client';
import { isInternalOpenListServer } from '../../services/openlist';

/**
 * 规范化密码：明文 → AList 哈希格式。
 *
 * 参考 synctv/server/handlers/vendors/vendorAlist/login.go：
 * 后端在保存/使用密码前，将明文密码通过 SHA-256(password + salt) 转为哈希，
 * 与 AList /api/auth/login/hash 端点约定一致。
 *
 * - 若传入空值：原样返回（不哈希）
 * - 若传入已是哈希格式（64 位十六进制）：原样返回（幂等）
 * - 若传入明文：哈希后返回
 *
 * 这样存储层始终保存哈希密码，明文密码不会落盘；
 * 服务层 detectLoginMode 检测到哈希格式后自动走 /api/auth/login/hash 端点。
 */
export function normalizePasswordForStorage(password: string | null | undefined): string | null {
  if (!password) return null;
  // 已是哈希格式（兼容前端可能预先哈希的场景），直接返回
  if (isAlistHashedPassword(password)) return password;
  // 明文密码 → 哈希
  return hashAlistPassword(password);
}

/**
 * 解析 directLink，内网地址强制使用服务器中转。
 *
 * 当 OpenList 服务器为内网/回环地址（127.0.0.1、10.x、172.16-31.x、192.168.x、localhost、::1 等）时，
 * 浏览器无法直接访问其 raw_url 直链，必须强制通过后端 /stream 端点中转。
 *
 * @param serverUrl  规范化后的 OpenList 服务器地址
 * @param directLink 用户请求的 directLink 值
 * @returns 实际生效的 directLink（内网时强制为 false）
 */
export function resolveDirectLinkWithInternalCheck(
  serverUrl: string,
  directLink: boolean,
): boolean {
  if (directLink && isInternalOpenListServer(serverUrl)) {
    return false;
  }
  return directLink;
}

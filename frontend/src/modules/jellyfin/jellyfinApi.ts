/**
 * Jellyfin API 层
 *
 * 路由前缀 /api/jellyfin。Jellyfin 是 Emby 开源分支，接口与 emby 一致——
 * 挂载 CRUD/browse/search/resolve/proxy 全部由 embyLikeApi 工厂生成。
 */
import type {
  JellyfinMount,
  JellyfinMountFormPayload,
  JellyfinTestResult,
  JellyfinDirectoryEntry,
  JellyfinResolvedSource,
} from './types'
import { createEmbyLikeApi } from '../emby/embyLikeApi'

const api = createEmbyLikeApi<
  JellyfinMount,
  JellyfinMountFormPayload,
  JellyfinTestResult,
  JellyfinDirectoryEntry,
  JellyfinResolvedSource
>('jellyfin', 'Jellyfin')

export const getJellyfinMounts = api.getMounts
export const createJellyfinMount = api.createMount
export const updateJellyfinMount = api.updateMount
export const deleteJellyfinMount = api.deleteMount
export const testJellyfinMount = api.testMount
export const browseJellyfinMount = api.browseMount
export const searchJellyfinMount = api.searchMount
export const resolveJellyfin = api.resolve
export const buildJellyfinProxyUrl = api.buildProxyUrl

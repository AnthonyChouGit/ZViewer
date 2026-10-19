/**
 * WebDAV 挂载领域服务（纯搬迁自 routes/webdav.ts）。
 *
 * 路由层只保留参数解析与响应组装；挂载 CRUD 的连通性校验/落库/HTTPS 探测、
 * 文件解析、直链获取、Range 流打开等业务全部在此，便于与 OpenList/FTP/Emby
 * 各源的同类能力对照维护。
 *
 * 早期这里是一个「WebDAV/OpenList 共用路由工厂」，OpenList 改用 AList HTTP API
 * 独立实现后工厂只剩 WebDAV 一个实例，故收敛为单一源服务，行为完全不变。
 */
import type { Readable } from 'node:stream';
import { AppDataSource } from '../../data-source';
import { Movie } from '../../entities/Movie';
import { UserMount } from '../../entities/UserMount';
import {
  extractErrorMessage,
  probeForMountSave,
  resolveDirectLinkWithInternalCheck,
  upgradeDirectUrlValidated,
} from '../shared/mount-utils';
import {
  buildWebDAVDirectUrl,
  createWebDAVReadStreamWithRange,
  listWebDAVDirectory,
  listWebDAVDirectoryCached,
  statWebDAVFile,
  WebDAVError,
  type WebDAVConnectionParams,
  type WebDAVDirectoryEntry,
} from '../../services/webdav';
import { fetchOpenListDirectUrl, OpenListError } from '../../services/openlist';
import { isInternalOpenListServer } from '../../services/openlist-errors';
import { detectMediaFormat } from '../../services/mediaFormat';
import { invalidateUserMountCache, resolveMovieStream } from '../../services/proxy';
import { mapMountErrorCodeToStatus } from '../../utils/stream-response';

/** 挂载类型（UserMount.type 的一个取值） */
export const WEBDAV_MOUNT_TYPE = 'webdav' as const;
/** 日志标签 */
export const WEBDAV_LOG_TAG = 'webdav';
/** 展示名（错误文案用） */
export const WEBDAV_DISPLAY_NAME = 'WebDAV';
/** 代理 URL 前缀（/resolve 返回给前端的相对路径） */
export const WEBDAV_PROXY_PREFIX = '/api/webdav';

/**
 * 可预期的业务失败：status/code 由路由层直接映射为 HTTP 响应。
 * 非此类异常（DB 故障等）由路由层统一按 500/502 处理。
 */
export class WebDAVMountError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'WebDAVMountError';
  }
}

/** WebDAV 挂载的连接参数（不含挂载名等展示字段） */
export interface WebDAVMountInput {
  name?: string;
  serverUrl?: string;
  path?: string;
  username?: string;
  password?: string;
  directLink?: boolean;
}

/** Range 流的打开结果（/proxy 与 /stream 共用） */
export interface WebDAVReadStream {
  stream: Readable;
  fileSize: number;
  start: number;
  end: number;
  ranged: boolean;
}

const userMountRepository = () => AppDataSource.getRepository(UserMount);

/** 从挂载错误中提取错误码（WebDAV 协议 / AList API 两类）。 */
function extractErrorCode(err: unknown): string {
  if (err instanceof WebDAVError) return err.code;
  if (err instanceof OpenListError) return err.code;
  return 'UNREACHABLE';
}

/** 请求体字段（未做类型收敛前的原始值） */
type MountBody = {
  name?: unknown;
  serverUrl?: unknown;
  path?: unknown;
  username?: unknown;
  password?: unknown;
  directLink?: unknown;
};

/** 由请求体构建连接参数（path 缺省为 '/'）。 */
function buildConnectionParams(
  body: MountBody,
  serverUrl: string,
  passwordOverride?: string | null,
): WebDAVConnectionParams {
  const { path, username, password } = body;
  return {
    serverUrl,
    path: typeof path === 'string' && path.trim() ? path.trim() : '/',
    username: typeof username === 'string' && username ? username : undefined,
    password: passwordOverride ?? (typeof password === 'string' && password ? password : undefined),
  };
}

/** 校验并返回 body 中的 serverUrl（去空格）。 */
function requireServerUrl(body: MountBody): string {
  if (typeof body.serverUrl !== 'string' || !body.serverUrl.trim()) {
    throw new WebDAVMountError(400, '服务器地址不能为空', 'INVALID_URL');
  }
  return body.serverUrl.trim();
}

/** 列出当前用户的 WebDAV 挂载（密码字段由路由层剥离）。 */
export async function listMounts(userId: number): Promise<UserMount[]> {
  return userMountRepository().find({
    where: { userId, type: WEBDAV_MOUNT_TYPE },
    order: { createdAt: 'DESC' },
  });
}

/**
 * 测试连接：同时校验挂载 path 可访问性。
 * 只测根目录时 path 填错也能"测试通过"，实际浏览/播放才发现问题。
 */
export async function testMountConnection(body: MountBody): Promise<{ itemCount: number }> {
  const serverUrl = requireServerUrl(body);
  return testConnectivity(buildConnectionParams(body, serverUrl));
}

/** 创建挂载：连通性通过后落库，并返回需要提示给用户的 warning。 */
export async function createMount(
  userId: number,
  body: MountBody,
): Promise<{ mount: UserMount; warning?: string }> {
  const { name, directLink } = body;
  if (typeof name !== 'string' || !name.trim()) {
    throw new WebDAVMountError(400, '挂载名称不能为空');
  }
  const serverUrl = requireServerUrl(body);
  const params = buildConnectionParams(body, serverUrl);

  // 测试连通性（含挂载 path 可访问性）
  await testConnectivity(params);

  const repo = userMountRepository();
  const mount = repo.create({
    type: WEBDAV_MOUNT_TYPE,
    name: name.trim(),
    serverUrl: params.serverUrl,
    path: params.path,
    username: params.username || null,
    password: params.password || null,
    directLink: resolveDirectLinkWithInternalCheck(params.serverUrl, directLink === true),
    userId,
  } as UserMount);
  await repo.save(mount);
  invalidateUserMountCache(mount.id);
  const httpsWarning = await probeForMountSave(mount);

  return { mount, warning: resolveSaveWarning(mount, directLink === true, httpsWarning) };
}

/** 更新挂载：校验归属后重新探测连通性，返回需要提示给用户的 warning。 */
export async function updateMount(
  userId: number,
  mountId: number,
  body: MountBody,
): Promise<{ mount: UserMount; warning?: string }> {
  const repo = userMountRepository();
  const mount = await repo.findOneBy({ id: mountId, userId, type: WEBDAV_MOUNT_TYPE });
  if (!mount) {
    throw new WebDAVMountError(404, '挂载不存在或无权限');
  }

  const { name, directLink, password } = body;
  if (typeof name !== 'string' || !name.trim()) {
    throw new WebDAVMountError(400, '挂载名称不能为空');
  }
  const serverUrl = requireServerUrl(body);
  // 密码未传时沿用已存密码（前端只回显掩码，不会回传真实密码）
  const params = buildConnectionParams(
    body,
    serverUrl,
    typeof password === 'string' ? password || undefined : mount.password || undefined,
  );

  // 测试连通性（含挂载 path 可访问性）
  await testConnectivity(params);

  mount.name = name.trim();
  // serverUrl 变更时重置探测结果（旧值对应旧地址）
  if (mount.serverUrl !== params.serverUrl) mount.httpsDirect = null;
  mount.serverUrl = params.serverUrl;
  mount.path = params.path;
  mount.username = params.username || null;
  if (typeof password === 'string') {
    mount.password = password || null;
  }
  mount.directLink = resolveDirectLinkWithInternalCheck(params.serverUrl, directLink === true);
  await repo.save(mount);
  invalidateUserMountCache(mount.id);
  const httpsWarning = await probeForMountSave(mount);

  return { mount, warning: resolveSaveWarning(mount, directLink === true, httpsWarning) };
}

/** 删除挂载（校验归属）。 */
export async function deleteMount(userId: number, mountId: number): Promise<void> {
  const repo = userMountRepository();
  const mount = await repo.findOneBy({ id: mountId, userId, type: WEBDAV_MOUNT_TYPE });
  if (!mount) {
    throw new WebDAVMountError(404, '挂载不存在或无权限');
  }
  await repo.remove(mount);
  invalidateUserMountCache(mount.id);
}

/** 浏览目录（带 60s 缓存）。 */
export async function browseMount(
  userId: number,
  mountId: number,
  browsePath?: string,
): Promise<WebDAVDirectoryEntry[]> {
  const mount = await requireOwnedMount(userId, mountId);
  const params: WebDAVConnectionParams = {
    serverUrl: mount.serverUrl!,
    path: mount.path || '/',
    username: mount.username || undefined,
    password: mount.password || undefined,
  };
  try {
    return await listWebDAVDirectoryCached(params, mount.id, browsePath);
  } catch (err) {
    throw new WebDAVMountError(
      400,
      extractErrorMessage(err, `浏览 ${WEBDAV_DISPLAY_NAME} 失败`),
      extractErrorCode(err),
    );
  }
}

/**
 * 解析文件，返回 playable 的代理 URL。
 * 使用相对路径，由前端根据当前页面 origin 自动解析，避免反向代理后协议错误。
 */
export async function resolveMountFile(
  userId: number,
  mountId: number,
  targetPath: string,
): Promise<{ title: string; videoUrl: string; format: string; duration: number }> {
  const mount = await requireOwnedMount(userId, mountId);
  const params: WebDAVConnectionParams = {
    serverUrl: mount.serverUrl!,
    path: targetPath,
    username: mount.username || undefined,
    password: mount.password || undefined,
  };
  try {
    const info = await statWebDAVFile(params);
    return {
      title: info.name,
      videoUrl: `${WEBDAV_PROXY_PREFIX}/proxy?mountId=${mountId}&path=${encodeURIComponent(targetPath)}`,
      format: detectMediaFormat(info.name || targetPath),
      duration: 0,
    };
  } catch (err) {
    throw new WebDAVMountError(
      400,
      extractErrorMessage(err, `解析 ${WEBDAV_DISPLAY_NAME} 文件失败`),
      extractErrorCode(err),
    );
  }
}

/**
 * 获取直链（房主添加影片时调用）：先用挂载凭证请求 AList API 拿签名直链，
 * 失败再回退 WebDAV 的 serverUrl+path 拼接。
 */
export async function resolveMountDirectUrl(
  userId: number,
  mountId: number,
  targetPath: string,
): Promise<string> {
  const mount = await requireOwnedMount(userId, mountId);

  // 内网地址拒绝返回直链（浏览器无法访问内网服务器）
  if (isInternalOpenListServer(mount.serverUrl!)) {
    throw new WebDAVMountError(
      400,
      '该挂载为内网地址，无法使用直链模式，请使用服务器转发',
      'INTERNAL_NETWORK_FORBIDDEN',
    );
  }

  // 优先尝试 AList API 获取真实直链（带签名的下载 URL）。
  // 很多用户将 AList 服务器以 WebDAV 类型挂载（AList 同时支持 WebDAV 和 HTTP API）。
  try {
    const alistDirectUrl = await fetchOpenListDirectUrl(
      mount.serverUrl!,
      mount.username || undefined,
      mount.password || undefined,
      targetPath,
    );
    return await upgradeDirectUrlValidated(mount, alistDirectUrl);
  } catch (err) {
    // 明确是 AList 服务器但路径/凭证有问题：直接报错，不回退拼接
    if (err instanceof OpenListError && (err.code === 'NOT_FOUND' || err.code === 'AUTH_FAILED')) {
      throw new WebDAVMountError(mapMountErrorCodeToStatus(err.code, 404), err.message, err.code);
    }
    // UNREACHABLE 等错误：可能不是 AList 服务器，回退到 WebDAV 拼接
  }

  // WebDAV 协议不支持获取真实直链，直接拼接 serverUrl+path
  const rawDirectUrl = buildWebDAVDirectUrl(
    mount.serverUrl!,
    targetPath,
    mount.username || undefined,
    mount.password || undefined,
  );
  // 配置期探测的 HTTPS 能力：源站支持 TLS 时升级 http 直链为 https
  // （升级前现场活性校验，防陈旧缓存产出不可达的 https 直链）
  return upgradeDirectUrlValidated(mount, rawDirectUrl);
}

/**
 * 打开指定挂载文件的 Range 流（/proxy 使用，凭证来自 UserMount）。
 */
export async function openMountStream(
  mount: UserMount,
  targetPath: string,
  rangeHeader?: string,
): Promise<WebDAVReadStream> {
  const params: WebDAVConnectionParams = {
    serverUrl: mount.serverUrl!,
    path: targetPath,
    username: mount.username || undefined,
    password: mount.password || undefined,
  };
  return openRangeStream(params, rangeHeader);
}

/**
 * 打开影片的 Range 流（/stream 使用，凭证来自 Movie + 挂载补全）。
 * 影片不存在/未挂载时抛 StreamMovieError，由路由层统一收尾。
 */
export async function openMovieStream(
  movieId: number,
  rangeHeader?: string,
): Promise<WebDAVReadStream & { movie: Movie }> {
  const { movie, username, password } = await resolveMovieStream(movieId, WEBDAV_MOUNT_TYPE);
  const params: WebDAVConnectionParams = {
    serverUrl: movie.serverUrl!,
    path: movie.path!,
    username,
    password,
  };
  const stream = await openRangeStream(params, rangeHeader);
  return { ...stream, movie };
}

// ── 内部实现 ─────────────────────────────────────

/** 保存挂载后的提示优先级：内网强制中转 > HTTPS 能力警告。 */
function resolveSaveWarning(
  mount: UserMount,
  requestedDirectLink: boolean,
  httpsWarning: string | null,
): string | undefined {
  if (mount.directLink !== requestedDirectLink) {
    return '检测到内网地址，已强制使用服务器中转模式';
  }
  return httpsWarning ?? undefined;
}

/** 查询当前用户指定类型的挂载，并保证 serverUrl 已配置。 */
async function requireOwnedMount(userId: number, mountId: number): Promise<UserMount> {
  const mount = await userMountRepository().findOneBy({
    id: mountId,
    userId,
    type: WEBDAV_MOUNT_TYPE,
  });
  if (!mount) {
    throw new WebDAVMountError(404, '挂载不存在或无权限');
  }
  if (!mount.serverUrl) {
    throw new WebDAVMountError(400, '该挂载未配置服务器地址');
  }
  return mount;
}

/** 建立 WebDAV Range 流，并把协议错误映射为业务错误。 */
async function openRangeStream(
  params: WebDAVConnectionParams,
  rangeHeader?: string,
): Promise<WebDAVReadStream> {
  try {
    return await createWebDAVReadStreamWithRange(params, rangeHeader);
  } catch (err) {
    const code = extractErrorCode(err);
    throw new WebDAVMountError(
      mapMountErrorCodeToStatus(code, 400),
      extractErrorMessage(err, `打开 ${WEBDAV_DISPLAY_NAME} 流失败`),
      code,
    );
  }
}

/** 连通性探测（创建/更新/测试共用同一错误文案与错误码）。 */
async function testConnectivity(params: WebDAVConnectionParams): Promise<{ itemCount: number }> {
  try {
    const entries = await listWebDAVDirectory(params, params.path || '/');
    return { itemCount: entries.length };
  } catch (err) {
    throw new WebDAVMountError(
      400,
      extractErrorMessage(err, `${WEBDAV_DISPLAY_NAME} 不可访问`),
      extractErrorCode(err),
    );
  }
}

/** 将参数对象转为 URL 查询字符串（键与值均已 encodeURIComponent 编码）。 */
export function buildQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

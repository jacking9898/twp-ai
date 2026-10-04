// SPDX-License-Identifier: MPL-2.0
// Keep provider error bodies and request credentials inside the background.
export class AITransportError extends Error {
  constructor(code) { super(code); this.name = 'AITransportError'; this.code = code; }
}
export const REQUEST_TIMEOUT = 180000;

export async function fetchAI(url, options = {}, {fetcher = fetch, headersMs = 25000, bodyMs = 120000} = {}) {
  const controller = new AbortController();
  let timeoutCode, timer;
  const cancel = () => controller.abort(options.signal?.reason);
  const deadline = (ms, code) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timeoutCode = code; controller.abort(); }, ms);
  };
  options.signal?.addEventListener('abort', cancel, {once:true});
  if (options.signal?.aborted) cancel();
  deadline(headersMs, 'headers-timeout');
  try {
    // MV3 bounds the wait for response headers. Models may then send whitespace
    // keep-alives while generating; do not apply that short limit to their body.
    const response = await fetcher(url, {...options, signal:controller.signal, redirect:'error'});
    deadline(bodyMs, 'body-timeout');
    return new Response(await response.text(), {status:response.status, statusText:response.statusText, headers:response.headers});
  } catch (error) {
    if (options.signal?.aborted) throw options.signal.reason || error;
    if (timeoutCode) throw new AITransportError(timeoutCode);
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export function describeAIError(error, signal) {
  if (signal?.aborted) return signal.reason?.name === 'TimeoutError'
    ? 'AI 请求超过 180 秒，请缩短文本或稍后重试'
    : '已取消 AI 请求';
  // SDK retry errors nest the final HTTP/network error in lastError or cause.
  const chain = [], seen = new Set();
  for (let next = error; next && chain.length < 8 && !seen.has(next);) {
    chain.push(next); seen.add(next);
    next = next.lastError || next.cause || next.errors?.at(-1);
  }
  const transport = chain.find(e => e instanceof AITransportError);
  if (transport?.code === 'headers-timeout') return 'AI 服务 25 秒内未返回响应，请检查网络或稍后重试';
  if (transport?.code === 'body-timeout') return 'AI 服务已连接，但生成结果超过 120 秒，请缩短文本或稍后重试';
  const status = chain.find(e => Number.isInteger(e.statusCode) && e.statusCode >= 400)?.statusCode;
  if (status === 401 || status === 403) return `API 密钥无效或没有该模型的访问权限（HTTP ${status}）`;
  if (status === 402) return 'AI 服务账户余额或额度不足（HTTP 402）';
  if (status === 429) return 'API 请求过于频繁或额度不足，请稍后重试（HTTP 429）';
  if (status === 404) return '找不到 API 或模型，请检查地址和模型名称（HTTP 404）';
  if (status === 400 || status === 422) return `AI 服务拒绝了请求参数，请检查模型与接口配置（HTTP ${status}）`;
  if (status === 413) return 'AI 请求内容过长，请缩短文本后重试（HTTP 413）';
  if (status === 408 || status === 504) return `AI 服务响应超时，请稍后重试（HTTP ${status}）`;
  if (status >= 500) return `模型服务暂时不可用，请稍后重试（HTTP ${status}）`;
  if (status) return `AI 服务拒绝了请求（HTTP ${status}），请检查服务配置`;
  if (chain.some(e => ['AI_JSONParseError','AI_TypeValidationError','AI_InvalidResponseDataError','AI_EmptyResponseBodyError'].includes(e.name))) return 'AI 接口返回的数据格式不兼容或为空，请检查接口地址或更换模型';
  return '连接 AI 服务失败，请检查 API 地址、网络或代理后重试';
}

// Only keep the worker awake during an active, bounded request, not at idle.
export function requestLifetime(controller, runtime = globalThis.chrome?.runtime) {
  const timeout = setTimeout(() => controller.abort(new DOMException('AI request deadline', 'TimeoutError')), REQUEST_TIMEOUT);
  const heartbeat = setInterval(() => {
    if (!controller.signal.aborted) void Promise.resolve(runtime?.getPlatformInfo?.()).catch(() => {});
  }, 20000);
  return () => {clearTimeout(timeout); clearInterval(heartbeat);};
}

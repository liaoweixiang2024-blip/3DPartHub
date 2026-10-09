import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

type WebVitalMetric = {
  name: string;
  value: number;
  rating: string;
  delta: number;
  navigationType: string;
  url: string;
  timestamp: number;
};

/** 同一指标在会话内的最小上报间隔：指标是页面体验采样而非逐次统计，连续强刷
 *  会每次触发五个指标上报、撞上服务端 60 次/分钟限流（429 刷屏）。会话内每个
 *  指标 5 分钟最多报一次，采样价值不变、噪声和服务端日志灌水一起消掉。 */
const REPORT_COOLDOWN_MS = 5 * 60 * 1000;

function recentlyReported(name: string): boolean {
  try {
    const key = `wv_reported_${name}`;
    const at = Number(sessionStorage.getItem(key));
    if (Number.isFinite(at) && Date.now() - at < REPORT_COOLDOWN_MS) return true;
    sessionStorage.setItem(key, String(Date.now()));
    return false;
  } catch {
    // 隐私模式等 sessionStorage 不可用：照常上报（有限流兜底）
    return false;
  }
}

function sendMetrics(metric: Metric) {
  if (recentlyReported(metric.name)) return;

  const body: WebVitalMetric = {
    name: metric.name,
    value: Math.round(metric.value),
    rating: metric.rating,
    delta: Math.round(metric.delta),
    navigationType: metric.navigationType ?? 'unknown',
    url: location.href,
    timestamp: Date.now(),
  };

  if (navigator.sendBeacon) {
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
    navigator.sendBeacon('/api/health/web-vitals', blob);
  }
}

export function reportWebVitals() {
  onCLS(sendMetrics);
  onFCP(sendMetrics);
  onINP(sendMetrics);
  onLCP(sendMetrics);
  onTTFB(sendMetrics);
}

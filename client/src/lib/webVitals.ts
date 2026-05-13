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

function sendMetrics(metric: Metric) {
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

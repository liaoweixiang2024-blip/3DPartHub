#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const baseUrl = String(process.env.BASE_URL || "http://localhost:3780").replace(/\/+$/, "");
const scenario = String(process.env.SCENARIO || "browse").toLowerCase();
const concurrency = intEnv("CONCURRENCY", 100, 1, 10000);
const durationSeconds = intEnv("DURATION_SECONDS", 30, 1, 24 * 60 * 60);
const timeoutMs = intEnv("REQUEST_TIMEOUT_MS", 15000, 1000, 10 * 60 * 1000);
const errorBackoffMs = intEnv("ERROR_BACKOFF_MS", 50, 0, 60_000);
const modelId = process.env.MODEL_ID || "";
const downloadFormat = process.env.FORMAT || "original";
const accessToken = process.env.ACCESS_TOKEN || "";
const useDownloadToken = process.env.DOWNLOAD_WITH_TOKEN !== "0";
const noRecord = process.env.NO_RECORD === "1";
const simulateIps = process.env.SIMULATE_IPS === "1";
const selectionSlug = process.env.SELECTION_SLUG || "beize-03-04";
const selectionPageSize = intEnv("SELECTION_PAGE_SIZE", scenario === "selection-filter" ? 80 : 2000, 1, 50000);
const selectionIncludeMatch = process.env.SELECTION_INCLUDE_MATCH === "1";
const selectionFilterField = process.env.SELECTION_FILTER_FIELD || "系列";
const selectionFilterSearch = process.env.SELECTION_FILTER_SEARCH || "";
const selectionFilterSpecs = jsonObjectEnv("SELECTION_FILTER_SPECS", {});
const selectionFilterIncludeItems = process.env.SELECTION_FILTER_INCLUDE_ITEMS === "1";

const browsePaths = [
  "/api/health",
  "/api/settings/public",
  "/api/settings/maintenance-status",
  "/api/models?page=1&page_size=20",
  "/api/search?q=&page=1&page_size=20",
  "/api/selections/categories",
];

const selectionPaths = [
  "/api/selections/categories",
  `/api/selections/categories/${encodeURIComponent(selectionSlug)}`,
  `/api/selections/categories/${encodeURIComponent(selectionSlug)}/products?page=1&page_size=${selectionPageSize}${selectionIncludeMatch ? "" : "&include_match=0"}`,
];

const selectionFilterPath = `/api/selections/categories/${encodeURIComponent(selectionSlug)}/filter`;
const selectionFilterBody = JSON.stringify({
  specs: selectionFilterSpecs,
  field: selectionFilterSearch ? null : selectionFilterField || null,
  search: selectionFilterSearch,
  page: 1,
  pageSize: selectionPageSize,
  includeItems: selectionFilterIncludeItems,
});

const metrics = {
  startedAt: Date.now(),
  requests: 0,
  ok: 0,
  failed: 0,
  bytes: 0,
  latencies: [],
  statuses: new Map(),
  errors: new Map(),
};

function intEnv(name, fallback, min, max) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function jsonObjectEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    console.warn(`${name} is not valid JSON; using default.`);
    return fallback;
  }
}

function pick(items, index) {
  return items[index % items.length];
}

function headers(extra = {}) {
  return {
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...extra,
  };
}

function simulatedIp(index) {
  const host = (index % 250) + 1;
  const subnet = Math.floor(index / 250) % 250;
  return `198.18.${subnet}.${host}`;
}

function record(result) {
  metrics.requests += 1;
  metrics.bytes += result.bytes || 0;
  metrics.latencies.push(result.ms);

  if (result.ok) metrics.ok += 1;
  else metrics.failed += 1;

  const statusKey = result.status ? String(result.status) : "ERR";
  metrics.statuses.set(statusKey, (metrics.statuses.get(statusKey) || 0) + 1);
  if (result.error) {
    metrics.errors.set(result.error, (metrics.errors.get(result.error) || 0) + 1);
  }
}

async function timedFetch(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();

  try {
    const response = await fetch(new URL(path, baseUrl), {
      ...options,
      signal: controller.signal,
      headers: headers(options.headers || {}),
    });
    const body = await response.arrayBuffer();
    record({
      ok: response.ok,
      status: response.status,
      bytes: body.byteLength,
      ms: performance.now() - started,
    });
    return response.ok;
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    record({
      ok: false,
      status: 0,
      bytes: 0,
      ms: performance.now() - started,
      error: name,
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function loadStaticPaths() {
  try {
    const response = await fetch(new URL("/", baseUrl), { headers: headers() });
    const html = await response.text();
    const paths = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g))
      .map((match) => match[1])
      .filter((value) => value.startsWith("/assets/") || value.startsWith("/static/"));
    return paths.length ? Array.from(new Set(paths)) : ["/"];
  } catch {
    return ["/"];
  }
}

async function createDownloadPath() {
  if (!modelId) return null;
  if (!accessToken || !useDownloadToken) {
    return withNoRecord(`/api/models/${encodeURIComponent(modelId)}/download?format=${encodeURIComponent(downloadFormat)}`);
  }

  const response = await fetch(new URL("/api/downloads/model-token", baseUrl), {
    method: "POST",
    headers: headers({ "Content-Type": "application/json" }),
    body: JSON.stringify({ modelId, format: downloadFormat }),
  });
  if (!response.ok) {
    record({ ok: false, status: response.status, bytes: 0, ms: 0, error: "TokenRequestFailed" });
    return null;
  }

  const payload = await response.json();
  return withNoRecord(payload.url || `/api/models/${encodeURIComponent(modelId)}/download?download_token=${encodeURIComponent(payload.token)}`);
}

function withNoRecord(path) {
  if (!noRecord) return path;
  return `${path}${path.includes("?") ? "&" : "?"}no_record=1`;
}

async function worker(id, deadline, staticPaths) {
  let i = id;
  while (Date.now() < deadline) {
    let ok = true;
    const requestHeaders = simulateIps ? { "X-Forwarded-For": simulatedIp(i) } : {};
    if (scenario === "static") {
      ok = await timedFetch(pick(staticPaths, i), { headers: requestHeaders });
    } else if (scenario === "download") {
      const path = await createDownloadPath();
      if (path) ok = await timedFetch(path, { headers: requestHeaders });
      else await sleep(250);
    } else if (scenario === "selection") {
      ok = await timedFetch(pick(selectionPaths, i), { headers: requestHeaders });
    } else if (scenario === "selection-filter") {
      ok = await timedFetch(selectionFilterPath, {
        method: "POST",
        headers: { ...requestHeaders, "Content-Type": "application/json" },
        body: selectionFilterBody,
      });
    } else if (scenario === "mixed") {
      const roll = i % 20;
      if (modelId && roll === 0) {
        const path = await createDownloadPath();
        if (path) ok = await timedFetch(path, { headers: requestHeaders });
      } else if (roll < 6) {
        ok = await timedFetch(pick(staticPaths, i), { headers: requestHeaders });
      } else {
        ok = await timedFetch(pick(browsePaths, i), { headers: requestHeaders });
      }
    } else {
      ok = await timedFetch(pick(browsePaths, i), { headers: requestHeaders });
    }
    if (!ok && errorBackoffMs > 0) await sleep(errorBackoffMs);
    i += concurrency;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function fmtMs(value) {
  return `${value.toFixed(1)}ms`;
}

function printSummary() {
  const elapsedSeconds = (Date.now() - metrics.startedAt) / 1000;
  const sorted = [...metrics.latencies].sort((a, b) => a - b);
  const totalLatency = metrics.latencies.reduce((sum, value) => sum + value, 0);
  const avg = metrics.latencies.length ? totalLatency / metrics.latencies.length : 0;
  const statusText = Array.from(metrics.statuses.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}:${count}`)
    .join(" ");
  const errorText = Array.from(metrics.errors.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name}:${count}`)
    .join(" ");

  console.log("");
  console.log("Load test summary");
  console.log(`  base:        ${baseUrl}`);
  console.log(`  scenario:    ${scenario}`);
  console.log(`  concurrency: ${concurrency}`);
  console.log(`  duration:    ${elapsedSeconds.toFixed(1)}s`);
  console.log(`  requests:    ${metrics.requests}`);
  console.log(`  ok/failed:   ${metrics.ok}/${metrics.failed}`);
  console.log(`  rps:         ${(metrics.requests / Math.max(1, elapsedSeconds)).toFixed(1)}`);
  console.log(`  throughput:  ${(metrics.bytes / 1024 / 1024 / Math.max(1, elapsedSeconds)).toFixed(2)} MiB/s`);
  console.log(`  latency:     avg=${fmtMs(avg)} p50=${fmtMs(percentile(sorted, 50))} p90=${fmtMs(percentile(sorted, 90))} p95=${fmtMs(percentile(sorted, 95))} p99=${fmtMs(percentile(sorted, 99))} max=${fmtMs(sorted.at(-1) || 0)}`);
  console.log(`  statuses:    ${statusText || "-"}`);
  if (errorText) console.log(`  errors:      ${errorText}`);
}

if (!["browse", "static", "download", "mixed", "selection", "selection-filter"].includes(scenario)) {
  console.error("SCENARIO must be one of: browse, static, download, mixed, selection, selection-filter");
  process.exit(2);
}

if ((scenario === "download" || scenario === "mixed") && !modelId) {
  console.warn("MODEL_ID is not set; download traffic will be skipped.");
}

const staticPaths = await loadStaticPaths();
const deadline = Date.now() + durationSeconds * 1000;
await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index, deadline, staticPaths)));
printSummary();

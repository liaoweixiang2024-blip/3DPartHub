// 构建期由 vite define 注入（vite.config.ts，来自 VITE_APP_VERSION）。
// dev / 未带版本的本地构建注入空字符串 —— UpdateBanner 检测逻辑据此自禁用。
declare const __APP_VERSION__: string;

import { getAccessToken } from "../stores";

export function withAccessToken(url?: string | null): string {
  if (!url) return "";
  if (/^(blob:|data:)/i.test(url)) return url;

  const token = getAccessToken();
  if (!token) return url;

  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== window.location.origin) return url;
    parsed.searchParams.set("token", token);
    return url.startsWith("http")
      ? parsed.toString()
      : `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

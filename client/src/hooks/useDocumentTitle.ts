import { useEffect, useState } from "react";
import { getBrowserTitle, onSiteConfigChange } from "../lib/publicSettings";

export function useDocumentTitle(title?: string) {
  const [ver, bump] = useState(0);
  useEffect(() => {
    return onSiteConfigChange(() => bump(n => n + 1));
  }, []);
  useEffect(() => {
    const base = getBrowserTitle();
    document.title = title ? `${title} — ${base}` : base;
  }, [title, ver]);
}

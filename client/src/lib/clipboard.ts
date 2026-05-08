export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea copy path for browsers that block Clipboard API.
    }
  }

  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  ta.style.top = '0';
  ta.style.opacity = '0';
  ta.style.fontSize = '16px';
  ta.style.pointerEvents = 'none';
  ta.setAttribute('readonly', '');
  document.body.appendChild(ta);
  ta.focus({ preventScroll: true });
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  const copied = document.execCommand('copy');
  document.body.removeChild(ta);

  if (!copied) throw new Error('copy failed');
}

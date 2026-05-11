# Mobile Theme Packages

Mobile themes are intentionally separate from desktop interface themes.

Each mobile theme owns:

- bottom navigation appearance
- mobile drawer appearance
- mobile home behavior such as list loading mode and `data-home-theme`

The default mobile theme is `classic`, so all desktop interface themes keep the same mobile experience until a new mobile theme is explicitly added and selected.

New mobile themes should live under `src/themes/mobileThemes/<theme-key>/` with:

```text
index.ts
manifest.ts
theme.ts
layouts/
tokens/
```

Do not import from another mobile theme package. Shared mobile renderers belong in `src/themes/mobileThemes/shared/`.

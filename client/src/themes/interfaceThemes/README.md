# Interface Theme Contract

This directory follows a CMS-style theme package contract. Treat each theme folder like a small WordPress theme: it owns its manifest, templates, layout chrome, theme-only components, design tokens, and optional CSS.

## Theme Package Shape

Every theme must live at `src/themes/interfaceThemes/<theme-key>/` and include:

```text
<theme-key>/
  manifest.ts
  theme.ts
  index.ts
  layouts/
    TopNav.tsx
    Sidebar.tsx
    BottomNav.tsx
    MobileNavDrawer.tsx
  templates/
    HomeDesktop.tsx
    Login.tsx
    NotFound.tsx
  components/
    ...
  tokens/
    appearance.ts
  styles.css          optional, imported only by theme.ts
```

`index.ts` must only re-export `./theme`. The application loads theme packages through the central registry; it should not import an individual theme file directly.

## Required Files

`manifest.ts`

- Contains theme metadata: key, label, settings label, description, author, version, capabilities.
- The `key` must match the folder name and `InterfaceThemeKey`.
- The catalog imports manifests. Do not duplicate manifest data in `catalog.ts`.
- `capabilities` must use `InterfaceThemeCapability` values, so theme features stay searchable and type-checked.

`theme.ts`

- Is the only assembly point for a theme package.
- Must export an `InterfaceThemePackage` with `manifest`, `home`, `chrome`, `templates`, and `components`.
- Imports `styles.css` when the theme has theme-owned CSS.

`layouts/`

- Owns shell-level UI such as desktop top navigation, sidebars, mobile bottom navigation, and mobile drawers.
- Layout components may use shared renderers from `../shared` only through stable renderer contracts.

`templates/`

- Owns page-level theme templates. Required templates are `DesktopHome`, `Login`, and `NotFound`.
- Templates receive data and actions from the page/controller layer; they should not refetch page data unless it is purely presentational site config.
- Templates must not import from `pages/`. Shared home contracts live in `shared/homeTypes.ts` and shared home renderers live in `shared/HomeDesktopShared.tsx`.

`components/`

- Holds components that belong to exactly one theme.
- If a component name contains a theme name, it belongs here, not in `pages/` or global shared components.

`tokens/`

- Holds theme visual configuration, class maps, and renderer appearances.
- Tokens should not import application pages.

`styles.css`

- Optional.
- Must be imported from that theme's `theme.ts`.
- Theme selectors must be scoped with `[data-interface-theme='<theme-key>']` or `[data-home-theme='<theme-key>']`.
- Theme-specific selectors must not be placed in `styles/global.css`.

## Core Layer Rules

Core application files may select the active theme package, but must not know theme-specific behavior.

Allowed:

- `getInterfaceThemePackage(settings?.interface_theme)`
- `ThemePackage.manifest.key`
- `ThemePackage.chrome...`
- `ThemePackage.templates...`
- `ThemePackage.components...`

Forbidden in core files:

- `interfaceTheme === 'workbench'`
- `interfaceTheme !== 'classic'`
- `isWorkbenchTheme`, `isClassicTheme`
- `ThemePackage.meta`
- `ThemePackage.components.DesktopHome`
- `INTERFACE_THEME_COMPONENTS`
- theme-specific selectors in `styles/global.css`

If behavior differs by theme, add a typed field to `InterfaceThemePackage` and let each theme define the behavior in `theme.ts`.

## Color Token Rules

- Every color preset must provide the full `COLOR_KEYS` set in both dark and light modes.
- Surface tokens are part of the preset contract, including `surface-tint`, every `surface-container-*` level, `surface-variant`, `on-surface`, and `on-background`.
- New themed `.tsx` and `.css` files should use CSS variables such as `var(--color-surface-container-lowest)` or semantic aliases such as `var(--color-destructive)`.
- Hard-coded colors are allowed only for documented exceptions such as base token definitions, 3D viewer material defaults, print templates, and editable settings templates.

## Adding A Theme

1. Add the key to `InterfaceThemeKey`.
2. Create the full theme folder structure.
3. Add `manifest.ts` and register the manifest in `catalog.ts`.
4. Add `theme.ts` and register the package in `registry.ts`.
5. Implement all required layout components and templates.
6. Put theme-only CSS in the theme folder.
7. Run `npm run verify:themes`, then the normal client checks.

## Shared Renderer Rule

The `shared/` folder in this theme system is not a theme. It contains stable renderer primitives used by multiple themes. Shared renderers must be appearance-driven and must not contain hard-coded `workbench` or `classic` behavior.

Page/controller files may import shared theme contracts, but theme packages must not import page-layer files. This keeps the dependency direction as `pages -> theme registry/shared contracts -> active theme`, never `theme -> pages`.

## Verification

Run:

```bash
npm run verify:themes
```

This checks the CMS-style folder shape, required files, theme package assembly, no cross-theme imports, and no hard-coded theme branching in core files.

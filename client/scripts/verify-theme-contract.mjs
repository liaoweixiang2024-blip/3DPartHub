import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(scriptDir, '..');
const srcRoot = path.join(clientRoot, 'src');
const themesRoot = path.join(srcRoot, 'themes/interfaceThemes');

const errors = [];
const themeKeys = await discoverThemeKeys();
const requiredThemeFiles = [
  'index.ts',
  'manifest.ts',
  'theme.ts',
  'layouts/TopNav.tsx',
  'layouts/Sidebar.tsx',
  'layouts/BottomNav.tsx',
  'layouts/MobileNavDrawer.tsx',
  'templates/HomeDesktop.tsx',
  'templates/Login.tsx',
  'templates/NotFound.tsx',
  'tokens/appearance.ts',
];
const allowedRootEntries = new Set([
  'components',
  'index.ts',
  'layouts',
  'manifest.ts',
  'styles.css',
  'templates',
  'theme.ts',
  'tokens',
]);
const coreFiles = [
  'components/shared/AdminPageShell.tsx',
  'components/shared/PublicPageShell.tsx',
  'components/shared/TopNav.tsx',
  'pages/HomePage.tsx',
  'router.tsx',
];
const requiredColorVariableKeys = [
  'surface-tint',
  'surface',
  'surface-dim',
  'surface-container-lowest',
  'surface-container-low',
  'surface-container',
  'surface-container-high',
  'surface-container-highest',
  'surface-bright',
  'surface-variant',
  'on-surface',
  'on-background',
  'on-surface-variant',
  'primary',
  'primary-container',
  'on-primary',
  'on-primary-container',
  'secondary',
  'secondary-container',
  'on-secondary',
  'on-secondary-container',
  'tertiary',
  'tertiary-container',
  'on-tertiary',
  'on-tertiary-container',
  'error',
  'error-container',
  'outline',
  'outline-variant',
];
const hardcodedColorAllowedPaths = [
  'styles/global.css',
  'components/settings/ColorSchemeSettings.tsx',
  'pages/SettingsPage.tsx',
];
const hardcodedColorPattern = /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/g;
const allowedThemePackageImports = new Set(['react', 'react-router-dom', 'framer-motion']);
const allowedThemeAppImports = new Set([
  '../../../../components/shared/Icon',
  '../../../../components/shared/InfiniteLoadTrigger',
  '../../../../components/shared/ModelThumbnail',
  '../../../../components/shared/PagePrimitives',
  '../../../../components/shared/Pagination',
  '../../../../components/shared/SearchField',
  '../../../../components/shared/Tooltip',
  '../../../../components/shared/VirtualProductGrid',
  '../../../../lib/businessConfig',
  '../../../../lib/routeLoaders',
]);

function srcPath(relativePath) {
  return path.join(srcRoot, relativePath);
}

function rel(filePath) {
  return path.relative(clientRoot, filePath).split(path.sep).join('/');
}

async function readSrc(relativePath) {
  return readFile(srcPath(relativePath), 'utf8');
}

async function listFiles(dir) {
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const info = await stat(fullPath);
    if (info.isDirectory()) {
      files.push(...(await listFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function discoverThemeKeys() {
  const entries = await readdir(themesRoot, { withFileTypes: true });
  const keys = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(path.join(themesRoot, name, 'manifest.ts')))
    .sort();
  if (keys.length === 0) {
    errors.push(`No interface themes found under ${rel(themesRoot)}.`);
  }
  return keys;
}

function assert(condition, message) {
  if (!condition) errors.push(message);
}

function assertIncludes(label, source, snippet) {
  assert(source.includes(snippet), `${label} must include: ${snippet}`);
}

function assertColorKeyUsage(label, source, key) {
  const quotedKey = `'${key}'`;
  const bareKey = `${key}:`;
  assert(source.includes(quotedKey) || source.includes(bareKey), `${label} must include color key: ${key}`);
}

function isHardcodedColorAllowed(relativeSrcPath) {
  return hardcodedColorAllowedPaths.some((allowedPath) =>
    allowedPath.endsWith('/') ? relativeSrcPath.startsWith(allowedPath) : relativeSrcPath === allowedPath,
  );
}

function extractImportSpecifiers(source) {
  const specifiers = new Set();
  for (const pattern of [/from\s+['"]([^'"]+)['"]/g, /import\s+['"]([^'"]+)['"]/g]) {
    let match;
    while ((match = pattern.exec(source))) {
      specifiers.add(match[1]);
    }
  }
  return [...specifiers];
}

function isAllowedThemeImport(specifier) {
  if (!specifier.startsWith('.')) {
    return allowedThemePackageImports.has(specifier);
  }
  if (specifier.startsWith('./')) return true;
  if (specifier === '../types' || specifier === '../../types') return true;
  if (specifier.startsWith('../components/') || specifier.startsWith('../layouts/')) return true;
  if (specifier.startsWith('../templates/') || specifier.startsWith('../tokens/')) return true;
  if (specifier.startsWith('../../shared/')) return true;
  return allowedThemeAppImports.has(specifier);
}

for (const themeKey of themeKeys) {
  const themeRoot = path.join(themesRoot, themeKey);
  assert(existsSync(themeRoot), `Theme directory is missing: ${rel(themeRoot)}`);

  for (const file of requiredThemeFiles) {
    const fullPath = path.join(themeRoot, file);
    assert(existsSync(fullPath), `${themeKey} theme is missing required file: ${file}`);
  }

  if (existsSync(themeRoot)) {
    const rootEntries = await readdir(themeRoot);
    for (const entry of rootEntries) {
      assert(
        allowedRootEntries.has(entry),
        `${themeKey} theme root contains non-standard entry "${entry}". Use manifest/theme/layouts/templates/components/tokens/styles.css.`,
      );
    }
  }

  const indexSource = await readFile(path.join(themeRoot, 'index.ts'), 'utf8');
  assert(
    /^export \{ default \} from '\.\/theme';\s*$/m.test(indexSource.trim()),
    `${themeKey}/index.ts must only re-export ./theme.`,
  );

  const manifestSource = await readFile(path.join(themeRoot, 'manifest.ts'), 'utf8');
  assertIncludes(`${themeKey}/manifest.ts`, manifestSource, `key: '${themeKey}'`);
  assertIncludes(`${themeKey}/manifest.ts`, manifestSource, 'capabilities:');

  const themeSource = await readFile(path.join(themeRoot, 'theme.ts'), 'utf8');
  for (const section of ['manifest:', 'home:', 'chrome:', 'templates:', 'components:']) {
    assertIncludes(`${themeKey}/theme.ts`, themeSource, section);
  }
  assertIncludes(`${themeKey}/theme.ts`, themeSource, 'listLoadingMode:');
  assertIncludes(`${themeKey}/theme.ts`, themeSource, 'showModelCardCategory:');
  assertIncludes(`${themeKey}/theme.ts`, themeSource, 'showModelCardVariantMeta:');
  assertIncludes(`${themeKey}/theme.ts`, themeSource, 'defaultPath:');
  for (const slot of ['DesktopHome', 'Login', 'NotFound', 'DesktopTopNav', 'Sidebar', 'BottomNav', 'MobileNavDrawer']) {
    assertIncludes(`${themeKey}/theme.ts`, themeSource, slot);
  }

  const homeTemplateSource = await readFile(path.join(themeRoot, 'templates/HomeDesktop.tsx'), 'utf8');
  assertIncludes(`${themeKey}/templates/HomeDesktop.tsx`, homeTemplateSource, `data-home-theme="${themeKey}"`);

  const themeFiles = await listFiles(themeRoot);
  for (const filePath of themeFiles) {
    const source = await readFile(filePath, 'utf8');
    const relativeThemeFile = rel(filePath);
    for (const specifier of extractImportSpecifiers(source)) {
      assert(
        isAllowedThemeImport(specifier),
        `${relativeThemeFile} imports "${specifier}" outside the theme sandbox. Use theme shared contracts or add a documented whitelist entry.`,
      );
    }
    for (const otherTheme of themeKeys.filter((key) => key !== themeKey)) {
      assert(
        !source.includes(`../${otherTheme}`) && !source.includes(`/${otherTheme}/`),
        `${relativeThemeFile} must not import or reference the ${otherTheme} theme package.`,
      );
    }
    assert(
      !/from\s+['"][^'"]*\/pages\//.test(source),
      `${relativeThemeFile} must not import pages/ layer files. Move shared contracts into themes/interfaceThemes/shared.`,
    );
    if (relativeThemeFile.includes('/templates/')) {
      assert(
        !/from\s+['"][^'"]*\/lib\/(?:publicSettings|homeSearchState)/.test(source),
        `${relativeThemeFile} must receive page data through template props instead of importing publicSettings/homeSearchState.`,
      );
    }
  }

  const stylesPath = path.join(themeRoot, 'styles.css');
  if (existsSync(stylesPath)) {
    assertIncludes(`${themeKey}/theme.ts`, themeSource, "import './styles.css';");
  }
}

const workbenchSidebarSource = await readSrc('themes/interfaceThemes/workbench/layouts/Sidebar.tsx');
assertIncludes('workbench Sidebar admin route menu isolation', workbenchSidebarSource, 'adminRouteMode="admin-only"');
const workbenchTopNavSource = await readSrc('themes/interfaceThemes/workbench/layouts/TopNav.tsx');
assert(
  !/adminEntryPath|后台管理|adminOpen|adminRef|adminActive/.test(workbenchTopNavSource),
  'workbench TopNav must keep admin navigation out of the public header; admin routes use the sidebar instead.',
);

const catalogSource = await readSrc('themes/interfaceThemes/catalog.ts');
for (const themeKey of themeKeys) {
  assertIncludes('catalog.ts', catalogSource, `${themeKey}ThemeManifest`);
}
assertIncludes('catalog.ts generic theme normalization', catalogSource, 'function isInterfaceThemeKey');
assertIncludes(
  'catalog.ts generic theme normalization',
  catalogSource,
  'Object.prototype.hasOwnProperty.call(INTERFACE_THEME_CATALOG, value)',
);
assert(
  !/value\s*={2,3}\s*['"]classic['"]/.test(catalogSource),
  'catalog.ts normalizeInterfaceTheme must not hard-code classic; check INTERFACE_THEME_CATALOG keys instead.',
);

const registrySource = await readSrc('themes/interfaceThemes/registry.ts');
assertIncludes('registry.ts', registrySource, 'INTERFACE_THEME_PACKAGES');
assert(
  !registrySource.includes('INTERFACE_THEME_COMPONENTS'),
  'registry.ts must expose packages as the primary API. Do not add a parallel component-only registry.',
);

const floatingMenuRendererSource = await readSrc('themes/interfaceThemes/shared/FloatingMenuRenderer.tsx');
assertIncludes('FloatingMenuRenderer.tsx contact props', floatingMenuRendererSource, 'contactEmail =');
assertIncludes('FloatingMenuRenderer.tsx contact props', floatingMenuRendererSource, 'contactPhone =');
assertIncludes('FloatingMenuRenderer.tsx contact props', floatingMenuRendererSource, 'contactAddress =');
assert(
  !/publicSettings|getCachedPublicSettings|getContactEmail|getContactPhone|getContactAddress|useSWR/.test(
    floatingMenuRendererSource,
  ),
  'FloatingMenuRenderer.tsx must receive contact data through props instead of reading publicSettings at runtime.',
);

const forbiddenCorePatterns = [
  { pattern: /interfaceTheme\s*[!=]==/g, label: 'theme-key conditional' },
  { pattern: /\bisWorkbench\b|\bisClassic\b/g, label: 'theme-specific boolean' },
  { pattern: /ThemePackage\.meta/g, label: 'legacy ThemePackage.meta access' },
  { pattern: /components\.DesktopHome/g, label: 'desktop home template under components' },
  { pattern: /INTERFACE_THEME_COMPONENTS/g, label: 'component-only theme registry' },
];

for (const file of coreFiles) {
  const source = await readSrc(file);
  for (const { pattern, label } of forbiddenCorePatterns) {
    if (pattern.test(source)) {
      errors.push(`${file} contains forbidden ${label}; use ThemePackage.chrome/templates/components instead.`);
    }
    pattern.lastIndex = 0;
  }
}

const globalCssSource = await readSrc('styles/global.css');
const colorSchemesSource = await readSrc('lib/colorSchemes.ts');
const colorSchemeSource = await readSrc('lib/colorScheme.ts');

for (const key of requiredColorVariableKeys) {
  assertIncludes('global.css color variables', globalCssSource, `--color-${key}:`);
  assertIncludes('colorSchemes.ts COLOR_KEYS', colorSchemesSource, `'${key}'`);
  assertColorKeyUsage('colorScheme.ts generatePaletteFromPrimary', colorSchemeSource, key);
}

assertIncludes('colorSchemes.ts ColorPreset completeness', colorSchemesSource, 'dark: Record<ColorKey, string>;');
assertIncludes('colorSchemes.ts ColorPreset completeness', colorSchemesSource, 'light: Record<ColorKey, string>;');
assertIncludes('colorSchemes.ts surface hex generation', colorSchemesSource, 'function hslToHex');
assert(
  !/[`'"]hsl\(/.test(colorSchemesSource),
  'colorSchemes.ts must not emit hsl() strings because SettingsPage color inputs require #hex values.',
);
assert(
  !/[`'"]hsl\(/.test(colorSchemeSource),
  'colorScheme.ts custom palette generation must emit #hex values because SettingsPage color inputs require #hex values.',
);
assertIncludes('colorScheme.ts custom palette completeness', colorSchemeSource, 'dark: Record<ColorKey, string>;');
assertIncludes('colorScheme.ts custom palette completeness', colorSchemeSource, 'light: Record<ColorKey, string>;');

for (const pattern of [
  /data-interface-theme=['"](workbench|classic)['"]/,
  /home-page-desktop\[data-home-theme=/,
  /home-workbench/,
  /workbench-page-content/,
]) {
  assert(!pattern.test(globalCssSource), `styles/global.css contains theme-specific selector: ${pattern}`);
}

for (const filePath of await listFiles(srcRoot)) {
  if (!/\.(tsx|css)$/.test(filePath)) continue;

  const relativeSrcPath = path.relative(srcRoot, filePath).split(path.sep).join('/');
  if (isHardcodedColorAllowed(relativeSrcPath)) continue;

  const source = await readFile(filePath, 'utf8');
  const matches = source.match(hardcodedColorPattern);
  if (matches) {
    errors.push(
      `${relativeSrcPath} contains hardcoded color "${matches[0]}"; use CSS variables or add a documented exception.`,
    );
  }
}

if (errors.length > 0) {
  console.error('Theme contract verification failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Theme contract verification passed.');

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(scriptDir, '..');
const themesRoot = path.join(clientRoot, 'src/themes/interfaceThemes');

function usage() {
  console.log('Usage: npm run create-theme -- --key my-theme --label "我的主题"');
}

function readArgs() {
  const args = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) continue;
    options[arg.slice(2)] = args[i + 1];
    i += 1;
  }
  return options;
}

function toPascalCase(value) {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join('');
}

function assertThemeKey(value) {
  if (!value || !/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new Error(
      'Theme key must use kebab-case, start with a letter, and contain only lowercase letters, numbers, or "-".',
    );
  }
}

async function writeThemeFile(themeRoot, relativePath, content) {
  const filePath = path.join(themeRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content.trimStart());
}

const options = readArgs();
const themeKey = options.key;
const label = options.label || themeKey;
const pascalName = toPascalCase(themeKey || '');

try {
  assertThemeKey(themeKey);
  const themeRoot = path.join(themesRoot, themeKey);
  await mkdir(themeRoot, { recursive: false });

  await writeThemeFile(
    themeRoot,
    'index.ts',
    `
export { default } from './theme';
`,
  );

  await writeThemeFile(
    themeRoot,
    'manifest.ts',
    `
import type { InterfaceThemeMeta } from '../types';

export const ${pascalName}ThemeManifest: InterfaceThemeMeta = {
  key: '${themeKey}',
  label: '${label}',
  settingsLabel: '${label}',
  description: '自定义界面主题。',
  author: '3DPartHub',
  version: '1.0.0',
  capabilities: [
    'desktop-top-nav',
    'desktop-home-template',
    'login-template',
    'not-found-template',
    'sidebar',
    'mobile-bottom-nav',
    'mobile-drawer',
  ],
};
`,
  );

  await writeThemeFile(
    themeRoot,
    'theme.ts',
    `
import type { InterfaceThemePackage } from '../types';
import BottomNav from './layouts/BottomNav';
import MobileNavDrawer from './layouts/MobileNavDrawer';
import Sidebar from './layouts/Sidebar';
import TopNav from './layouts/TopNav';
import { ${pascalName}ThemeManifest } from './manifest';
import HomeDesktop from './templates/HomeDesktop';
import Login from './templates/Login';
import NotFound from './templates/NotFound';
import './styles.css';

const ${pascalName}Theme: InterfaceThemePackage = {
  manifest: ${pascalName}ThemeManifest,
  home: {
    listLoadingMode: 'pagination',
    showModelCardCategory: false,
    showModelCardVariantMeta: false,
  },
  chrome: {
    desktopSearch: {
      placement: 'toolbar',
    },
    adminLayout: {
      defaultPath: () => '/admin/models',
      showDesktopSidebar: () => true,
    },
    publicLayout: {
      showDesktopHomeFooter: () => true,
      showDesktopFloatingMenu: () => false,
    },
  },
  templates: {
    DesktopHome: HomeDesktop,
    Login,
    NotFound,
  },
  components: {
    DesktopTopNav: TopNav,
    Sidebar,
    BottomNav,
    MobileNavDrawer,
  },
};

export default ${pascalName}Theme;
`,
  );

  await writeThemeFile(
    themeRoot,
    'layouts/TopNav.tsx',
    `
import type { DesktopTopNavThemeProps } from '../../types';

export default function TopNav({ renderBrand, renderSearch, tools }: DesktopTopNavThemeProps) {
  return (
    <header className="${themeKey}-top-nav">
      {renderBrand('')}
      {renderSearch('')}
      {tools}
    </header>
  );
}
`,
  );

  await writeThemeFile(
    themeRoot,
    'layouts/Sidebar.tsx',
    `
import SidebarRenderer from '../../shared/SidebarRenderer';
import { ${pascalName}SidebarAppearance } from '../tokens/appearance';

export default function Sidebar() {
  return <SidebarRenderer appearance={${pascalName}SidebarAppearance} />;
}
`,
  );

  await writeThemeFile(
    themeRoot,
    'layouts/BottomNav.tsx',
    `
import BottomNavRenderer from '../../shared/BottomNavRenderer';
import { ${pascalName}BottomNavAppearance } from '../tokens/appearance';

export default function BottomNav() {
  return <BottomNavRenderer appearance={${pascalName}BottomNavAppearance} />;
}
`,
  );

  await writeThemeFile(
    themeRoot,
    'layouts/MobileNavDrawer.tsx',
    `
import MobileNavDrawerRenderer from '../../shared/MobileNavDrawerRenderer';
import type { MobileNavDrawerThemeProps } from '../../types';
import { ${pascalName}MobileDrawerAppearance } from '../tokens/appearance';

export default function MobileNavDrawer(props: MobileNavDrawerThemeProps) {
  return <MobileNavDrawerRenderer appearance={${pascalName}MobileDrawerAppearance} {...props} />;
}
`,
  );

  await writeThemeFile(
    themeRoot,
    'templates/HomeDesktop.tsx',
    `
import type { DesktopHomeThemeProps } from '../../types';

export default function HomeDesktop({ renderProductCard, products }: DesktopHomeThemeProps) {
  return (
    <div className="home-page-desktop ${themeKey}-home" data-home-theme="${themeKey}">
      {products.map((product, index) => renderProductCard(product, index))}
    </div>
  );
}
`,
  );

  await writeThemeFile(
    themeRoot,
    'templates/Login.tsx',
    `
import type { LoginThemeProps } from '../../types';

export default function Login({ brand, title, subtitle, form, modeSwitch, legalLinks, backLink }: LoginThemeProps) {
  return (
    <div className="${themeKey}-login">
      {brand}
      {title}
      {subtitle}
      {form}
      {modeSwitch}
      {legalLinks}
      {backLink}
    </div>
  );
}
`,
  );

  await writeThemeFile(
    themeRoot,
    'templates/NotFound.tsx',
    `
import type { NotFoundThemeProps } from '../../types';

export default function NotFound({ brand, title, description, homeLink }: NotFoundThemeProps) {
  return (
    <div className="${themeKey}-not-found">
      {brand}
      {title}
      {description}
      {homeLink}
    </div>
  );
}
`,
  );

  await writeThemeFile(
    themeRoot,
    'tokens/appearance.ts',
    `
import type { BottomNavAppearance } from '../../shared/BottomNavRenderer';
import type { MobileNavDrawerAppearance } from '../../shared/MobileNavDrawerRenderer';
import type { SidebarAppearance } from '../../shared/SidebarRenderer';

export const ${pascalName}SidebarAppearance: SidebarAppearance = {
  rootClassName: '${themeKey}-sidebar',
  navClassName: '${themeKey}-sidebar-nav',
  topFadeWrapperClassName: () => 'hidden',
  topFadeClassName: 'hidden',
  bottomFadeWrapperClassName: () => 'hidden',
  bottomFadeClassName: 'hidden',
  sectionWrapperClassName: '${themeKey}-sidebar-section',
  sectionLabelClassName: '${themeKey}-sidebar-section-label',
  sectionLineClassName: '${themeKey}-sidebar-section-line',
  itemClassName: (active) => \`${themeKey}-sidebar-item \${active ? '${themeKey}-sidebar-item-active' : ''}\`,
  itemLabelClassName: '${themeKey}-sidebar-item-label',
  footerWrapperClassName: '${themeKey}-sidebar-footer',
  footerButtonClassName: '${themeKey}-sidebar-footer-button',
  iconSize: 20,
};

export const ${pascalName}BottomNavAppearance: BottomNavAppearance = {
  rootClassName: '${themeKey}-bottom-nav',
  linkClassName: (active) => \`${themeKey}-bottom-nav-link \${active ? '${themeKey}-bottom-nav-link-active' : ''}\`,
  labelClassName: () => '${themeKey}-bottom-nav-label',
  iconSize: 20,
};

export const ${pascalName}MobileDrawerAppearance: MobileNavDrawerAppearance = {
  overlayClassName: '${themeKey}-mobile-drawer-overlay',
  sheetClassName: '${themeKey}-mobile-drawer-sheet',
  headerClassName: '${themeKey}-mobile-drawer-header',
  titleClassName: '${themeKey}-mobile-drawer-title',
  closeButtonClassName: '${themeKey}-mobile-drawer-close',
  navClassName: '${themeKey}-mobile-drawer-nav',
  itemClassName: (active) => \`${themeKey}-mobile-drawer-item \${active ? '${themeKey}-mobile-drawer-item-active' : ''}\`,
  footerClassName: '${themeKey}-mobile-drawer-footer',
  footerLinkClassName: '${themeKey}-mobile-drawer-footer-link',
  iconSize: 20,
};
`,
  );

  await writeThemeFile(
    themeRoot,
    'styles.css',
    `
[data-interface-theme='${themeKey}'] {
  --${themeKey}-placeholder: 1;
}
`,
  );

  console.log(`Created interface theme scaffold: ${path.relative(clientRoot, themeRoot)}`);
  console.log('Next steps: register the theme in types.ts, catalog.ts, registry.ts, then run npm run verify:themes.');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  usage();
  process.exit(1);
}

import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(scriptDir, '..');
const srcRoot = path.join(clientRoot, 'src');

const deletedLoadingComponents = [
  'components/shared/LoadingSpinner.tsx',
  'components/shared/Skeleton.tsx',
  'components/shared/SelectionPageSkeleton.tsx',
];

const skeletonAllowedFiles = new Set([
  'pages/HomePage.tsx',
  'pages/ModelDetailPage.tsx',
  'components/shared/ModelDetailPageSkeleton.tsx',
  'router.tsx',
]);

const errors = [];

async function listSourceFiles(dir) {
  const entries = await readdir(dir);
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const info = await stat(fullPath);
    if (info.isDirectory()) {
      files.push(...(await listSourceFiles(fullPath)));
      continue;
    }
    if (/\.(tsx?|css)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

function toSrcRelative(filePath) {
  return path.relative(srcRoot, filePath).split(path.sep).join('/');
}

function verifyLoadingStateFunctions(source, relativePath) {
  if (!/\.(tsx?|jsx?)$/.test(relativePath)) return;

  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text.endsWith('LoadingState')) {
      const bodySource = node.getText(sourceFile);
      if (
        !bodySource.includes('PageRefreshIndicator') &&
        !bodySource.includes('PageRefreshFallback') &&
        !bodySource.includes('AdminLoadingState')
      ) {
        errors.push(
          `${relativePath}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1} ${node.name.text} must use the unified page refresh indicator.`,
        );
      }
      if (/animate-pulse|data-.*skeleton|Skeleton/.test(bodySource)) {
        errors.push(
          `${relativePath}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1} ${node.name.text} must not render local skeleton/pulse placeholders.`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

for (const componentPath of deletedLoadingComponents) {
  const fullPath = path.join(srcRoot, componentPath);
  if (existsSync(fullPath)) {
    errors.push(`Deleted loading component still exists: ${componentPath}`);
  }
}

const sourceFiles = await listSourceFiles(srcRoot);
for (const filePath of sourceFiles) {
  const relativePath = toSrcRelative(filePath);
  const source = await readFile(filePath, 'utf8');

  if (/(LoadingSpinner|SelectionPageSkeleton|from ['"].*\/Skeleton['"])/.test(source)) {
    errors.push(`Forbidden legacy loading import/name found in ${relativePath}`);
  }

  if (!skeletonAllowedFiles.has(relativePath) && /\bSkeleton\b/.test(source)) {
    errors.push(`Page skeleton wording found outside the allowed files: ${relativePath}`);
  }

  if (/productWallSkeleton|product-wall-skeleton/.test(source)) {
    errors.push(`Product wall skeleton residue found in ${relativePath}`);
  }

  if (/\{\s*statItems\.length === 0\s*&&\s*\([\s\S]*?<PageRefreshIndicator/.test(source)) {
    errors.push(`Stats refresh indicators must be gated by an explicit loading flag in ${relativePath}`);
  }

  if (!skeletonAllowedFiles.has(relativePath)) {
    verifyLoadingStateFunctions(source, relativePath);
  }
}

const routerSource = await readFile(path.join(srcRoot, 'router.tsx'), 'utf8');
const appSource = await readFile(path.join(srcRoot, 'App.tsx'), 'utf8');
const refreshFallbackSource = await readFile(path.join(srcRoot, 'components/shared/PageRefreshFallback.tsx'), 'utf8');
const routeProgressSource = await readFile(path.join(srcRoot, 'components/shared/RouteProgress.tsx'), 'utf8');
const homePageSource = await readFile(path.join(srcRoot, 'pages/HomePage.tsx'), 'utf8');
const globalCssSource = await readFile(path.join(srcRoot, 'styles/global.css'), 'utf8');
if (!routerSource.includes('return <PageRefreshFallback standalone={standalone} />;')) {
  errors.push('RouteFallback must use PageRefreshFallback for non-model-detail routes.');
}
if (!routerSource.includes('return <ModelDetailPageSkeleton />;')) {
  errors.push('RouteFallback must keep ModelDetailPageSkeleton for model detail routes.');
}
if (!appSource.includes('GlobalPageRefreshIndicator') || !appSource.includes('<GlobalPageRefreshIndicator />')) {
  errors.push('App must render the single global page refresh indicator.');
}
if (!refreshFallbackSource.includes('fixed left-1/2 top-1/2')) {
  errors.push('PageRefreshIndicator must stay fixed at the viewport center.');
}
if (
  !refreshFallbackSource.includes('export function GlobalPageRefreshIndicator') ||
  !refreshFallbackSource.includes('createPortal') ||
  !refreshFallbackSource.includes('getActiveRefreshEntry')
) {
  errors.push('Page refresh must render from a single global refresh instance.');
}
if (!/export function PageRefreshIndicator[\s\S]*?return null;\n}/.test(refreshFallbackSource)) {
  errors.push('PageRefreshIndicator must only register loading state and not render its own spinner.');
}
if (
  !refreshFallbackSource.includes('REFRESH_ENTER_DELAY_MS') ||
  !refreshFallbackSource.includes('REFRESH_MIN_VISIBLE_MS')
) {
  errors.push('Global page refresh must keep anti-flicker enter delay and minimum visible duration.');
}
if (
  !routeProgressSource.includes("'exiting'") ||
  !/setPhase\('exiting'\);\s*setRouteProgress\(100\);/.test(routeProgressSource) ||
  !routeProgressSource.includes("phase !== 'idle' && phase !== 'exiting'") ||
  !routeProgressSource.includes('const setRouteProgressAtLeast = useCallback(') ||
  !routeProgressSource.includes('setTransitionId((value) => value + 1);') ||
  !routeProgressSource.includes('key={transitionId}')
) {
  errors.push('Route progress must fade out at 100% without visibly shrinking backwards.');
}
if (/setProgress\((18|58|86|100)\)/.test(routeProgressSource)) {
  errors.push('Route progress must use monotonic progress helpers instead of raw visible progress resets.');
}
if (
  !routeProgressSource.includes('location.pathname') ||
  routeProgressSource.includes('[location.key]') ||
  routeProgressSource.includes('[location.search]')
) {
  errors.push('Route progress must only react to pathname changes, not same-page query/state updates.');
}
if (
  !refreshFallbackSource.includes('export function usePageRefreshActive') ||
  !routeProgressSource.includes('usePageRefreshActive') ||
  !routeProgressSource.includes('pageRefreshActive') ||
  !routeProgressSource.includes('data-route-progress') ||
  !routeProgressSource.includes('data-route-progress-bar') ||
  !routeProgressSource.includes('const MAX_WAIT_MS = 8000;') ||
  !routeProgressSource.includes('if (!routePendingRef.current) return;') ||
  !routeProgressSource.includes('window.setTimeout(completeRouteProgress, MAX_WAIT_MS)') ||
  !routeProgressSource.includes(
    "if (!routePendingRef.current || phase === 'idle' || phase === 'exiting' || pageRefreshActive) return;",
  )
) {
  errors.push('Route progress must stay linked to the global page refresh state with a bounded completion fallback.');
}
if (
  /SMOOTH_WHEEL|HOME_DESKTOP_WHEEL|HOME_DESKTOP_SMOOTH_WHEEL|DesktopWheelMomentumState|HomeDesktopSmoothWheelState|desktopSmoothWheelRef|desktopWheelMomentumRef|data-home-smooth-wheel-ignore|addEventListener\('wheel'|capture:\s*true|home-scroll-active|scrollHover|HOME_DESKTOP_GRID_VIRTUALIZATION_ENABLED|HOME_DESKTOP_VIRTUAL_MIN_ITEMS|HOME_DESKTOP_LIST_VIRTUAL_MIN_ITEMS|HOME_MOBILE_VIRTUAL_MIN_ITEMS|shouldVirtualizeDesktopGrid|shouldVirtualizeDesktopList|shouldVirtualizeMobileGrid|getHomeVirtualWindow|getHomeVirtualGridAutoRows|desktopVirtualWindow|desktopListVirtualWindow|mobileVirtualWindow|desktopVirtualOuterRef|desktopListVirtualOuterRef|mobileVirtualOuterRef/.test(
    homePageSource,
  )
) {
  errors.push(
    'Home page must keep native scrolling/rendering and must not reintroduce custom wheel, scroll-active smoothing, or virtual list windows.',
  );
}
if (globalCssSource.includes('content-visibility: auto')) {
  errors.push('Home page loading contract must not rely on content-visibility for model cards.');
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}

console.log('Loading contract verified.');

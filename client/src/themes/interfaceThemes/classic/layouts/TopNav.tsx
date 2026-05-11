import { Link } from 'react-router-dom';
import Icon from '../../../../components/shared/Icon';
import Tooltip from '../../../../components/shared/Tooltip';
import { preloadRouteForPath } from '../../../../lib/routeLoaders';
import type { DesktopTopNavThemeProps } from '../../types';

const desktopIconClass =
  'p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg transition-colors';

export default function ClassicTopNav({
  source,
  topNavItems,
  renderBrand,
  renderSearch,
  tools,
  onNavClick,
}: DesktopTopNavThemeProps) {
  return (
    <header
      className="h-14 flex items-center bg-surface-container-low border-b border-outline-variant/10 shrink-0 z-50"
      data-app-top-nav={source}
    >
      {renderBrand(
        'flex w-56 shrink-0 cursor-pointer items-center px-5 transition-[opacity,transform] hover:opacity-80 active:scale-95',
      )}
      {renderSearch('hidden flex-1 max-w-lg md:mt-px md:flex')}
      <div className="ml-auto flex shrink-0 items-center gap-0.5 pr-6">
        {topNavItems.map((item) => (
          <Tooltip key={item.path} text={item.label} side="bottom">
            <Link
              to={item.path}
              className={desktopIconClass}
              onPointerEnter={() => preloadRouteForPath(item.path)}
              onPointerDown={() => preloadRouteForPath(item.path)}
              onFocus={() => preloadRouteForPath(item.path)}
              onClick={(event) => onNavClick(event, item.path)}
            >
              <Icon name={item.icon} size={20} />
            </Link>
          </Tooltip>
        ))}
        {tools}
      </div>
    </header>
  );
}

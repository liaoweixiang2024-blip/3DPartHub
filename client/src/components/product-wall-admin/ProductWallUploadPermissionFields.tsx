import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import client from '../../api/client';
import { listProductWallUploadWhitelist, type ProductWallUploadWhitelistUser } from '../../api/productWall';
import { unwrapResponse } from '../../api/response';
import Icon from '../shared/Icon';

const PRODUCT_WALL_UPLOAD_ROLE_OPTIONS: { value: string; labelKey: string; hintKey?: string }[] = [
  { value: 'ADMIN', labelKey: 'productWallAdmin.roleAdmin', hintKey: 'productWallAdmin.roleAdminHint' },
  { value: 'EDITOR', labelKey: 'productWallAdmin.roleEditor' },
  { value: 'INTERNAL', labelKey: 'productWallAdmin.roleInternal' },
  { value: 'VIEWER', labelKey: 'productWallAdmin.roleViewer' },
];

/** 图库上传角色白名单编辑器（设置页与图库管理面板权限弹窗共用） */
export function ProductWallUploadRolesEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const selected = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return (
    <div className="flex flex-wrap gap-2">
      {PRODUCT_WALL_UPLOAD_ROLE_OPTIONS.map((opt) => {
        const enabled = opt.value === 'ADMIN' || selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            disabled={opt.value === 'ADMIN'}
            onClick={() => {
              const next = enabled ? selected.filter((k) => k !== opt.value) : [...selected, opt.value];
              onChange(next.join(','));
            }}
            title={opt.value === 'ADMIN' ? t('productWallAdmin.roleAdminTitle') : undefined}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              enabled
                ? 'border-primary-container/30 bg-primary-container/20 text-primary-container'
                : 'border-outline-variant/10 bg-surface-container-highest/20 text-on-surface-variant/50'
            } ${opt.value === 'ADMIN' ? 'cursor-default' : ''}`}
          >
            <Icon name={enabled ? 'check_circle' : 'circle'} size={14} />
            {t(opt.labelKey)}
            {opt.hintKey ? <span className="text-[10px] opacity-70">（{t(opt.hintKey)}）</span> : null}
          </button>
        );
      })}
    </div>
  );
}

const USER_PICKER_SEARCH_DEBOUNCE_MS = 300;

interface UserPickerCandidate {
  id: string;
  username: string;
  email: string;
  role: string;
  disabled: boolean;
}

/** 图库上传指定用户白名单编辑器（设置页与图库管理面板权限弹窗共用） */
export function ProductWallUploadUsersEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const ids = useMemo(
    () =>
      Array.from(
        new Set(
          value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ),
    [value],
  );
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<UserPickerCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const { data: whitelist } = useSWR('product-wall-upload-whitelist', listProductWallUploadWhitelist);
  const knownUsers = useMemo(() => {
    const map = new Map<string, ProductWallUploadWhitelistUser>();
    for (const user of whitelist?.users || []) map.set(user.id, user);
    return map;
  }, [whitelist]);

  useEffect(() => {
    const keyword = search.trim();
    if (!keyword) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await client.get('/admin/users', { params: { search: keyword, page: 1, page_size: 8 } });
        const data = unwrapResponse<{ items?: UserPickerCandidate[] } | UserPickerCandidate[] | null>(res);
        setResults(Array.isArray(data) ? data : data?.items || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, USER_PICKER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const toggleUser = (id: string) => {
    const next = ids.includes(id) ? ids.filter((k) => k !== id) : [...ids, id];
    onChange(next.join(','));
  };

  return (
    <div className="flex flex-col gap-2.5">
      {ids.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ids.map((id) => {
            const known = knownUsers.get(id);
            return (
              <span
                key={id}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${
                  known?.disabled
                    ? 'border-error-container/40 bg-error-container/15 text-error'
                    : 'border-primary-container/30 bg-primary-container/15 text-primary-container'
                }`}
                title={known ? `${known.username} · ${known.email}` : id}
              >
                <Icon name="person" size={13} />
                {known ? known.username : `${id.slice(0, 8)}…`}
                {known?.disabled ? <span className="opacity-70">{t('productWallAdmin.userDisabled')}</span> : null}
                <button
                  type="button"
                  onClick={() => toggleUser(id)}
                  className="ml-0.5 inline-flex rounded-full p-0.5 transition-colors hover:bg-black/10"
                  aria-label={t('productWallAdmin.removeUser')}
                >
                  <Icon name="close" size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <div className="relative">
        <input
          name="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t('productWallAdmin.userSearchPlaceholder')}
          className="h-9 w-full rounded-md border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none transition-colors focus:border-primary-container/60"
        />
        {open && search.trim() ? (
          <div className="absolute left-0 top-10 z-30 w-full overflow-hidden rounded-lg border border-outline-variant/16 bg-surface shadow-panel">
            {searching ? (
              <p className="px-3 py-2.5 text-xs text-on-surface-variant">{t('productWallAdmin.searchingUsers')}</p>
            ) : results.length ? (
              results.map((user) => {
                const picked = ids.includes(user.id);
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => {
                      if (!picked) toggleUser(user.id);
                      setSearch('');
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-container-high ${
                      picked ? 'opacity-50' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-on-surface">{user.username}</span>
                      <span className="block truncate text-xs text-on-surface-variant">
                        {user.email} · {user.role}
                        {user.disabled ? ` · ${t('productWallAdmin.userDisabledPlain')}` : ''}
                      </span>
                    </span>
                    {picked ? (
                      <span className="shrink-0 text-xs text-on-surface-variant">
                        {t('productWallAdmin.userAdded')}
                      </span>
                    ) : (
                      <Icon name="add" size={15} className="shrink-0" />
                    )}
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-2.5 text-xs text-on-surface-variant">{t('productWallAdmin.noUserMatch')}</p>
            )}
          </div>
        ) : null}
      </div>
      <p className="text-xs text-on-surface-variant">{t('productWallAdmin.userWhitelistHint')}</p>
    </div>
  );
}

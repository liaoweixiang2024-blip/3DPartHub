import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import client from '../../api/client';
import { listProductWallUploadWhitelist, type ProductWallUploadWhitelistUser } from '../../api/productWall';
import { unwrapResponse } from '../../api/response';
import Icon from '../shared/Icon';

const PRODUCT_WALL_UPLOAD_ROLE_OPTIONS: { value: string; label: string; hint?: string }[] = [
  { value: 'ADMIN', label: '管理员', hint: '始终允许' },
  { value: 'EDITOR', label: '编辑' },
  { value: 'INTERNAL', label: '内部' },
  { value: 'VIEWER', label: '普通用户' },
];

/** 图库上传角色白名单编辑器（设置页与图库管理面板权限弹窗共用） */
export function ProductWallUploadRolesEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
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
            title={opt.value === 'ADMIN' ? '管理员始终允许上传，不可关闭' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              enabled
                ? 'border-primary-container/30 bg-primary-container/20 text-primary-container'
                : 'border-outline-variant/10 bg-surface-container-highest/20 text-on-surface-variant/50'
            } ${opt.value === 'ADMIN' ? 'cursor-default' : ''}`}
          >
            <Icon name={enabled ? 'check_circle' : 'circle'} size={14} />
            {opt.label}
            {opt.hint ? <span className="text-[10px] opacity-70">（{opt.hint}）</span> : null}
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
                {known?.disabled ? <span className="opacity-70">（已禁用）</span> : null}
                <button
                  type="button"
                  onClick={() => toggleUser(id)}
                  className="ml-0.5 inline-flex rounded-full p-0.5 transition-colors hover:bg-black/10"
                  aria-label="移除该用户"
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
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="搜索用户名 / 邮箱 / 公司，选择要添加的用户"
          className="h-9 w-full rounded-md border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none transition-colors focus:border-primary-container/60"
        />
        {open && search.trim() ? (
          <div className="absolute left-0 top-10 z-30 w-full overflow-hidden rounded-lg border border-outline-variant/16 bg-surface shadow-panel">
            {searching ? (
              <p className="px-3 py-2.5 text-xs text-on-surface-variant">搜索中...</p>
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
                        {user.disabled ? ' · 已禁用' : ''}
                      </span>
                    </span>
                    {picked ? (
                      <span className="shrink-0 text-xs text-on-surface-variant">已添加</span>
                    ) : (
                      <Icon name="add" size={15} className="shrink-0" />
                    )}
                  </button>
                );
              })
            ) : (
              <p className="px-3 py-2.5 text-xs text-on-surface-variant">没有匹配的用户</p>
            )}
          </div>
        ) : null}
      </div>
      <p className="text-xs text-on-surface-variant">
        白名单为空时仅按角色白名单控制；在此添加的用户不受角色限制，可直接上传（进入待审核）。被删除的用户自动失效。
      </p>
    </div>
  );
}

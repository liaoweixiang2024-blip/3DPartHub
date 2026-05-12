/**
 * Thread-size tool: admin management modal + entry editor dialog.
 * Extracted from ThreadSizeToolPage.
 */

import { useMemo, useState } from 'react';
import { threadSizeApi, type ThreadSizeEntry } from '../../api/threadSize';
import { useImeSafeSearchInput } from '../../hooks/useImeSafeSearchInput';
import Icon from '../shared/Icon';
import ResponsiveSectionTabs from '../shared/ResponsiveSectionTabs';
import SearchField from '../shared/SearchField';
import { useToast } from '../shared/Toast';
import {
  CATEGORY_FILTERS,
  categoryIcon,
  type DataTab,
  entryToAdminRow,
  includesAdminQuery,
  matchesAdminFilter,
  type AdminDataRow,
} from './threadSizeData';

// ── Props ────────────────────────────────────────────────────────────

interface ManagementModalProps {
  adminEntries: ThreadSizeEntry[];
  onRefresh: () => Promise<void>;
  onClose: () => void;
}

// ── Component ────────────────────────────────────────────────────────

export default function ThreadSizeManagementModal({ adminEntries, onRefresh, onClose }: ManagementModalProps) {
  const { toast } = useToast();
  const [managementCategory, setManagementCategory] = useState('thread:all');
  const {
    value: managementQuery,
    draftValue: managementQueryInputValue,
    setValue: setManagementQueryInput,
    inputProps: managementQueryInputProps,
  } = useImeSafeSearchInput();

  const [editingEntry, setEditingEntry] = useState<ThreadSizeEntry | 'new' | null>(null);
  const [entryDraft, setEntryDraft] = useState({
    kind: 'thread' as DataTab,
    family: '',
    hoseKind: '',
    primary: '',
    secondary: '',
    meta: '',
    note: '',
    dataText: '{}',
    sortOrder: 0,
    enabled: true,
  });

  const adminRows = useMemo<AdminDataRow[]>(() => adminEntries.map(entryToAdminRow), [adminEntries]);

  const adminCounts = useMemo(
    () =>
      CATEGORY_FILTERS.reduce<Record<string, number>>((acc, tab) => {
        acc[tab.key] = adminRows.filter((row) => matchesAdminFilter(row, tab.key)).length;
        return acc;
      }, {}),
    [adminRows],
  );

  const visibleAdminRows = useMemo(
    () =>
      adminRows.filter(
        (row) => matchesAdminFilter(row, managementCategory) && includesAdminQuery(row, managementQuery),
      ),
    [adminRows, managementCategory, managementQuery],
  );

  const refreshThreadSizeData = async () => {
    await onRefresh();
  };

  const openEntryEditor = (entry?: ThreadSizeEntry) => {
    if (entry) {
      setEditingEntry(entry);
      setEntryDraft({
        kind: entry.kind,
        family: entry.family || '',
        hoseKind: entry.hoseKind || '',
        primary: entry.primary,
        secondary: entry.secondary,
        meta: entry.meta,
        note: entry.note,
        dataText: JSON.stringify(entry.data || {}, null, 2),
        sortOrder: entry.sortOrder || 0,
        enabled: entry.enabled,
      });
      return;
    }
    const applied = CATEGORY_FILTERS.find((item) => item.key === managementCategory)?.apply();
    setEditingEntry('new');
    setEntryDraft({
      kind: applied?.tab || 'thread',
      family: applied?.family && applied.family !== 'all' ? applied.family : '',
      hoseKind: applied?.hoseKind && applied.hoseKind !== 'all' ? applied.hoseKind : '',
      primary: '',
      secondary: '',
      meta: '',
      note: '',
      dataText: '{}',
      sortOrder: adminRows.length + 1,
      enabled: true,
    });
  };

  const saveEntryDraft = async () => {
    try {
      const parsedData = entryDraft.dataText.trim() ? JSON.parse(entryDraft.dataText) : {};
      const payload = {
        kind: entryDraft.kind,
        family: entryDraft.family || null,
        hoseKind: entryDraft.hoseKind || null,
        primary: entryDraft.primary,
        secondary: entryDraft.secondary,
        meta: entryDraft.meta,
        note: entryDraft.note,
        data: parsedData,
        sortOrder: entryDraft.sortOrder,
        enabled: entryDraft.enabled,
      };
      if (editingEntry === 'new') await threadSizeApi.create(payload);
      else if (editingEntry) await threadSizeApi.update(editingEntry.id, payload);
      toast('规格数据已保存', 'success');
      setEditingEntry(null);
      await refreshThreadSizeData();
    } catch (err) {
      toast(err instanceof SyntaxError ? '结构化 JSON 格式不正确' : '保存失败', 'error');
    }
  };

  const deleteEntry = async (entry: ThreadSizeEntry) => {
    if (!window.confirm(`确定删除「${entry.primary}」吗？`)) return;
    try {
      await threadSizeApi.remove(entry.id);
      toast('规格数据已删除', 'success');
      await refreshThreadSizeData();
    } catch {
      toast('删除失败', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="fixed inset-0 flex min-h-0 flex-col bg-surface-container-low shadow-2xl sm:relative sm:inset-auto sm:h-[88dvh] sm:w-[min(96vw,1180px)] sm:overflow-hidden sm:rounded-xl sm:border sm:border-outline-variant/20"
        role="dialog"
        aria-modal="true"
        aria-label="规格数据管理"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold text-on-surface">规格数据管理</h2>
            <p className="mt-0.5 line-clamp-1 text-xs text-on-surface-variant">
              数据已接入数据库，可人工新增、编辑、删除；前台表格只读取数据库记录。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="关闭"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="grid shrink-0 gap-3 border-b border-outline-variant/10 px-4 py-3 md:grid-cols-[minmax(0,1fr)_18rem]">
          <ResponsiveSectionTabs
            tabs={CATEGORY_FILTERS.map((tab) => ({
              value: tab.key,
              label: tab.label,
              icon: categoryIcon(tab.key),
              count: adminCounts[tab.key] || 0,
            }))}
            value={managementCategory}
            onChange={setManagementCategory}
            mobileTitle="数据分类"
          />
          <SearchField
            inputProps={managementQueryInputProps}
            value={managementQueryInputValue}
            onClear={() => setManagementQueryInput('')}
            placeholder="搜索规格、型号、说明..."
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-bold text-on-surface">
                {CATEGORY_FILTERS.find((tab) => tab.key === managementCategory)?.label}
              </p>
              <p className="mt-0.5 text-xs text-on-surface-variant">
                {adminRows.length
                  ? '当前读取数据库数据，修改后前台立即生效。'
                  : '数据库暂无规格数据，请新增记录或通过数据库导入。'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full bg-primary-container/10 px-2.5 py-1 text-xs font-bold text-primary-container">
                {visibleAdminRows.length} 项
              </span>
              <button
                type="button"
                onClick={() => openEntryEditor()}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary-container px-2.5 text-xs font-bold text-on-primary transition-opacity hover:opacity-90"
              >
                <Icon name="add" size={13} />
                新增
              </button>
            </div>
          </div>

          {visibleAdminRows.length === 0 ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10 text-center">
              <div>
                <Icon name="search_off" size={32} className="mx-auto text-on-surface-variant/30" />
                <p className="mt-3 text-sm font-bold text-on-surface">没有匹配数据</p>
                <p className="mt-1 text-xs text-on-surface-variant">换一个规格、型号或说明关键词试试。</p>
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
              <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
                <thead className="sticky top-0 z-10 bg-surface-container-low text-xs text-on-surface">
                  <tr>
                    <th className="border-b border-outline-variant/10 px-4 py-3 font-bold">规格 / 型号</th>
                    <th className="border-b border-outline-variant/10 px-4 py-3 font-bold">分类</th>
                    <th className="border-b border-outline-variant/10 px-4 py-3 font-bold">关键参数</th>
                    <th className="border-b border-outline-variant/10 px-4 py-3 font-bold">说明</th>
                    <th className="border-b border-outline-variant/10 px-4 py-3 text-right font-bold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant/8">
                  {visibleAdminRows.map((row) => (
                    <tr key={row.id} className="text-on-surface transition-colors hover:bg-surface-container-high/30">
                      <td className="px-4 py-3 font-semibold">{row.primary}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{row.secondary}</td>
                      <td className="px-4 py-3 text-on-surface-variant">{row.meta}</td>
                      <td className="max-w-[420px] px-4 py-3 leading-6 text-on-surface-variant">{row.note}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => row.dbEntry && openEntryEditor(row.dbEntry)}
                            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-outline-variant/12 px-2.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                          >
                            <Icon name="edit" size={13} />
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => row.dbEntry && void deleteEntry(row.dbEntry)}
                            className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-error/15 px-2.5 text-xs font-medium text-error transition-colors hover:bg-error/8"
                          >
                            <Icon name="delete" size={13} />
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Entry Editor Dialog ── */}
      {editingEntry && (
        <EntryEditorDialog
          editingEntry={editingEntry}
          entryDraft={entryDraft}
          setEntryDraft={setEntryDraft}
          onSave={saveEntryDraft}
          onClose={() => setEditingEntry(null)}
        />
      )}
    </div>
  );
}

// ── Entry Editor Dialog ──────────────────────────────────────────────

interface EntryEditorDialogProps {
  editingEntry: ThreadSizeEntry | 'new';
  entryDraft: {
    kind: DataTab;
    family: string;
    hoseKind: string;
    primary: string;
    secondary: string;
    meta: string;
    note: string;
    dataText: string;
    sortOrder: number;
    enabled: boolean;
  };
  setEntryDraft: React.Dispatch<React.SetStateAction<EntryEditorDialogProps['entryDraft']>>;
  onSave: () => Promise<void>;
  onClose: () => void;
}

function EntryEditorDialog({ editingEntry, entryDraft, setEntryDraft, onSave, onClose }: EntryEditorDialogProps) {
  return (
    <div className="fixed inset-0 z-[340] flex items-center justify-center bg-black/55 p-3" onClick={onClose}>
      <div
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-outline-variant/20 bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="编辑规格数据"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-on-surface">
              {editingEntry === 'new' ? '新增规格数据' : '编辑规格数据'}
            </h2>
            <p className="mt-0.5 text-xs text-on-surface-variant">结构化 JSON 会用于前台表格精确展示。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label="关闭"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="text-xs font-bold text-on-surface-variant">类型</span>
              <select
                value={entryDraft.kind}
                onChange={(event) =>
                  setEntryDraft((prev: typeof entryDraft) => ({ ...prev, kind: event.target.value as DataTab }))
                }
                className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
              >
                <option value="thread">螺纹</option>
                <option value="pipe">管径</option>
                <option value="hose">油管/气管</option>
                <option value="fitting">扣压接头</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-on-surface-variant">螺纹分类</span>
              <input
                value={entryDraft.family}
                onChange={(event) =>
                  setEntryDraft((prev: typeof entryDraft) => ({ ...prev, family: event.target.value }))
                }
                placeholder="metric / g / r / npt / jic"
                className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-on-surface-variant">管路分类</span>
              <input
                value={entryDraft.hoseKind}
                onChange={(event) =>
                  setEntryDraft((prev: typeof entryDraft) => ({ ...prev, hoseKind: event.target.value }))
                }
                placeholder="hydraulic / air"
                className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-bold text-on-surface-variant">规格 / 型号</span>
              <input
                value={entryDraft.primary}
                onChange={(event) =>
                  setEntryDraft((prev: typeof entryDraft) => ({ ...prev, primary: event.target.value }))
                }
                className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-on-surface-variant">分类显示</span>
              <input
                value={entryDraft.secondary}
                onChange={(event) =>
                  setEntryDraft((prev: typeof entryDraft) => ({ ...prev, secondary: event.target.value }))
                }
                className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-on-surface-variant">关键参数</span>
            <input
              value={entryDraft.meta}
              onChange={(event) => setEntryDraft((prev: typeof entryDraft) => ({ ...prev, meta: event.target.value }))}
              className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-on-surface-variant">说明</span>
            <textarea
              value={entryDraft.note}
              onChange={(event) => setEntryDraft((prev: typeof entryDraft) => ({ ...prev, note: event.target.value }))}
              rows={3}
              className="mt-1 w-full resize-y rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm leading-6 text-on-surface outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-on-surface-variant">结构化 JSON</span>
            <textarea
              value={entryDraft.dataText}
              onChange={(event) =>
                setEntryDraft((prev: typeof entryDraft) => ({ ...prev, dataText: event.target.value }))
              }
              rows={8}
              spellCheck={false}
              className="mt-1 w-full resize-y rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 font-mono text-xs leading-5 text-on-surface outline-none"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="block">
              <span className="text-xs font-bold text-on-surface-variant">排序</span>
              <input
                type="number"
                value={entryDraft.sortOrder}
                onChange={(event) =>
                  setEntryDraft((prev: typeof entryDraft) => ({ ...prev, sortOrder: Number(event.target.value) || 0 }))
                }
                className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
              />
            </label>
            <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-outline-variant/15 px-3 text-sm text-on-surface-variant">
              <input
                type="checkbox"
                checked={entryDraft.enabled}
                onChange={(event) =>
                  setEntryDraft((prev: typeof entryDraft) => ({ ...prev, enabled: event.target.checked }))
                }
              />
              启用
            </label>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-outline-variant/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-outline-variant/20 px-4 text-sm font-bold text-on-surface-variant"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            className="h-9 rounded-lg bg-primary-container px-4 text-sm font-bold text-on-primary"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

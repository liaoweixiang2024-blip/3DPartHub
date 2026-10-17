/**
 * Thread-size tool: admin management modal + entry editor dialog.
 * Extracted from ThreadSizeToolPage.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { threadSizeApi, type ThreadSizeEntry } from '../../api/threadSize';
import { useImeSafeSearchInput } from '../../hooks/useImeSafeSearchInput';
import { AdminTableHeadCell, AdminTableHeadRow, ADMIN_TABLE_HEAD_CLASS } from '../shared/AdminDataTable';
import ConfirmDialog from '../shared/ConfirmDialog';
import Icon from '../shared/Icon';
import ResponsiveSectionTabs from '../shared/ResponsiveSectionTabs';
import SearchField from '../shared/SearchField';
import { useToast } from '../shared/Toast';
import {
  CATEGORY_FILTERS,
  categoryFilterLabel,
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
  const { t } = useTranslation();
  const { toast } = useToast();
  const [managementCategory, setManagementCategory] = useState('thread:all');
  const {
    value: managementQuery,
    draftValue: managementQueryInputValue,
    setValue: setManagementQueryInput,
    inputProps: managementQueryInputProps,
  } = useImeSafeSearchInput();

  const [editingEntry, setEditingEntry] = useState<ThreadSizeEntry | 'new' | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ThreadSizeEntry | null>(null);
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
      toast(t('threadTool.toastSaved'), 'success');
      setEditingEntry(null);
      await refreshThreadSizeData();
    } catch (err) {
      toast(err instanceof SyntaxError ? t('threadTool.toastJsonInvalid') : t('threadTool.toastSaveFailed'), 'error');
    }
  };

  const deleteEntry = async (entry: ThreadSizeEntry) => {
    try {
      await threadSizeApi.remove(entry.id);
      toast(t('threadTool.toastDeleted'), 'success');
      setDeleteTarget(null);
      await refreshThreadSizeData();
    } catch {
      toast(t('threadTool.toastDeleteFailed'), 'error');
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4"
        onClick={onClose}
      >
        <div
          className="fixed inset-0 flex min-h-0 flex-col bg-surface-container-low shadow-2xl sm:relative sm:inset-auto sm:h-[88dvh] sm:w-[min(96vw,1180px)] sm:overflow-hidden sm:rounded-xl sm:border sm:border-outline-variant/20"
          role="dialog"
          aria-modal="true"
          aria-label={t('threadTool.manageTitle')}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/10 px-4 py-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold text-on-surface">{t('threadTool.manageTitle')}</h2>
              <p className="mt-0.5 line-clamp-1 text-xs text-on-surface-variant">{t('threadTool.manageDesc')}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              aria-label={t('common.close')}
            >
              <Icon name="close" size={18} />
            </button>
          </div>

          <div className="grid shrink-0 gap-3 border-b border-outline-variant/10 px-4 py-3 md:grid-cols-[minmax(0,1fr)_18rem]">
            <ResponsiveSectionTabs
              tabs={CATEGORY_FILTERS.map((tab) => ({
                value: tab.key,
                label: categoryFilterLabel(tab),
                icon: categoryIcon(tab.key),
                count: adminCounts[tab.key] || 0,
              }))}
              value={managementCategory}
              onChange={setManagementCategory}
              mobileTitle={t('threadTool.dataCategoryTitle')}
            />
            <SearchField
              inputProps={managementQueryInputProps}
              value={managementQueryInputValue}
              onClear={() => setManagementQueryInput('')}
              placeholder={t('threadTool.searchPlaceholder')}
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-on-surface">
                  {categoryFilterLabel(
                    CATEGORY_FILTERS.find((tab) => tab.key === managementCategory) || CATEGORY_FILTERS[0],
                  )}
                </p>
                <p className="mt-0.5 text-xs text-on-surface-variant">
                  {adminRows.length ? t('threadTool.dbLiveHint') : t('threadTool.dbEmptyHint')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="rounded-full bg-primary-container/10 px-2.5 py-1 text-xs font-bold text-primary-container">
                  {t('threadTool.itemCount', { count: visibleAdminRows.length })}
                </span>
                <button
                  type="button"
                  onClick={() => openEntryEditor()}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary-container px-2.5 text-xs font-bold text-on-primary transition-opacity hover:opacity-90"
                >
                  <Icon name="add" size={13} />
                  {t('threadTool.addEntry')}
                </button>
              </div>
            </div>

            {visibleAdminRows.length === 0 ? (
              <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-10 text-center">
                <div>
                  <Icon name="search_off" size={32} className="mx-auto text-on-surface-variant/30" />
                  <p className="mt-3 text-sm font-bold text-on-surface">{t('threadTool.emptyTitle')}</p>
                  <p className="mt-1 text-xs text-on-surface-variant">{t('threadTool.emptyDesc')}</p>
                </div>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto custom-scrollbar">
                <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
                  <thead className={ADMIN_TABLE_HEAD_CLASS}>
                    <AdminTableHeadRow>
                      <AdminTableHeadCell>{t('threadTool.colSpec')}</AdminTableHeadCell>
                      <AdminTableHeadCell>{t('threadTool.colCategory')}</AdminTableHeadCell>
                      <AdminTableHeadCell>{t('threadTool.colKeyParams')}</AdminTableHeadCell>
                      <AdminTableHeadCell>{t('threadTool.colNote')}</AdminTableHeadCell>
                      <AdminTableHeadCell className="text-right">{t('threadTool.colActions')}</AdminTableHeadCell>
                    </AdminTableHeadRow>
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
                              {t('common.edit')}
                            </button>
                            <button
                              type="button"
                              onClick={() => row.dbEntry && setDeleteTarget(row.dbEntry)}
                              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-error/15 px-2.5 text-xs font-medium text-error transition-colors hover:bg-error/8"
                            >
                              <Icon name="delete" size={13} />
                              {t('common.delete')}
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
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) void deleteEntry(deleteTarget);
        }}
        title={t('threadTool.confirmDeleteTitle')}
        description={t('threadTool.confirmDeleteDesc', { name: deleteTarget?.primary || '' })}
        confirmLabel={t('threadTool.confirmDeleteLabel')}
      />
    </>
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
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-[340] flex items-center justify-center bg-black/55 p-3" onClick={onClose}>
      <div
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-outline-variant/20 bg-surface shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('threadTool.editorTitleEdit')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/10 px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-on-surface">
              {editingEntry === 'new' ? t('threadTool.editorTitleNew') : t('threadTool.editorTitleEdit')}
            </h2>
            <p className="mt-0.5 text-xs text-on-surface-variant">{t('threadTool.editorDesc')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
            aria-label={t('common.close')}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="text-xs font-bold text-on-surface-variant">{t('threadTool.fieldType')}</span>
              <select
                name="kind"
                value={entryDraft.kind}
                onChange={(event) =>
                  setEntryDraft((prev: typeof entryDraft) => ({ ...prev, kind: event.target.value as DataTab }))
                }
                className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
              >
                <option value="thread">{t('threadTool.kindThread')}</option>
                <option value="pipe">{t('threadTool.kindPipe')}</option>
                <option value="hose">{t('threadTool.kindHose')}</option>
                <option value="fitting">{t('threadTool.kindFitting')}</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-bold text-on-surface-variant">{t('threadTool.fieldFamily')}</span>
              <input
                name="family"
                value={entryDraft.family}
                onChange={(event) =>
                  setEntryDraft((prev: typeof entryDraft) => ({ ...prev, family: event.target.value }))
                }
                placeholder="metric / g / r / npt / jic"
                className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-on-surface-variant">{t('threadTool.fieldHoseKind')}</span>
              <input
                name="hose-kind"
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
              <span className="text-xs font-bold text-on-surface-variant">{t('threadTool.colSpec')}</span>
              <input
                name="primary"
                value={entryDraft.primary}
                onChange={(event) =>
                  setEntryDraft((prev: typeof entryDraft) => ({ ...prev, primary: event.target.value }))
                }
                className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-on-surface-variant">{t('threadTool.fieldCategoryDisplay')}</span>
              <input
                name="secondary"
                value={entryDraft.secondary}
                onChange={(event) =>
                  setEntryDraft((prev: typeof entryDraft) => ({ ...prev, secondary: event.target.value }))
                }
                className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-on-surface-variant">{t('threadTool.colKeyParams')}</span>
            <input
              name="meta"
              value={entryDraft.meta}
              onChange={(event) => setEntryDraft((prev: typeof entryDraft) => ({ ...prev, meta: event.target.value }))}
              className="mt-1 h-10 w-full rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 text-sm text-on-surface outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-on-surface-variant">{t('threadTool.colNote')}</span>
            <textarea
              name="note"
              value={entryDraft.note}
              onChange={(event) => setEntryDraft((prev: typeof entryDraft) => ({ ...prev, note: event.target.value }))}
              rows={3}
              className="mt-1 w-full resize-y rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-3 py-2 text-sm leading-6 text-on-surface outline-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-on-surface-variant">{t('threadTool.fieldJson')}</span>
            <textarea
              name="data-text"
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
              <span className="text-xs font-bold text-on-surface-variant">{t('threadTool.fieldSortOrder')}</span>
              <input
                name="sort-order"
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
                name="enabled"
                type="checkbox"
                checked={entryDraft.enabled}
                onChange={(event) =>
                  setEntryDraft((prev: typeof entryDraft) => ({ ...prev, enabled: event.target.checked }))
                }
              />
              {t('threadTool.fieldEnabled')}
            </label>
          </div>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-outline-variant/10 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-outline-variant/20 px-4 text-sm font-bold text-on-surface-variant"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            className="h-9 rounded-lg bg-primary-container px-4 text-sm font-bold text-on-primary"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

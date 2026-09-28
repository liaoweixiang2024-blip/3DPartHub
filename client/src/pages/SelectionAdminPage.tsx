import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import useSWR from 'swr';
import type { SheetData } from 'write-excel-file/browser';
import {
  getSelectionCategories,
  createCategory,
  updateCategory,
  updateSelectionGroup,
  deleteCategory,
  createProduct,
  getSelectionProducts,
  getSelectionProductById,
  updateProduct,
  deleteProduct,
  batchImportProducts,
  uploadOptionImage,
  uploadSelectionProductAsset,
  uploadOptionImageFromUrl,
  renameOptionValue,
  sortCategories,
  batchDeleteSelectionProducts,
  batchUpdateSelectionProductsHidden,
  batchUpdateSelectionProductField,
  type SelectionCategory,
  type SelectionProduct,
  type SelectionComponent,
  type ColumnDef,
} from '../api/selections';
import { BatchImportModal } from '../components/selection-admin/BatchImportModal';
import { ColumnEditor } from '../components/selection-admin/ColumnEditor';
import {
  SELECTION_TOOLBAR_BUTTON_PRIMARY,
  SELECTION_TOOLBAR_BUTTON_SECONDARY,
  SELECTION_ICON_BUTTON_EDIT,
  SELECTION_ICON_BUTTON_DELETE,
  SELECTION_ICON_BUTTON_ACTIVE,
} from '../components/selection-admin/constants';
import { ProductGeneratorModal } from '../components/selection-admin/ProductGeneratorModal';
import { SelectionToolbarButtonContent, ToolbarMoreMenu } from '../components/selection-admin/SelectionAdminToolbar';
import {
  getApiErrorMessage,
  normalizeImportCell,
  parseCsvRows,
  readProductImportRows,
  safeSpreadsheetText,
  cleanProductName,
  firstRowValue,
  productImportHeaders,
  generatableProductColumns,
  productAssetKind,
  parseGenerateValues,
  inferGenerateTemplates,
  buildGeneratedProductDrafts,
  type GeneratedProductDraft,
} from '../components/selection-admin/selectionAdminUtils';
import { SelectionExportModal, SelectionImportModal } from '../components/selection-admin/SelectionTransferModal';
import {
  ADMIN_GRID_ROW_CLASS,
  ADMIN_ROW_META_CLASS,
  ADMIN_ROW_TITLE_CLASS,
  AdminGridHeader,
  AdminTable,
  AdminTableBodyRow,
  AdminTableCell,
  AdminTableHeadCell,
  AdminTableHeadRow,
  ADMIN_TABLE_HEAD_CLASS,
} from '../components/shared/AdminDataTable';
import { AdminManagementPage } from '../components/shared/AdminManagementPage';
import { AdminPageShell } from '../components/shared/AdminPageShell';
import { AnimatePresence, motion } from 'framer-motion';
import ConfirmDialog from '../components/shared/ConfirmDialog';
import { dialogPanelMotion } from '../lib/motion';
import Icon from '../components/shared/Icon';
import InfiniteLoadTrigger from '../components/shared/InfiniteLoadTrigger';
import ResponsiveSectionTabs from '../components/shared/ResponsiveSectionTabs';
import SafeImage from '../components/shared/SafeImage';
import SearchField from '../components/shared/SearchField';
import { useToast } from '../components/shared/Toast';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useImeSafeSearchInput } from '../hooks/useImeSafeSearchInput';
import { useVisibleItems } from '../hooks/useVisibleItems';
import { openDocumentUrl } from '../lib/browserDownload';
import { getBusinessConfig } from '../lib/businessConfig';
import { parseKitComponentLines } from '../lib/kitImport';
import { KIT_LIST_TITLE_OPTION_KEY } from '../lib/kitList';
import { smartSortOptions } from '../lib/selectionSort';

type Tab = 'categories' | 'products';
const PRODUCT_MODEL_HEADERS = ['型号编号', '型号', 'modelNo', 'modelno', 'ModelNo'];
const PRODUCT_NAME_HEADERS = ['名称', '产品名称', 'name', 'Name'];
const SELECTION_CATEGORY_GRID_COLUMNS = 'minmax(220px,1.4fr) minmax(120px,0.8fr) 92px 92px 80px 104px';

// ========== Content ==========
// ---- 产品行 memo 组件：行内容只随自身数据/删除态变化 ----
// 5000 个产品的分类下，表格 120 行×20+ 列全量重渲染约 340ms/次，
// 会拖慢一切页面级 setState（打开弹窗、下拉、搜索联想）。memo 隔离后无关更新零开销。
interface ProductRowHandlers {
  onToggleHidden: (p: SelectionProduct) => void;
  onEdit: (p: SelectionProduct) => void;
  onConfirmDelete: (id: string) => void;
  /** 由 setState setter 直接传入（接受 string） */
  onRequestDelete: (id: string) => void;
  onCancelDelete: () => void;
  /** 批量选择：空依赖 useCallback，保持引用稳定 */
  onToggleSelected: (id: string) => void;
}

const ProductTableRow = memo(function ProductTableRow({
  p,
  columns,
  isDeleting,
  selected,
  onToggleHidden,
  onEdit,
  onConfirmDelete,
  onRequestDelete,
  onCancelDelete,
  onToggleSelected,
}: { p: SelectionProduct; columns: ColumnDef[]; isDeleting: boolean; selected: boolean } & ProductRowHandlers) {
  return (
    <AdminTableBodyRow className={p.hidden ? 'opacity-55' : undefined}>
      <AdminTableCell className="w-10 px-3 py-2.5">
        <input
          name="select-product"
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(p.id)}
          className="h-4 w-4 accent-primary-container"
          aria-label={`选择 ${p.modelNo || p.name}`}
        />
      </AdminTableCell>
      <AdminTableCell
        className="max-w-[200px] truncate whitespace-nowrap px-3 py-2.5 text-on-surface-variant"
        title={p.name}
      >
        {p.name || '—'}
      </AdminTableCell>
      {columns.map((col) => (
        <AdminTableCell key={col.key} className="whitespace-nowrap px-3 py-2.5">
          {(p.specs as Record<string, string>)[col.key] ?? '—'}
        </AdminTableCell>
      ))}
      <AdminTableCell className="px-3 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={() => onToggleHidden(p)}
            className={p.hidden ? SELECTION_ICON_BUTTON_ACTIVE : SELECTION_ICON_BUTTON_EDIT}
            data-tooltip-ignore
            aria-label={p.hidden ? '恢复产品参与选型' : '隐藏产品（不参与选型）'}
          >
            <Icon name={p.hidden ? 'visibility_off' : 'visibility'} size={13} />
          </button>
          <button
            onClick={() => onEdit(p)}
            className={SELECTION_ICON_BUTTON_EDIT}
            data-tooltip-ignore
            aria-label="编辑产品"
          >
            <Icon name="edit" size={13} />
          </button>
          {isDeleting ? (
            <>
              <button
                onClick={() => onConfirmDelete(p.id)}
                className="px-1.5 py-0.5 text-[10px] bg-error text-on-error-container rounded"
              >
                确认
              </button>
              <button onClick={onCancelDelete} className="px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                取消
              </button>
            </>
          ) : (
            <button
              onClick={() => onRequestDelete(p.id)}
              className={SELECTION_ICON_BUTTON_DELETE}
              data-tooltip-ignore
              aria-label="删除产品"
            >
              <Icon name="delete" size={13} />
            </button>
          )}
        </div>
      </AdminTableCell>
    </AdminTableBodyRow>
  );
});

const ProductMobileCard = memo(function ProductMobileCard({
  p,
  columns,
  isDeleting,
  selected,
  onToggleHidden,
  onEdit,
  onConfirmDelete,
  onRequestDelete,
  onCancelDelete,
  onToggleSelected,
}: { p: SelectionProduct; columns: ColumnDef[]; isDeleting: boolean; selected: boolean } & ProductRowHandlers) {
  const specs = (p.specs as Record<string, string>) || {};
  const primaryColumn = columns.find((col) => col.displayOnly) || columns[0];
  const title = p.modelNo || (primaryColumn ? specs[primaryColumn.key] : '') || p.name || '未命名产品';
  const cleanName = cleanProductName(p.name, p.modelNo);
  const subtitle = cleanName && cleanName !== title ? cleanName : '';
  const displayColumns = columns.filter((col) => col.key !== primaryColumn?.key).slice(0, 6);

  return (
    <div
      className={`rounded-xl border border-outline-variant/10 bg-surface-container-low p-3 shadow-sm ${
        p.hidden ? 'opacity-55' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          name="select-product"
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(p.id)}
          className="mt-1 h-4 w-4 shrink-0 accent-primary-container"
          aria-label={`选择 ${p.modelNo || p.name}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold leading-snug text-on-surface break-words">
            <span>{title}</span>
            {p.hidden ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-container-high px-1.5 py-0.5 text-[9px] font-medium text-on-surface-variant/70">
                <Icon name="visibility_off" size={10} />
                隐藏
              </span>
            ) : null}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-xs leading-snug text-on-surface-variant break-words">{subtitle}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onToggleHidden(p)}
            className={p.hidden ? SELECTION_ICON_BUTTON_ACTIVE : SELECTION_ICON_BUTTON_EDIT}
            data-tooltip-ignore
            aria-label={p.hidden ? '恢复产品参与选型' : '隐藏产品（不参与选型）'}
          >
            <Icon name={p.hidden ? 'visibility_off' : 'visibility'} size={14} />
          </button>
          <button
            onClick={() => onEdit(p)}
            className={SELECTION_ICON_BUTTON_EDIT}
            data-tooltip-ignore
            aria-label="编辑产品"
          >
            <Icon name="edit" size={14} />
          </button>
          {isDeleting ? (
            <>
              <button
                onClick={() => onConfirmDelete(p.id)}
                className="h-8 px-2 text-[10px] font-bold bg-error text-on-error-container rounded"
              >
                确认
              </button>
              <button
                onClick={onCancelDelete}
                className="h-8 px-2 text-[10px] text-on-surface-variant bg-surface-container-high rounded"
              >
                取消
              </button>
            </>
          ) : (
            <button
              onClick={() => onRequestDelete(p.id)}
              className={SELECTION_ICON_BUTTON_DELETE}
              data-tooltip-ignore
              aria-label="删除产品"
            >
              <Icon name="delete" size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {displayColumns.map((col) => (
          <div key={col.key} className="min-w-0 rounded-lg bg-surface-container-lowest px-2 py-1.5">
            <div className="truncate text-[10px] leading-tight text-on-surface-variant">
              {col.label || col.key}
              {col.unit ? ` (${col.unit})` : ''}
            </div>
            <div className="mt-0.5 text-xs font-medium leading-snug text-on-surface break-words line-clamp-2">
              {specs[col.key] ?? '—'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

function Content() {
  const { toast } = useToast();
  const businessConfig = useMemo(() => getBusinessConfig(), []);
  const { uploadPolicy, pageSizePolicy } = businessConfig;
  const productRenderBatchSize = Math.max(20, Number(pageSizePolicy.selectionAdminRenderBatch) || 120);
  const initialGeneratePreviewPageSize = Math.max(1, Number(pageSizePolicy.selectionGeneratePreviewPageSize) || 50);
  const [tab, setTab] = useState<Tab>('categories');
  const [catFilter, setCatFilter] = useState<'all' | 'empty'>('all');
  const {
    value: catSearch,
    draftValue: catSearchInputValue,
    setValue: setCatSearch,
    inputProps: catSearchInputProps,
  } = useImeSafeSearchInput();

  // Category state
  const [showCatModal, setShowCatModal] = useState(false);
  const [editCat, setEditCat] = useState<SelectionCategory | null>(null);
  const [catForm, setCatForm] = useState({
    name: '',
    slug: '',
    description: '',
    icon: '',
    image: '',
    kitListTitle: '',
    columns: [] as ColumnDef[],
    catalogPdf: '',
    catalogShared: false,
  });
  const [deleteCatId, setDeleteCatId] = useState<string | null>(null);
  // 选型分类「强制删除」二次确认：分类下有产品时后端返回 409 HAS_PRODUCTS，
  // 前端弹此确认框，让管理员明确「将连带删除 N 个产品」后再带 force 删除。
  const [forceDeleteCat, setForceDeleteCat] = useState<{ id: string; name: string; count: number } | null>(null);
  const [showCatSortModal, setShowCatSortModal] = useState(false);
  const [catSortItems, setCatSortItems] = useState<{ id: string; name: string }[]>([]);
  const [catSortDragIdx, setCatSortDragIdx] = useState<number | null>(null);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupItems, setGroupItems] = useState<
    { id: string; name: string; icon: string; image: string; imageFit: 'cover' | 'contain'; catCount: number }[]
  >([]);
  const [groupForm, setGroupForm] = useState({
    name: '',
    icon: 'category',
    image: '',
    imageFit: 'cover' as 'cover' | 'contain',
  });
  const [groupDragIdx, setGroupDragIdx] = useState<number | null>(null);
  const [deleteGroupId, setDeleteGroupId] = useState<string | null>(null);
  const [removeGroupCatId, setRemoveGroupCatId] = useState<string | null>(null);
  const [manageGroupCatsId, setManageGroupCatsId] = useState<string | null>(null);
  const groupCoverInputRef = useRef<HTMLInputElement | null>(null);

  // Product state
  const [selectedCatId, setSelectedCatId] = useState<string>('');
  const [productCatOpen, setProductCatOpen] = useState(false);
  const {
    value: productCatQuery,
    setValue: setProductCatQuery,
    inputProps: productCatQueryInputProps,
  } = useImeSafeSearchInput();
  const productCatPickerRef = useRef<HTMLDivElement | null>(null);
  const [showProdModal, setShowProdModal] = useState(false);
  const [editProd, setEditProd] = useState<SelectionProduct | null>(null);
  const [prodForm, setProdForm] = useState({
    name: '',
    modelNo: '',
    specs: {} as Record<string, string>,
    image: '',
    pdfUrl: '',
    isKit: false,
    components: [] as SelectionComponent[],
  });
  const [deleteProdId, setDeleteProdId] = useState<string | null>(null);
  // 批量操作：选中集合 + 确认弹窗 + 执行中
  const [selectedProdIds, setSelectedProdIds] = useState<Set<string>>(new Set());
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [productAssetDragging, setProductAssetDragging] = useState(false);
  const [productAssetUploading, setProductAssetUploading] = useState(false);
  const productAssetInputRef = useRef<HTMLInputElement | null>(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  // 选型分类数据包搬运（本地站 ↔ 服务器站）：导出/导入弹窗
  const [showTransferExport, setShowTransferExport] = useState(false);
  const [showTransferImport, setShowTransferImport] = useState(false);
  // 套件子零件批量导入（粘贴文本解析）
  const [kitImportOpen, setKitImportOpen] = useState(false);
  const [kitImportText, setKitImportText] = useState('');
  // 子零件附加参数列（导入时表头自动识别，如「编码」）：取现有清单里出现过的 key 并集，
  // 行编辑器按此渲染对应输入框，导入带了哪些附加列这里就能编辑哪些
  const kitSpecKeys = [...new Set(prodForm.components.flatMap((c) => Object.keys(c.specs || {})))];
  const [batchParsed, setBatchParsed] = useState<Array<{
    name: string;
    modelNo?: string;
    specs?: Record<string, string>;
    image?: string;
    pdfUrl?: string;
    isKit?: boolean;
    components?: import('../api/selections').SelectionComponent[];
  }> | null>(null);
  const [batchErrors, setBatchErrors] = useState<string[]>([]);
  const [batchImporting, setBatchImporting] = useState(false);
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [generateModelTemplate, setGenerateModelTemplate] = useState('');
  const [generateNameTemplate, setGenerateNameTemplate] = useState('');
  const [generateOptionTexts, setGenerateOptionTexts] = useState<Record<string, string>>({});
  const [generateExcludeRules, setGenerateExcludeRules] = useState('');
  const [generatePreview, setGeneratePreview] = useState<GeneratedProductDraft[]>([]);
  const [generatePreviewPageSize, setGeneratePreviewPageSize] = useState(initialGeneratePreviewPageSize);
  const [generatePreviewPage, setGeneratePreviewPage] = useState(1);
  const {
    value: generatePreviewSearch,
    draftValue: generatePreviewSearchInputValue,
    setValue: setGeneratePreviewSearch,
    inputProps: generatePreviewSearchInputProps,
  } = useImeSafeSearchInput({ onCommit: () => setGeneratePreviewPage(1) });
  const [generateErrors, setGenerateErrors] = useState<string[]>([]);
  const [generateImporting, setGenerateImporting] = useState(false);
  const [showOptImgModal, setShowOptImgModal] = useState(false);
  const [optImgField, setOptImgField] = useState<string>('');
  const {
    value: optSettingsSearch,
    draftValue: optSettingsSearchInputValue,
    setValue: setOptSettingsSearch,
    inputProps: optSettingsSearchInputProps,
  } = useImeSafeSearchInput();
  const [uploadingVal, setUploadingVal] = useState<string | null>(null);
  const [editOptVal, setEditOptVal] = useState<string | null>(null);
  // 画册专属拖拽目标悬停态（区别于整弹窗拖拽态 optDragActive）
  const [optCatalogDragActive, setOptCatalogDragActive] = useState(false);
  // 悬停即粘贴目标：鼠标停在哪个上传区，Cmd+V 就传哪个区（null=弹窗外，走默认分流 图片→选项图/PDF→画册）
  const [optPasteZone, setOptPasteZone] = useState<'image' | 'catalog' | null>(null);
  // 选项设置网格里悬停的选项卡图片：单选项弹窗没开时，悬停哪张卡片粘贴就传哪个选项值
  const [hoverOptVal, setHoverOptVal] = useState<string | null>(null);
  // 选项值 → 产品反查弹窗（点选项卡上的「N 型」角标打开）
  const [valueProductsView, setValueProductsView] = useState<{ field: string; value: string } | null>(null);
  // 反查弹窗内「批量修改」：选列（名称/参数列）+ 填值 → 统一应用到当前选项值命中的全部产品
  const [batchFieldEditOpen, setBatchFieldEditOpen] = useState(false);
  const [batchFieldKey, setBatchFieldKey] = useState('name');
  const [batchFieldValue, setBatchFieldValue] = useState('');
  const [batchFieldBusy, setBatchFieldBusy] = useState(false);
  // 批量修改列选择：自定义下拉（同 optFieldPicker 原因——原生 select 在弹窗内偶发跳动）
  const [batchFieldPickerOpen, setBatchFieldPickerOpen] = useState(false);
  const batchFieldPickerRef = useRef<HTMLDivElement | null>(null);

  const [renameField, setRenameField] = useState<string>('');
  const [renameOldVal, setRenameOldVal] = useState<string>('');
  const [renameNewVal, setRenameNewVal] = useState<string>('');
  const [renaming, setRenaming] = useState(false);

  // Lock body scroll when settings modal or sub-dialog is open
  useEffect(() => {
    if (showOptImgModal || editOptVal || renameOldVal) {
      const y = window.scrollY;
      document.body.style.position = 'fixed';
      document.body.style.top = `-${y}px`;
      document.body.style.width = '100%';
      return () => {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        window.scrollTo(0, y);
      };
    }
  }, [showOptImgModal, editOptVal, renameOldVal]);
  // 选项设置字段选择：自定义下拉（原生 select 在弹窗内偶发跳动/闪跳，样式也不可控）
  const [optFieldOpen, setOptFieldOpen] = useState(false);
  const optFieldPickerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!optFieldOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!optFieldPickerRef.current?.contains(event.target as Node)) {
        setOptFieldOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOptFieldOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [optFieldOpen]);
  useEffect(() => {
    if (!batchFieldPickerOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!batchFieldPickerRef.current?.contains(event.target as Node)) {
        setBatchFieldPickerOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBatchFieldPickerOpen(false);
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [batchFieldPickerOpen]);
  // 反查弹窗关闭：重置批量修改面板，下次打开（可能换了选项值/分类）不残留旧值
  useEffect(() => {
    if (valueProductsView) return;
    setBatchFieldEditOpen(false);
    setBatchFieldKey('name');
    setBatchFieldValue('');
    setBatchFieldPickerOpen(false);
  }, [valueProductsView]);
  useEffect(() => {
    if (!productCatOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!productCatPickerRef.current?.contains(event.target as Node)) {
        setProductCatOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [productCatOpen]);
  const [orderItems, setOrderItems] = useState<string[]>([]);
  const [orderDragIdx, setOrderDragIdx] = useState<number | null>(null);
  const [optViewMode, setOptViewMode] = useState<'grid' | 'list'>('grid');
  const [optDragActive, setOptDragActive] = useState(false);
  const productTableScrollRef = useRef<HTMLDivElement | null>(null);
  /** 当前编辑弹窗对应的产品 id：丢弃编辑切换后到达的过期 components 拉取 */
  const editProdIdRef = useRef<string | null>(null);

  // 管理端拉全量（含隐藏分类）：独立 SWR key，避免污染公开选型页的 categories 缓存
  const { data: categories = [], mutate: mutateCats } = useSWR('selections/categories-admin', () =>
    getSelectionCategories({ includeHidden: true }),
  );

  const patchGroupCategoryCache = useCallback(
    (
      groupId: string,
      patch: Partial<Pick<SelectionCategory, 'groupId' | 'groupName' | 'groupIcon' | 'groupImage' | 'groupImageFit'>>,
    ) => {
      void mutateCats(
        (current) =>
          (current || []).map((category) =>
            category.groupId === groupId
              ? {
                  ...category,
                  ...patch,
                }
              : category,
          ),
        { populateCache: true, revalidate: true },
      );
    },
    [mutateCats],
  );

  const patchSelectionCategoryCache = useCallback(
    (categoryId: string, patch: Partial<SelectionCategory>) => {
      void mutateCats(
        (current) =>
          (current || []).map((category) =>
            category.id === categoryId
              ? {
                  ...category,
                  ...patch,
                }
              : category,
          ),
        { populateCache: true, revalidate: true },
      );
    },
    [mutateCats],
  );

  const saveManagedGroupCoverFile = useCallback(
    async (file: File) => {
      if (!manageGroupCatsId) return;
      const currentGroup = groupItems.find((item) => item.id === manageGroupCatsId);
      const imageFit = currentGroup?.imageFit || 'cover';
      try {
        const { url } = await uploadOptionImage(file);
        await updateSelectionGroup(manageGroupCatsId, {
          groupImage: url || null,
          groupImageFit: imageFit,
        });
        setGroupItems((items) =>
          items.map((item) => (item.id === manageGroupCatsId ? { ...item, image: url, imageFit } : item)),
        );
        patchGroupCategoryCache(manageGroupCatsId, { groupImage: url || null, groupImageFit: imageFit });
        toast('分组封面已粘贴上传', 'success');
      } catch (err) {
        toast(getApiErrorMessage(err, '上传失败'), 'error');
      }
    },
    [groupItems, manageGroupCatsId, patchGroupCategoryCache, toast],
  );

  useEffect(() => {
    if (!showGroupModal || !manageGroupCatsId) return;
    const handleGlobalGroupCoverPaste = (event: ClipboardEvent) => {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      void saveManagedGroupCoverFile(file);
    };
    window.addEventListener('paste', handleGlobalGroupCoverPaste, true);
    return () => window.removeEventListener('paste', handleGlobalGroupCoverPaste, true);
  }, [manageGroupCatsId, saveManagedGroupCoverFile, showGroupModal]);

  // Products for selected category（含隐藏产品，便于管理端看到/恢复）
  const { data: productsData, mutate: mutateProds } = useSWR(
    selectedCatId ? `selections/admin/products/${selectedCatId}` : null,
    async () => {
      const cat = categories.find((c) => c.id === selectedCatId);
      if (!cat) return null;
      return getSelectionProducts(cat.slug, 1, 5000, '', { includeHidden: true });
    },
  );

  const products = useMemo(() => productsData?.items ?? [], [productsData]);
  const {
    value: prodSearch,
    draftValue: prodSearchInputValue,
    setValue: setProdSearch,
    inputProps: prodSearchInputProps,
  } = useImeSafeSearchInput();
  const filteredProducts = useMemo(() => {
    if (!prodSearch) return products;
    const q = prodSearch.toLowerCase();
    return products.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.modelNo || '').toLowerCase().includes(q) ||
        Object.values(p.specs as Record<string, string>).some((v) => v.toLowerCase().includes(q)),
    );
  }, [products, prodSearch]);
  const {
    visibleItems: visibleProducts,
    hasMore: hasMoreProducts,
    loadMore: loadMoreProducts,
  } = useVisibleItems(filteredProducts, productRenderBatchSize, `${selectedCatId}:${prodSearch}`);
  const handleProductTableScroll = () => {
    const node = productTableScrollRef.current;
    if (!node || !hasMoreProducts) return;
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distanceToBottom < 320) loadMoreProducts();
  };
  const productCategoryOptions = useMemo(() => {
    const q = productCatQuery.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q) ||
        (c.groupName || '').toLowerCase().includes(q),
    );
  }, [categories, productCatQuery]);

  // ---- Category handlers ----
  function openNewCat() {
    setEditCat(null);
    setCatForm({
      name: '',
      slug: '',
      description: '',
      icon: '',
      image: '',
      kitListTitle: '',
      columns: [],
      catalogPdf: '',
      catalogShared: false,
    });
    setShowCatModal(true);
  }
  function openEditCat(cat: SelectionCategory) {
    setEditCat(cat);
    const optionOrder = (cat.optionOrder || {}) as Record<string, string[] | string>;
    setCatForm({
      name: cat.name,
      slug: cat.slug,
      description: cat.description || '',
      icon: cat.icon || '',
      image: cat.image || '',
      kitListTitle:
        typeof optionOrder[KIT_LIST_TITLE_OPTION_KEY] === 'string'
          ? (optionOrder[KIT_LIST_TITLE_OPTION_KEY] as string)
          : '',
      catalogPdf: cat.catalogPdf || '',
      catalogShared: cat.catalogShared || false,
      columns: cat.columns as ColumnDef[],
    });
    setShowCatModal(true);
  }
  async function saveCat() {
    try {
      const { kitListTitle, ...basePayload } = catForm;
      const optionOrder = { ...((editCat?.optionOrder || {}) as Record<string, string[] | string>) };
      const normalizedKitListTitle = kitListTitle.trim();
      if (normalizedKitListTitle) optionOrder[KIT_LIST_TITLE_OPTION_KEY] = normalizedKitListTitle;
      else delete optionOrder[KIT_LIST_TITLE_OPTION_KEY];
      const payload = { ...basePayload, optionOrder };
      if (editCat) {
        await updateCategory(editCat.id, payload);
        toast('分类已更新', 'success');
      } else {
        await createCategory(payload);
        toast('分类已创建', 'success');
      }
      setShowCatModal(false);
      mutateCats();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, '操作失败'), 'error');
    }
  }
  async function handleDeleteCat(id: string, force = false) {
    try {
      await deleteCategory(id, { force });
      toast('分类已删除', 'success');
      setDeleteCatId(null);
      setForceDeleteCat(null);
      if (selectedCatId === id) setSelectedCatId('');
      mutateCats();
    } catch (err: unknown) {
      const apiErr = err as {
        response?: { status?: number; data?: { code?: string; productCount?: number } };
      };
      if (!force && apiErr?.response?.status === 409 && apiErr.response.data?.code === 'HAS_PRODUCTS') {
        // 分类下有产品：后端拒绝静默删除，弹二次确认让管理员明确连带删除的代价
        const cat = categories.find((c) => c.id === id);
        setForceDeleteCat({
          id,
          name: cat?.name || '',
          count: apiErr.response.data?.productCount ?? 0,
        });
        setDeleteCatId(null);
        return;
      }
      toast(getApiErrorMessage(err, '删除失败'), 'error');
    }
  }

  /* 隐藏开关：开启后分类/产品不再出现在公开选型页、不参与选型（管理端仍可见可编辑，方便配置好再上线） */
  async function toggleCatHidden(cat: SelectionCategory) {
    const next = !cat.hidden;
    try {
      await updateCategory(cat.id, { hidden: next });
      mutateCats();
      toast(next ? `「${cat.name}」已隐藏（公开选型页不显示）` : `「${cat.name}」已恢复显示`, 'success');
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, '操作失败'), 'error');
    }
  }

  // memo 行组件依赖稳定的 handler 引用，避免无关 setState 时全表重渲染
  const toggleProdHidden = useCallback(
    async (p: SelectionProduct) => {
      const next = !p.hidden;
      try {
        await updateProduct(p.id, { hidden: next });
        mutateProds();
        toast(
          next ? `「${p.modelNo || p.name}」已隐藏（不参与选型）` : `「${p.modelNo || p.name}」已恢复参与选型`,
          'success',
        );
      } catch (err: unknown) {
        toast(getApiErrorMessage(err, '操作失败'), 'error');
      }
    },
    [mutateProds, toast],
  );

  // ---- Product handlers ----
  const activeCat = categories.find((c) => c.id === selectedCatId);
  const noProductCat = tab !== 'products' || !selectedCatId || !activeCat;
  const productColumns = (activeCat?.columns as ColumnDef[]) || [];
  const productsLoading = Boolean(selectedCatId && activeCat && !productsData);
  const selectableProductColumns = generatableProductColumns(productColumns);
  const generateCat = activeCat;
  const generateColumns = (generateCat?.columns as ColumnDef[]) || [];
  const selectableGenerateColumns = generatableProductColumns(generateColumns);
  const generateTemplateExample = selectableGenerateColumns.length
    ? `[${selectableGenerateColumns[0].key}]`
    : '[字段A]-[字段B]-[字段C]';
  const generateExcludeExample = selectableGenerateColumns.length
    ? (() => {
        const [first, second, third] = selectableGenerateColumns;
        const firstKey = first?.key || '字段A';
        const secondKey = second?.key || '字段B';
        const thirdKey = third?.key || secondKey;
        return `例：${firstKey}=不允许值 && ${secondKey}=*\n例：${firstKey}=A && ${thirdKey}=B|C`;
      })()
    : '例：字段A=不允许值 && 字段B=*\n例：字段A=A && 字段C=B|C';
  const filteredGeneratePreview = useMemo(() => {
    const q = generatePreviewSearch.trim().toLowerCase();
    if (!q) return generatePreview;
    return generatePreview.filter((item) => {
      const values = [item.name, item.modelNo, ...Object.values(item.specs || {})];
      return values.some((value) =>
        String(value || '')
          .toLowerCase()
          .includes(q),
      );
    });
  }, [generatePreview, generatePreviewSearch]);
  const generatePreviewTotalPages = Math.max(1, Math.ceil(filteredGeneratePreview.length / generatePreviewPageSize));
  const generatePreviewStart = (generatePreviewPage - 1) * generatePreviewPageSize;
  const pagedGeneratePreview = filteredGeneratePreview.slice(
    generatePreviewStart,
    generatePreviewStart + generatePreviewPageSize,
  );

  useEffect(() => {
    if (generatePreviewPage > generatePreviewTotalPages) {
      setGeneratePreviewPage(generatePreviewTotalPages);
    }
  }, [generatePreviewPage, generatePreviewTotalPages]);

  function openNewProd() {
    if (!selectedCatId) {
      toast('请先选择分类', 'error');
      return;
    }
    editProdIdRef.current = null;
    setEditProd(null);
    setProdForm({ name: '', modelNo: '', specs: {}, image: '', pdfUrl: '', isKit: false, components: [] });
    setShowProdModal(true);
  }
  const openEditProd = useCallback((prod: SelectionProduct) => {
    const modelNo = prod.modelNo || '';
    editProdIdRef.current = prod.id;
    setEditProd(prod);
    setProdForm({
      name: cleanProductName(prod.name, modelNo),
      modelNo,
      specs: { ...(prod.specs as Record<string, string>) },
      image: prod.image || '',
      pdfUrl: prod.pdfUrl || '',
      isKit: prod.isKit ?? false,
      components: (prod.components as SelectionComponent[]) ?? [],
    });
    setShowProdModal(true);
    // 子零件清单占列表响应 ~44%，列表接口已剔除；编辑时单独拉取补齐。
    // 竞态防护：切换到其他产品/新建后丢弃过期响应；保存时 components 为 undefined 不会覆盖库内清单
    if (prod.components == null) {
      void (async () => {
        try {
          const full = await getSelectionProductById(prod.id);
          if (editProdIdRef.current !== prod.id) return;
          setProdForm((prev) =>
            prev.components.length === 0
              ? { ...prev, components: (full.components as SelectionComponent[]) ?? [] }
              : prev,
          );
        } catch {
          // 拉取失败不阻断编辑，子零件清单保持为空展示
        }
      })();
    }
  }, []);
  async function saveProd() {
    try {
      const modelNo = prodForm.modelNo || undefined;
      const payload = {
        name: cleanProductName(prodForm.name, modelNo),
        modelNo,
        specs: prodForm.specs,
        image: prodForm.image || undefined,
        pdfUrl: prodForm.pdfUrl || undefined,
        isKit: prodForm.isKit,
        components: prodForm.isKit && prodForm.components.length > 0 ? prodForm.components : undefined,
      };
      if (editProd) {
        await updateProduct(editProd.id, payload);
        toast('产品已更新', 'success');
      } else {
        await createProduct({ categoryId: selectedCatId, ...payload });
        toast('产品已创建', 'success');
      }
      setShowProdModal(false);
      mutateProds();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, '操作失败'), 'error');
    }
  }
  const handleDeleteProd = useCallback(
    async (id: string) => {
      try {
        await deleteProduct(id);
        toast('产品已删除', 'success');
        setDeleteProdId(null);
        mutateProds();
      } catch (err: unknown) {
        toast(getApiErrorMessage(err, '删除失败'), 'error');
      }
    },
    [mutateProds, toast],
  );
  const cancelDeleteProd = useCallback(() => setDeleteProdId(null), []);

  // ---- 批量操作（memo 行的稳定 handler：空依赖，只做 setState） ----
  const toggleProdSelected = useCallback((id: string) => {
    setSelectedProdIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearProdSelection = useCallback(() => setSelectedProdIds(new Set()), []);
  const handleBatchUpdateHidden = async (hidden: boolean) => {
    const ids = Array.from(selectedProdIds);
    if (!ids.length || batchBusy) return;
    setBatchBusy(true);
    try {
      const { updated } = await batchUpdateSelectionProductsHidden(ids, hidden);
      toast(hidden ? `已隐藏 ${updated} 个产品` : `已恢复 ${updated} 个产品参与选型`, 'success');
      setSelectedProdIds(new Set());
      mutateProds();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, '批量操作失败'), 'error');
    } finally {
      setBatchBusy(false);
    }
  };
  // 反查弹窗「批量修改」：把当前选项值命中的全部产品的所选列统一设置为填写值
  const handleBatchFieldUpdate = async () => {
    if (!valueProductsView || batchFieldBusy) return;
    const value = batchFieldValue.trim();
    if (!value) {
      toast('请填写要设置的值', 'error');
      return;
    }
    // 与 productsByOptionValue 同语义（specs[field] === value 的全部产品），但该 memo 定义在本函数之后，
    // 这里直接从 products 过滤，避免 no-use-before-define
    const matched = products.filter(
      (p) => (p.specs as Record<string, string>)[valueProductsView.field] === valueProductsView.value,
    );
    if (!matched.length) return;
    setBatchFieldBusy(true);
    try {
      const { updated } = await batchUpdateSelectionProductField(
        matched.map((p) => p.id),
        batchFieldKey,
        value,
      );
      const fieldLabel =
        batchFieldKey === 'name'
          ? '名称'
          : activeCat?.columns.find((c) => c.key === batchFieldKey)?.label || batchFieldKey;
      toast(`已将 ${updated} 个产品的${fieldLabel}统一设置为「${value}」`, 'success');
      setBatchFieldEditOpen(false);
      setBatchFieldValue('');
      mutateProds();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, '批量修改失败'), 'error');
    } finally {
      setBatchFieldBusy(false);
    }
  };
  const handleBatchDeleteProducts = async () => {
    const ids = Array.from(selectedProdIds);
    if (!ids.length || batchBusy) return;
    setBatchBusy(true);
    try {
      const { deleted } = await batchDeleteSelectionProducts(ids);
      toast(`已删除 ${deleted} 个产品`, 'success');
      setBatchDeleteConfirmOpen(false);
      setSelectedProdIds(new Set());
      mutateProds();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, '批量删除失败'), 'error');
    } finally {
      setBatchBusy(false);
    }
  };
  // 搜索/切分类后 filteredProducts 变化：剔除已消失的 id，选择集自动收敛
  useEffect(() => {
    setSelectedProdIds((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(filteredProducts.map((p) => p.id));
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredProducts]);
  async function handleProductAssetFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    const validFiles = files.filter((file) => productAssetKind(file));
    if (!validFiles.length) {
      toast('只支持上传图片或 PDF 文件', 'error');
      return;
    }

    setProductAssetUploading(true);
    try {
      let imageCount = 0;
      let pdfCount = 0;
      for (const file of validFiles) {
        const expectedKind = productAssetKind(file);
        if (!expectedKind) continue;
        const { url, type } = await uploadSelectionProductAsset(file);
        const kind = type || expectedKind;
        setProdForm((prev) => ({
          ...prev,
          image: kind === 'image' ? url : prev.image,
          pdfUrl: kind === 'pdf' ? url : prev.pdfUrl,
        }));
        if (kind === 'image') imageCount += 1;
        if (kind === 'pdf') pdfCount += 1;
      }
      const parts = [imageCount ? `${imageCount} 张图片` : '', pdfCount ? `${pdfCount} 个 PDF` : ''].filter(Boolean);
      toast(`${parts.join('、')}已上传`, 'success');
    } catch (err) {
      toast(getApiErrorMessage(err, '上传失败'), 'error');
    } finally {
      setProductAssetUploading(false);
      setProductAssetDragging(false);
    }
  }
  async function handleProductAssetPaste(e: React.ClipboardEvent) {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      if (file && productAssetKind(file)) files.push(file);
    }
    if (files.length) {
      e.preventDefault();
      await handleProductAssetFiles(files);
      return;
    }

    const text = e.clipboardData.getData('text/plain')?.trim();
    if (!text) return;
    if (/\.(pdf)(\?.*)?$/i.test(text) || /^https?:\/\/.+/i.test(text)) {
      if (/\.(pdf)(\?.*)?$/i.test(text)) {
        e.preventDefault();
        setProdForm((prev) => ({ ...prev, pdfUrl: text }));
        toast('PDF 链接已粘贴', 'success');
      } else if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(text)) {
        e.preventDefault();
        toast('正在下载图片...', 'info');
        try {
          const { url } = await uploadOptionImageFromUrl(text);
          setProdForm((prev) => ({ ...prev, image: url }));
          toast('图片已下载并保存', 'success');
        } catch {
          setProdForm((prev) => ({ ...prev, image: text }));
          toast('图片链接已粘贴，远程保存失败', 'error');
        }
      }
    }
  }
  async function handleBatchImport() {
    if (!batchParsed || batchParsed.length === 0) return;
    setBatchImporting(true);
    try {
      const { created, updated } = await batchImportProducts(selectedCatId, batchParsed);
      const msg = updated > 0 ? `导入完成：新增 ${created} 个，更新 ${updated} 个` : `成功导入 ${created} 个产品`;
      toast(msg, 'success');
      setShowBatchModal(false);
      setBatchParsed(null);
      setBatchErrors([]);
      mutateProds();
      mutateCats();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, '导入失败'), 'error');
    } finally {
      setBatchImporting(false);
    }
  }

  /* 子零件导入：读取 .xlsx / .csv 表格 → 制表符文本，交给 parseKitComponentLines（表头驱动解析） */
  async function handleKitImportFile(file: File) {
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('文件不能超过 5MB');
      const lowerName = file.name.toLowerCase();
      let rows: unknown[][];
      if (lowerName.endsWith('.csv')) {
        rows = parseCsvRows(await file.text());
      } else if (lowerName.endsWith('.xlsx')) {
        const { readSheet } = await import('read-excel-file/browser');
        rows = (await readSheet(file)) as unknown[][];
      } else {
        throw new Error('仅支持 .xlsx / .csv 文件');
      }
      const lines = rows
        .map((row) => row.map((cell) => normalizeImportCell(cell)))
        .filter((cells) => cells.some(Boolean))
        .map((cells) => cells.join('\t'));
      if (lines.length === 0) throw new Error('文件中没有数据');
      setKitImportText(lines.join('\n'));
      toast(`已读取 ${file.name}，请核对下方解析结果`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : '文件解析失败，请确认是有效的 .xlsx / .csv 文件', 'error');
    }
  }

  async function downloadKitImportTemplate() {
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const rows: SheetData = [
      [
        { value: '名称', fontWeight: 'bold' as const },
        { value: '型号', fontWeight: 'bold' as const },
        { value: '编码', fontWeight: 'bold' as const },
        { value: '数量', fontWeight: 'bold' as const },
      ],
      [{ value: '弯头接头' }, { value: 'PC4-M5' }, { value: 'KAC-001' }, { value: 2 }],
      [{ value: 'PC4-0.5' }, { value: '' }, { value: 'KAC-002' }, { value: 4 }],
    ];
    await writeXlsxFile(rows, { sheet: '子零件导入模板' }).toFile('kit_components_import_template.xlsx');
    toast('已下载子零件导入模板', 'success');
  }

  function handleExcelFile(file: File) {
    setBatchErrors([]);
    setBatchParsed(null);
    void (async () => {
      try {
        const rows = await readProductImportRows(file, uploadPolicy);
        if (rows.length === 0) {
          setBatchErrors(['文件中没有数据']);
          return;
        }

        const cols = (activeCat?.columns as ColumnDef[]) || [];
        const colMap = new Map<string, string>();
        cols.forEach((c) => {
          colMap.set(c.key, c.key);
          if (c.label) colMap.set(c.label, c.key);
        });

        const errors: string[] = [];
        const parsed: NonNullable<typeof batchParsed> = [];
        const seenModelNos = new Set<string>();

        rows.forEach((row, i) => {
          const specs: Record<string, string> = {};
          const modelNo = firstRowValue(row, PRODUCT_MODEL_HEADERS);
          const rawName = firstRowValue(row, PRODUCT_NAME_HEADERS);
          for (const [header, val] of Object.entries(row)) {
            if (!val) continue;
            if (PRODUCT_NAME_HEADERS.includes(header) || PRODUCT_MODEL_HEADERS.includes(header)) continue;
            const key = colMap.get(header);
            if (key) {
              specs[key] = val;
            } else if (header === '图片') {
              // skip, handled below
            } else if (header === 'PDF链接') {
              // skip
            } else if (header === '是否套件') {
              // skip
            } else if (header === '组件(JSON)') {
              // skip
            }
          }

          if (modelNo) specs['型号'] = modelNo;
          const name = cleanProductName(
            rawName || modelNo || Object.values(specs).find(Boolean) || `产品 ${i + 1}`,
            modelNo,
          );
          if (!modelNo) {
            errors.push(`第 ${i + 2} 行：缺少型号编号，导入后无法按型号自动更新`);
          } else if (seenModelNos.has(modelNo)) {
            errors.push(`第 ${i + 2} 行：型号编号 ${modelNo} 在文件中重复，将以后面的数据为准`);
          }
          if (modelNo) seenModelNos.add(modelNo);

          const product: NonNullable<typeof batchParsed>[number] = {
            name,
            modelNo,
            specs,
            image: row['图片'] || '',
            pdfUrl: row['PDF链接'] || '',
          };

          const isKitVal = row['是否套件'];
          if (isKitVal === '是' || isKitVal === 'true' || isKitVal === '1') {
            product.isKit = true;
          }

          const compStr = row['组件(JSON)'];
          if (compStr && compStr.trim()) {
            try {
              product.components = JSON.parse(compStr);
            } catch {
              errors.push(`第 ${i + 2} 行：组件 JSON 解析失败`);
            }
          }

          parsed.push(product);
        });

        if (errors.length > 0) setBatchErrors(errors);
        setBatchParsed(parsed);
      } catch (err) {
        setBatchErrors([err instanceof Error ? err.message : '文件解析失败，请确认是有效的 .xlsx / .csv 文件']);
      }
    })();
  }

  async function downloadProductImportTemplate() {
    if (!activeCat) {
      toast('请先选择分类', 'error');
      return;
    }
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const headers = productImportHeaders(productColumns);
    const rows: SheetData = [headers.map((header) => ({ value: header, fontWeight: 'bold' as const }))];
    await writeXlsxFile(rows, { sheet: '产品导入模板' }).toFile(`${activeCat.slug || 'products'}_import_template.xlsx`);
    toast('已下载导入模板', 'success');
  }

  async function exportCurrentProducts() {
    if (!activeCat) {
      toast('请先选择分类', 'error');
      return;
    }
    if (!products.length) {
      toast('没有可导出的产品', 'error');
      return;
    }
    // 列表数据不含子零件清单（体积优化），导出需要「组件(JSON)」列，单独拉一次全量
    let exportItems = products;
    try {
      toast('正在准备导出数据（含子零件清单）...', 'info');
      const full = await getSelectionProducts(activeCat.slug, 1, 5000, '', {
        includeHidden: true,
        includeComponents: true,
      });
      if (full.items.length) exportItems = full.items;
    } catch {
      toast('拉取完整数据失败，子零件清单列将为空', 'error');
    }
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const cols = productColumns;
    const headers = productImportHeaders(cols);
    const rows: SheetData = [headers.map((header) => ({ value: header, fontWeight: 'bold' as const }))];
    exportItems.forEach((p) => {
      const specs = p.specs as Record<string, string>;
      const baseRow: Record<string, string> = {
        名称: safeSpreadsheetText(p.name),
        型号编号: safeSpreadsheetText(p.modelNo),
        图片: safeSpreadsheetText(p.image),
        PDF链接: safeSpreadsheetText(p.pdfUrl),
        是否套件: p.isKit ? '是' : '否',
        '组件(JSON)': p.components ? safeSpreadsheetText(JSON.stringify(p.components)) : '',
      };
      cols
        .filter((col) => col.key !== '型号')
        .forEach((col) => {
          baseRow[col.label || col.key] = safeSpreadsheetText(specs[col.key]);
        });
      rows.push(headers.map((header) => baseRow[header] ?? ''));
    });
    await writeXlsxFile(rows, { sheet: '产品' }).toFile(`${activeCat.slug || 'products'}_products.xlsx`);
    toast(`已导出 ${exportItems.length} 个产品`, 'success');
  }

  // ---- Option Image handlers ----
  const optImages = (activeCat?.optionImages ?? {}) as Record<string, Record<string, string>>;
  const optCatalogs = (activeCat?.optionCatalogs ?? {}) as Record<string, Record<string, string>>;

  // Extract unique option values per field from product data
  const fieldOptions = useMemo(() => {
    if (!activeCat) return {};
    const result: Record<string, string[]> = {};
    for (const col of activeCat.columns) {
      const vals = new Set<string>();
      for (const p of products) {
        const v = (p.specs as Record<string, string>)[col.key];
        if (v) vals.add(v);
      }
      if (vals.size > 0) result[col.key] = Array.from(vals).sort();
    }
    return result;
  }, [activeCat, products]);
  // 「字段+选项值 → 命中产品」反查索引：选项值卡片角标计数 + 反查弹窗数据源
  const productsByOptionValue = useMemo(() => {
    const map = new Map<string, SelectionProduct[]>();
    for (const p of products) {
      const specs = (p.specs as Record<string, unknown>) || {};
      for (const [field, value] of Object.entries(specs)) {
        if (typeof value !== 'string' || !value) continue;
        const key = `${field}\u0000${value}`;
        const list = map.get(key);
        if (list) list.push(p);
        else map.set(key, [p]);
      }
    }
    return map;
  }, [products]);
  const optSearchText = optSettingsSearch.trim().toLowerCase();
  const optionMatchedProducts = useMemo(() => {
    if (!optSearchText) return [];
    return products.filter((product) => {
      const specs = product.specs as Record<string, string>;
      const haystack = [product.modelNo, product.name, ...Object.values(specs || {})]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(optSearchText);
    });
  }, [optSearchText, products]);
  const filteredOptionFields = useMemo(() => {
    const keys = Object.keys(fieldOptions);
    if (!optSearchText) return keys;
    return keys.filter((field) => {
      const col = activeCat?.columns?.find((item) => item.key === field);
      const haystack = `${field} ${col?.label || ''} ${(fieldOptions[field] || []).join(' ')}`.toLowerCase();
      if (haystack.includes(optSearchText)) return true;
      return optionMatchedProducts.some((product) => Boolean((product.specs as Record<string, string>)?.[field]));
    });
  }, [activeCat?.columns, fieldOptions, optSearchText, optionMatchedProducts]);
  const filteredOrderItems = useMemo(() => {
    if (!optSearchText) return orderItems;
    const matchedValues = new Set(
      optionMatchedProducts
        .map((product) => (product.specs as Record<string, string>)?.[optImgField])
        .filter((value): value is string => Boolean(value)),
    );
    return orderItems.filter((item) => item.toLowerCase().includes(optSearchText) || matchedValues.has(item));
  }, [optImgField, optSearchText, optionMatchedProducts, orderItems]);
  // 选项卡片增量渲染：型号类字段可能有数千个选项值，一次性全渲染会冻结主线程数秒
  const {
    visibleItems: visibleOrderItems,
    hasMore: hasMoreOrderItems,
    loadMore: loadMoreOrderItems,
  } = useVisibleItems(filteredOrderItems, 60, `${optImgField}:${optSearchText}`);

  function resetGenerateFormForCategory(cat: SelectionCategory, sourceProducts: SelectionProduct[] = []) {
    const columns = (cat.columns as ColumnDef[]) || [];
    const selectableColumns = generatableProductColumns(columns);
    const optionTexts: Record<string, string> = {};
    selectableColumns.forEach((col) => {
      const vals = new Set<string>();
      sourceProducts.forEach((p) => {
        const value = (p.specs as Record<string, string>)?.[col.key];
        if (value) vals.add(value);
      });
      optionTexts[col.key] = Array.from(vals).sort().join('\n');
    });
    const templates = inferGenerateTemplates(columns, sourceProducts);
    setGenerateModelTemplate(templates.modelTemplate);
    setGenerateNameTemplate(templates.nameTemplate);
    setGenerateOptionTexts(optionTexts);
    setGenerateExcludeRules('');
    setGeneratePreview([]);
    setGeneratePreviewSearch('');
    setGeneratePreviewPage(1);
    setGenerateErrors([]);
  }

  function openGenerateProducts() {
    if (!activeCat) {
      toast('请先选择分类', 'error');
      return;
    }
    const selectableColumns = selectableProductColumns;
    if (!selectableColumns.length) {
      toast('当前分类没有可组合生成的选择列', 'error');
      return;
    }
    resetGenerateFormForCategory(activeCat, products);
    setShowGenerateModal(true);
  }

  function refreshGeneratePreview() {
    const selectableColumns = selectableGenerateColumns;
    const errors: string[] = [];
    if (!generateCat) errors.push('请先选择分类');
    if (!selectableColumns.length) errors.push('当前分类没有可组合生成的选择列');
    selectableColumns.forEach((col) => {
      if (parseGenerateValues(generateOptionTexts[col.key] || '').length === 0) {
        errors.push(`${col.label || col.key} 没有填写可选值`);
      }
    });

    const preview = errors.length
      ? []
      : buildGeneratedProductDrafts({
          columns: generateColumns,
          optionTexts: generateOptionTexts,
          modelTemplate: generateModelTemplate,
          nameTemplate: generateNameTemplate,
          excludeRules: generateExcludeRules,
          limit: 10000,
        });

    if (preview.length >= 10000) errors.push('组合超过 10000 条，已截断；建议减少选项或增加排除规则');
    if (!preview.length && errors.length === 0) errors.push('排除规则过滤掉了全部组合');
    setGeneratePreview(preview);
    setGeneratePreviewPage(1);
    setGenerateErrors(errors);
  }

  async function importGeneratedProducts() {
    if (!generatePreview.length) {
      refreshGeneratePreview();
      return;
    }
    if (!selectedCatId) {
      toast('请先选择分类', 'error');
      return;
    }
    setGenerateImporting(true);
    try {
      const { created, updated } = await batchImportProducts(selectedCatId, generatePreview);
      const msg = updated > 0 ? `生成导入完成：新增 ${created} 个，更新 ${updated} 个` : `已生成导入 ${created} 个产品`;
      toast(msg, 'success');
      setShowGenerateModal(false);
      setGeneratePreview([]);
      mutateProds();
      mutateCats();
    } catch (err) {
      toast(getApiErrorMessage(err, '生成导入失败'), 'error');
    } finally {
      setGenerateImporting(false);
    }
  }

  async function uploadOptImg(field: string, val: string, file: File) {
    setUploadingVal(`${field}::${val}`);
    try {
      const { url } = await uploadOptionImage(file);
      const updated = { ...optImages, [field]: { ...(optImages[field] || {}), [val]: url } };
      await updateCategory(activeCat!.id, { optionImages: updated });
      mutateCats();
      toast('图片已上传', 'success');
    } catch {
      toast('上传失败', 'error');
    } finally {
      setUploadingVal(null);
    }
  }

  // 选项设置：切换字段（恢复已保存的选项顺序）
  function pickOptField(f: string) {
    if (!activeCat) return;
    setOptImgField(f);
    setOptSettingsSearch('');
    if (f) {
      const vals = fieldOptions[f] || [];
      const savedOrderRaw = (activeCat.optionOrder as Record<string, string[] | string>)?.[f];
      const savedOrder = Array.isArray(savedOrderRaw) ? savedOrderRaw : [];
      const ordered = savedOrder.filter((v) => vals.includes(v));
      const rest = vals.filter((v) => !savedOrder.includes(v));
      setOrderItems([...ordered, ...rest]);
    } else {
      setOrderItems([]);
    }
  }

  // 选项粘贴分流（悬停即目标，统一走 document 级监听）：
  // 单选项弹窗开着：鼠标悬停在上传区时 Cmd+V 传该区——画册区收图片/PDF/链接，
  //   选项图片区收图片（PDF 仍进画册并提示），鼠标在弹窗外默认 图片→选项图片、PDF→画册；
  // 弹窗没开：悬停在选项设置网格的某张选项图片上 → 粘贴直接传该选项值。
  // 注意不能在弹窗容器上再挂 onPaste 抢事件：焦点落在容器内时容器级 handler 先于本监听执行，
  // 历史上的容器级 onPaste 把图片传进 __pasting__ 黑洞键（无任何 UI 读取），
  // 造成「提示上传成功但图片不显示、也没有上传中图标」。
  async function handleOptValPaste(e: ClipboardEvent) {
    const targetVal = editOptVal || hoverOptVal;
    if (!targetVal || !optImgField || e.defaultPrevented) return;
    const zone = optPasteZone;
    const pastedFiles = Array.from(e.clipboardData?.files || []);
    const pdfFile = pastedFiles.find((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (pdfFile) {
      e.preventDefault();
      try {
        await uploadOptCatalog(optImgField, targetVal, pdfFile);
        if (zone === 'image') toast('PDF 已上传到画册资料（画册区才收 PDF）', 'info');
      } catch {
        toast('上传 PDF 失败', 'error');
      }
      return;
    }
    const imageFile = pastedFiles.find((f) => f.type.startsWith('image/'));
    if (imageFile) {
      e.preventDefault();
      if (zone === 'catalog') {
        try {
          await uploadOptCatalog(optImgField, targetVal, imageFile);
        } catch {
          toast('上传画册失败', 'error');
        }
        return;
      }
      await uploadOptImg(optImgField, targetVal, imageFile);
      return;
    }
    for (const item of Array.from(e.clipboardData?.items || [])) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        if (zone === 'catalog') {
          try {
            await uploadOptCatalog(optImgField, targetVal, file);
          } catch {
            toast('上传画册失败', 'error');
          }
          return;
        }
        await uploadOptImg(optImgField, targetVal, file);
        return;
      }
    }
    const text = e.clipboardData?.getData('text/plain')?.trim();
    if (text && /^https?:\/\/.+/i.test(text)) {
      e.preventDefault();
      // .pdf 链接 → 画册资料（直接保存 URL，不做服务端搬运）
      if (/\.pdf(\?.*)?$/i.test(text) || zone === 'catalog') {
        try {
          const updated = {
            ...optCatalogs,
            [optImgField]: { ...(optCatalogs[optImgField] || {}), [targetVal]: text },
          };
          await updateCategory(activeCat!.id, { optionCatalogs: updated });
          mutateCats();
          toast('画册链接已保存', 'success');
        } catch {
          toast('保存失败', 'error');
        }
        return;
      }
      toast('正在下载图片...', 'info');
      try {
        const { url } = await uploadOptionImageFromUrl(text);
        const updated = {
          ...optImages,
          [optImgField]: { ...(optImages[optImgField] || {}), [targetVal]: url },
        };
        await updateCategory(activeCat!.id, { optionImages: updated });
        mutateCats();
        toast('图片已下载并保存', 'success');
      } catch {
        toast('下载图片失败，请检查链接是否有效', 'error');
      }
    }
  }
  useEffect(() => {
    if (!optImgField) return;
    const listener = (event: Event) => void handleOptValPaste(event as ClipboardEvent);
    document.addEventListener('paste', listener);
    return () => document.removeEventListener('paste', listener);
  });

  async function removeOptImg(field: string, val: string) {
    const updated = { ...optImages };
    if (updated[field]) {
      delete updated[field][val];
      if (Object.keys(updated[field]).length === 0) delete updated[field];
    }
    await updateCategory(activeCat!.id, { optionImages: updated });
    mutateCats();
    toast('图片已移除', 'success');
  }

  async function uploadOptCatalog(field: string, val: string, file: File) {
    if (!activeCat) return;
    // 画册走 product-asset 端点（接受图片和 PDF）；option-image 端点只收图片，传 PDF 会 400
    const { url } = await uploadSelectionProductAsset(file);
    const updated = { ...optCatalogs, [field]: { ...(optCatalogs[field] || {}), [val]: url } };
    await updateCategory(activeCat.id, { optionCatalogs: updated });
    mutateCats();
    toast('画册已上传', 'success');
  }

  async function removeOptCatalog(field: string, val: string) {
    const updated = { ...optCatalogs };
    if (updated[field]) {
      delete updated[field][val];
      if (Object.keys(updated[field]).length === 0) delete updated[field];
    }
    await updateCategory(activeCat!.id, { optionCatalogs: updated });
    mutateCats();
    toast('画册已移除', 'success');
  }

  const totalCats = categories.length;
  const totalProducts = categories.reduce((s, c) => s + (c.productCount || 0), 0);
  const filteredSelectionCategories = useMemo(() => {
    const base = catFilter === 'empty' ? categories.filter((c) => !(c.productCount || 0)) : categories;
    const q = catSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q) ||
        (c.groupName || '').toLowerCase().includes(q) ||
        (c.icon || '').toLowerCase().includes(q),
    );
  }, [categories, catFilter, catSearch]);
  const openGroupManager = () => {
    const map = new Map<
      string,
      { id: string; name: string; icon: string; image: string; imageFit: 'cover' | 'contain'; catCount: number }
    >();
    for (const c of categories) {
      if (c.groupId && c.groupName) {
        if (!map.has(c.groupId)) {
          map.set(c.groupId, {
            id: c.groupId,
            name: c.groupName,
            icon: c.groupIcon || 'category',
            image: c.groupImage || '',
            imageFit: c.groupImageFit === 'contain' ? 'contain' : 'cover',
            catCount: 0,
          });
        } else if (!map.get(c.groupId)!.image && c.groupImage) {
          map.get(c.groupId)!.image = c.groupImage;
          map.get(c.groupId)!.imageFit = c.groupImageFit === 'contain' ? 'contain' : 'cover';
        }
        map.get(c.groupId)!.catCount++;
      }
    }
    setGroupItems(Array.from(map.values()));
    setGroupForm({ name: '', icon: 'category', image: '', imageFit: 'cover' });
    setDeleteGroupId(null);
    setRemoveGroupCatId(null);
    setShowGroupModal(true);
  };

  return (
    <AdminManagementPage
      title="选型管理"
      description="管理选型分类、产品、参数列定义和批量导入数据"
      actions={
        <div className="hidden items-center gap-2 md:flex">
          <button onClick={openNewProd} disabled={noProductCat} className={SELECTION_TOOLBAR_BUTTON_PRIMARY}>
            <SelectionToolbarButtonContent icon="add">新建产品</SelectionToolbarButtonContent>
          </button>
          <ToolbarMoreMenu
            items={[
              {
                label: '批量导入',
                icon: 'upload',
                disabled: noProductCat,
                action: () => {
                  setBatchParsed(null);
                  setBatchErrors([]);
                  setShowBatchModal(true);
                },
              },
              { label: '批量生成', icon: 'auto_awesome', disabled: noProductCat, action: openGenerateProducts },
              { label: '导出', icon: 'download', disabled: noProductCat, action: exportCurrentProducts },
              { label: '导出数据包', icon: 'inventory_2', action: () => setShowTransferExport(true) },
              { label: '导入数据包', icon: 'archive', action: () => setShowTransferImport(true) },
              {
                label: '选项设置',
                icon: 'settings',
                disabled: noProductCat,
                action: () => {
                  setOptImgField('');
                  setOptSettingsSearch('');
                  setOrderItems([]);
                  setShowOptImgModal(true);
                },
              },
              { label: '新建分类', icon: 'add', action: openNewCat },
              { label: '分组管理', icon: 'folder', action: openGroupManager },
              {
                label: '排序',
                icon: 'view_list',
                action: () => {
                  setCatSortItems(categories.map((c) => ({ id: c.id, name: c.name })));
                  setShowCatSortModal(true);
                },
              },
            ]}
          />
        </div>
      }
      toolbar={
        <div className="flex min-h-10 min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 flex-1">
            <ResponsiveSectionTabs
              tabs={[
                { value: 'categories', label: '分类管理', count: totalCats, icon: 'category' },
                { value: 'products', label: '产品管理', count: totalProducts, icon: 'inventory_2' },
              ]}
              value={tab}
              onChange={(next) => {
                setTab(next as Tab);
                setCatFilter('all');
              }}
              mobileTitle="选型管理"
            />
          </div>
          <div className="grid min-w-0 grid-cols-4 items-center gap-1.5 overflow-visible md:hidden">
            <button onClick={openNewProd} disabled={noProductCat} className={SELECTION_TOOLBAR_BUTTON_PRIMARY}>
              <SelectionToolbarButtonContent icon="add">新建产品</SelectionToolbarButtonContent>
            </button>
            <button
              onClick={() => {
                setBatchParsed(null);
                setBatchErrors([]);
                setShowBatchModal(true);
              }}
              disabled={noProductCat}
              className={SELECTION_TOOLBAR_BUTTON_SECONDARY}
            >
              <SelectionToolbarButtonContent icon="upload">批量导入</SelectionToolbarButtonContent>
            </button>
            <button
              onClick={openGenerateProducts}
              disabled={noProductCat}
              className={SELECTION_TOOLBAR_BUTTON_SECONDARY}
            >
              <SelectionToolbarButtonContent icon="auto_awesome">批量生成</SelectionToolbarButtonContent>
            </button>
            <button
              disabled={noProductCat}
              onClick={exportCurrentProducts}
              className={SELECTION_TOOLBAR_BUTTON_SECONDARY}
            >
              <SelectionToolbarButtonContent icon="download">导出</SelectionToolbarButtonContent>
            </button>
            <button
              onClick={() => {
                setOptImgField('');
                setOptSettingsSearch('');
                setOrderItems([]);
                setShowOptImgModal(true);
              }}
              disabled={noProductCat}
              className={SELECTION_TOOLBAR_BUTTON_SECONDARY}
            >
              <SelectionToolbarButtonContent icon="settings">选项设置</SelectionToolbarButtonContent>
            </button>
            <button onClick={openNewCat} className={SELECTION_TOOLBAR_BUTTON_SECONDARY}>
              <SelectionToolbarButtonContent icon="add">新建分类</SelectionToolbarButtonContent>
            </button>
            <button onClick={openGroupManager} className={SELECTION_TOOLBAR_BUTTON_SECONDARY}>
              <SelectionToolbarButtonContent icon="folder">分组管理</SelectionToolbarButtonContent>
            </button>
            <button
              onClick={() => {
                setCatSortItems(categories.map((c) => ({ id: c.id, name: c.name })));
                setShowCatSortModal(true);
              }}
              className={SELECTION_TOOLBAR_BUTTON_SECONDARY}
            >
              <SelectionToolbarButtonContent icon="view_list">排序</SelectionToolbarButtonContent>
            </button>
            <button onClick={() => setShowTransferExport(true)} className={SELECTION_TOOLBAR_BUTTON_SECONDARY}>
              <SelectionToolbarButtonContent icon="inventory_2">导出数据包</SelectionToolbarButtonContent>
            </button>
            <button onClick={() => setShowTransferImport(true)} className={SELECTION_TOOLBAR_BUTTON_SECONDARY}>
              <SelectionToolbarButtonContent icon="archive">导入数据包</SelectionToolbarButtonContent>
            </button>
          </div>
          <SearchField
            inputProps={tab === 'categories' ? catSearchInputProps : prodSearchInputProps}
            value={tab === 'categories' ? catSearchInputValue : prodSearchInputValue}
            onClear={() => (tab === 'categories' ? setCatSearch('') : setProdSearch(''))}
            placeholder={tab === 'categories' ? '搜索分类名称、slug 或分组' : '搜索产品名称、型号、参数值'}
            className="md:w-72 md:shrink-0"
          />
        </div>
      }
    >
      {/* ===== Categories Tab ===== */}
      {tab === 'categories' && (
        <div key="categories-panel" className="admin-tab-panel flex min-h-0 flex-1 flex-col gap-3">
          {catFilter === 'empty' && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <Icon name="warning" size={14} className="text-amber-500 shrink-0" />
              <span className="text-xs text-on-surface">仅显示空分类（无产品的分类）</span>
              <button
                onClick={() => setCatFilter('all')}
                className="text-xs text-primary-container hover:underline ml-auto shrink-0"
              >
                显示全部
              </button>
            </div>
          )}
          {(() => {
            const filtered = filteredSelectionCategories;
            if (filtered.length === 0)
              return (
                <div className="text-center py-12 text-on-surface-variant">
                  <Icon name="inventory_2" size={40} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">
                    {catSearch ? '没有匹配的分类' : catFilter === 'empty' ? '没有空分类' : '暂无分类'}
                  </p>
                </div>
              );
            return (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low">
                <AdminGridHeader columns={SELECTION_CATEGORY_GRID_COLUMNS} className="gap-3 px-4">
                  <span>分类名称</span>
                  <span>分组</span>
                  <span className="text-center">参数列</span>
                  <span className="text-center">产品数</span>
                  <span>排序</span>
                  <span className="text-right">操作</span>
                </AdminGridHeader>
                {/* 仅列表自身滚动（桌面 flex 占满剩余高度；移动端随页面滚动，无内嵌滚动） */}
                <div className="selection-scrollbarless md:min-h-0 md:flex-1 md:overflow-y-auto">
                  {filtered.map((cat) => (
                    <div
                      key={cat.id}
                      className={`${ADMIN_GRID_ROW_CLASS} group grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 px-4 py-4 first:border-t-0 md:grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.8fr)_92px_92px_80px_104px] md:items-center md:gap-3 md:py-3`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-start gap-2.5 md:items-center md:gap-2">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-primary-container">
                            <Icon name={cat.icon || 'inventory_2'} size={15} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`flex items-center gap-1.5 ${ADMIN_ROW_TITLE_CLASS}`}>
                              <span className="truncate">{cat.name}</span>
                              {cat.hidden ? (
                                <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-container-high px-1.5 py-0.5 text-[9px] font-medium text-on-surface-variant/70">
                                  <Icon name="visibility_off" size={10} />
                                  隐藏
                                </span>
                              ) : null}
                            </span>
                            <span className="mt-0.5 block truncate text-[10px] text-on-surface-variant sm:hidden">
                              /{cat.slug}
                            </span>
                          </span>
                          <span className="hidden text-[10px] text-on-surface-variant sm:inline">/{cat.slug}</span>
                        </div>
                        <div className="mt-2 ml-9 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-on-surface-variant/70 md:hidden">
                          <span>{cat.groupName || '未分组'}</span>
                          <span>{(cat.columns as ColumnDef[]).length} 个参数列</span>
                          <span>{cat.productCount ?? 0} 个产品</span>
                          <span>排序 {cat.sortOrder}</span>
                        </div>
                      </div>
                      <span className={`hidden min-w-0 md:block ${ADMIN_ROW_META_CLASS}`}>
                        {cat.groupName || '未分组'}
                      </span>
                      <span className="hidden text-center text-xs tabular-nums text-on-surface md:block">
                        {(cat.columns as ColumnDef[]).length}
                      </span>
                      <span className="hidden text-center text-xs tabular-nums text-on-surface md:block">
                        {cat.productCount ?? 0}
                      </span>
                      <span className="hidden text-xs tabular-nums text-on-surface-variant md:block">
                        {cat.sortOrder}
                      </span>
                      <div className="flex shrink-0 items-center justify-end gap-2 pt-0.5 md:gap-1 md:pt-0">
                        <button
                          onClick={() => void toggleCatHidden(cat)}
                          className={cat.hidden ? SELECTION_ICON_BUTTON_ACTIVE : SELECTION_ICON_BUTTON_EDIT}
                          data-tooltip-ignore
                          aria-label={cat.hidden ? '恢复分类显示' : '隐藏分类'}
                        >
                          <Icon name={cat.hidden ? 'visibility_off' : 'visibility'} size={14} />
                        </button>
                        <button
                          onClick={() => openEditCat(cat)}
                          className={SELECTION_ICON_BUTTON_EDIT}
                          data-tooltip-ignore
                          aria-label="编辑分类"
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        {deleteCatId === cat.id ? (
                          <>
                            <button
                              onClick={() => handleDeleteCat(cat.id)}
                              className="h-8 px-2 text-xs font-medium text-error hover:underline md:text-[10px]"
                            >
                              确认删除
                            </button>
                            <button
                              onClick={() => setDeleteCatId(null)}
                              className="h-8 px-2 text-xs text-on-surface-variant hover:text-on-surface md:text-[10px]"
                            >
                              取消
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setDeleteCatId(cat.id)}
                            className={SELECTION_ICON_BUTTON_DELETE}
                            data-tooltip-ignore
                            aria-label="删除分类"
                          >
                            <Icon name="delete" size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ===== Products Tab ===== */}
      {tab === 'products' && (
        <div key="products-panel" className="admin-tab-panel flex min-h-0 flex-1 flex-col gap-3">
          {/* Category selector */}
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="min-w-0 flex-1">
                <div ref={productCatPickerRef} className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setProductCatOpen((open) => !open);
                      setProductCatQuery('');
                    }}
                    className={`flex min-h-[54px] w-full items-center gap-3 rounded-xl border bg-surface-container-lowest px-3 py-2 text-left transition-all duration-150 ${
                      productCatOpen
                        ? 'border-primary-container shadow-sm ring-2 ring-primary-container/10'
                        : 'border-outline-variant/20 hover:border-primary-container/40'
                    }`}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-container/10">
                      <Icon name={activeCat?.icon || 'category'} size={16} className="text-primary-container" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-on-surface">
                        {activeCat?.name || '选择分类...'}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-on-surface-variant">
                        {activeCat
                          ? `/${activeCat.slug} · ${activeCat.productCount ?? products.length} 个产品`
                          : '选择后维护产品、图片、PDF 和选项设置'}
                      </span>
                    </span>
                    <Icon
                      name="expand_more"
                      size={18}
                      className={`shrink-0 text-on-surface-variant transition-transform ${productCatOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  {productCatOpen && (
                    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-[40] overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-lowest shadow-2xl">
                      <div className="border-b border-outline-variant/10 p-2">
                        <SearchField
                          inputProps={{ ...productCatQueryInputProps, autoFocus: true }}
                          value={productCatQuery}
                          onClear={() => setProductCatQuery('')}
                          placeholder="搜索分类名称、slug 或分组"
                        />
                      </div>
                      <div className="max-h-72 overflow-y-auto p-1.5">
                        {productCategoryOptions.length > 0 ? (
                          productCategoryOptions.map((c) => {
                            const selected = c.id === selectedCatId;
                            return (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => {
                                  setSelectedCatId(c.id);
                                  setProdSearch('');
                                  setProductCatOpen(false);
                                  setProductCatQuery('');
                                }}
                                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                                  selected
                                    ? 'bg-primary-container/10 text-primary-container'
                                    : 'text-on-surface hover:bg-surface-container-high'
                                }`}
                              >
                                <Icon
                                  name={c.icon || 'category'}
                                  size={16}
                                  className={selected ? 'text-primary-container' : 'text-on-surface-variant'}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-bold">{c.name}</span>
                                  <span className="block truncate text-[10px] text-on-surface-variant">
                                    /{c.slug}
                                    {c.groupName ? ` · ${c.groupName}` : ''}
                                  </span>
                                </span>
                                <span className="shrink-0 rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] text-on-surface-variant">
                                  {c.productCount ?? 0}
                                </span>
                                {selected && (
                                  <Icon name="check" size={15} className="shrink-0 text-primary-container" />
                                )}
                              </button>
                            );
                          })
                        ) : (
                          <div className="px-3 py-8 text-center text-xs text-on-surface-variant">没有匹配的分类</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {activeCat ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-on-surface-variant">
                <span>/{activeCat.slug}</span>
                <span>{activeCat.productCount ?? products.length} 个产品</span>
                <span>{productColumns.length} 个参数列</span>
                {activeCat.groupName && <span>{activeCat.groupName}</span>}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-on-surface-variant">选择分类后维护产品、图片、PDF 和选项设置。</p>
            )}
          </div>

          {selectedCatId && activeCat && (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {/* Products table */}
              {productsLoading ? (
                <div className="min-h-[320px] overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low">
                  <AdminGridHeader columns="repeat(5,minmax(120px,1fr)) 96px" className="gap-3 px-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <span key={i} className="h-3 rounded-full bg-outline-variant/15" />
                    ))}
                  </AdminGridHeader>
                  <div className="space-y-3 p-3 md:p-4">
                    {Array.from({ length: 6 }).map((_, row) => (
                      <div
                        key={row}
                        className="grid gap-3 rounded-xl bg-surface-container-lowest p-3 md:grid-cols-[repeat(5,minmax(120px,1fr))_96px]"
                      >
                        {Array.from({ length: 6 }).map((_, col) => (
                          <span
                            key={col}
                            className={`h-3 rounded-full bg-outline-variant/10 ${col === 0 ? 'w-4/5' : col === 5 ? 'w-12 justify-self-end' : 'w-full'}`}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ) : products.length === 0 ? (
                <div className="text-center py-12 text-on-surface-variant">
                  <Icon name="inventory_2" size={40} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">暂无产品</p>
                </div>
              ) : (
                <>
                  {prodSearch && (
                    <p className="text-xs text-on-surface-variant">
                      搜索 "<span className="text-on-surface font-medium">{prodSearch}</span>" 匹配{' '}
                      {filteredProducts.length} / {products.length} 个产品
                    </p>
                  )}
                  {selectedProdIds.size > 0 && (
                    <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary-container/25 bg-primary-container/5 px-3 py-2">
                      <span className="text-xs font-medium text-on-surface">
                        已选 <span className="tabular-nums">{selectedProdIds.size}</span> 项
                      </span>
                      <span className="mx-0.5 h-4 w-px bg-outline-variant/25" />
                      <button
                        type="button"
                        disabled={batchBusy}
                        onClick={() => void handleBatchUpdateHidden(true)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
                      >
                        <Icon name="visibility_off" size={13} />
                        批量隐藏
                      </button>
                      <button
                        type="button"
                        disabled={batchBusy}
                        onClick={() => void handleBatchUpdateHidden(false)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
                      >
                        <Icon name="visibility" size={13} />
                        批量显示
                      </button>
                      <button
                        type="button"
                        disabled={batchBusy}
                        onClick={() => setBatchDeleteConfirmOpen(true)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-40"
                      >
                        <Icon name="delete" size={13} />
                        批量删除
                      </button>
                      <span className="flex-1" />
                      <button
                        type="button"
                        disabled={batchBusy}
                        onClick={clearProdSelection}
                        className="rounded-lg px-2 py-1 text-xs text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
                      >
                        取消选择
                      </button>
                    </div>
                  )}
                  {filteredProducts.length === 0 ? (
                    <div className="text-center py-12 text-on-surface-variant">
                      <Icon name="search_off" size={40} className="mx-auto mb-2 opacity-30" />
                      <p className="text-sm">未找到匹配的产品</p>
                    </div>
                  ) : (
                    <>
                      <div className="md:hidden space-y-2">
                        {visibleProducts.map((p) => (
                          <ProductMobileCard
                            key={p.id}
                            p={p}
                            columns={productColumns}
                            isDeleting={deleteProdId === p.id}
                            selected={selectedProdIds.has(p.id)}
                            onToggleHidden={toggleProdHidden}
                            onEdit={openEditProd}
                            onConfirmDelete={handleDeleteProd}
                            onRequestDelete={setDeleteProdId}
                            onCancelDelete={cancelDeleteProd}
                            onToggleSelected={toggleProdSelected}
                          />
                        ))}
                      </div>
                      {hasMoreProducts && (
                        <div className="md:hidden">
                          <InfiniteLoadTrigger
                            hasMore={hasMoreProducts}
                            isLoading={false}
                            onLoadMore={loadMoreProducts}
                            buttonless
                            idleLabel={null}
                          />
                        </div>
                      )}

                      <div
                        ref={productTableScrollRef}
                        onScroll={handleProductTableScroll}
                        className="hidden min-h-0 flex-1 overflow-auto rounded-xl border border-outline-variant/15 selection-scrollbarless md:block"
                      >
                        <AdminTable>
                          <thead className={ADMIN_TABLE_HEAD_CLASS}>
                            <AdminTableHeadRow>
                              <AdminTableHeadCell className="w-10 px-3">
                                <input
                                  name="select-all-products"
                                  type="checkbox"
                                  checked={
                                    filteredProducts.length > 0 &&
                                    filteredProducts.every((p) => selectedProdIds.has(p.id))
                                  }
                                  disabled={batchBusy}
                                  onChange={() =>
                                    setSelectedProdIds((prev) =>
                                      filteredProducts.every((p) => prev.has(p.id))
                                        ? new Set()
                                        : new Set(filteredProducts.map((p) => p.id)),
                                    )
                                  }
                                  className="h-4 w-4 accent-primary-container"
                                  aria-label="全选当前筛选结果"
                                />
                              </AdminTableHeadCell>
                              <AdminTableHeadCell className="whitespace-nowrap px-3">名称</AdminTableHeadCell>
                              {productColumns.map((col) => (
                                <AdminTableHeadCell key={col.key} className="whitespace-nowrap px-3">
                                  {col.label}
                                  {col.unit ? ` (${col.unit})` : ''}
                                </AdminTableHeadCell>
                              ))}
                              <AdminTableHeadCell className="px-3 text-right">操作</AdminTableHeadCell>
                            </AdminTableHeadRow>
                          </thead>
                          <tbody>
                            {visibleProducts.map((p) => (
                              <ProductTableRow
                                key={p.id}
                                p={p}
                                columns={productColumns}
                                isDeleting={deleteProdId === p.id}
                                selected={selectedProdIds.has(p.id)}
                                onToggleHidden={toggleProdHidden}
                                onEdit={openEditProd}
                                onConfirmDelete={handleDeleteProd}
                                onRequestDelete={setDeleteProdId}
                                onCancelDelete={cancelDeleteProd}
                                onToggleSelected={toggleProdSelected}
                              />
                            ))}
                          </tbody>
                        </AdminTable>
                        <InfiniteLoadTrigger
                          hasMore={hasMoreProducts}
                          isLoading={false}
                          onLoadMore={loadMoreProducts}
                          buttonless
                          idleLabel={null}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {!selectedCatId && (
            <div className="text-center py-12 text-on-surface-variant">
              <Icon name="touch_app" size={40} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">请先选择一个分类</p>
            </div>
          )}
        </div>
      )}

      {/* ===== Category Modal ===== */}
      {showCatModal && (
        <div
          className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4"
          onClick={() => setShowCatModal(false)}
          onPaste={async (e) => {
            for (const item of Array.from(e.clipboardData.items)) {
              if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                  try {
                    const { url } = await uploadOptionImage(file);
                    setCatForm((prev) => ({ ...prev, image: url }));
                    toast('图片已粘贴上传', 'success');
                  } catch {
                    toast('上传失败', 'error');
                  }
                }
                return;
              }
            }
            // Check for URL text
            const text = e.clipboardData.getData('text/plain')?.trim();
            if (text && /^https?:\/\/.+/i.test(text)) {
              e.preventDefault();
              toast('正在下载图片...', 'info');
              try {
                const { url } = await uploadOptionImageFromUrl(text);
                setCatForm((prev) => ({ ...prev, image: url }));
                toast('图片已下载并保存', 'success');
              } catch {
                toast('下载图片失败', 'error');
              }
            }
          }}
        >
          <div
            className="fixed inset-0 flex min-h-0 flex-col bg-surface-container-low p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl sm:relative sm:inset-auto sm:w-[min(96vw,1280px)] sm:max-w-none sm:max-h-[90dvh] sm:rounded-xl sm:border sm:border-outline-variant/20 sm:p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/10 pb-3 sm:mb-4 sm:border-b-0 sm:pb-0">
              <h2 className="text-base font-bold text-on-surface">{editCat ? '编辑分类' : '新建分类'}</h2>
              <button
                onClick={() => setShowCatModal(false)}
                className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface sm:hidden"
                data-tooltip-ignore
                aria-label="关闭"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-0.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">名称 *</label>
                  <input
                    name="name"
                    value={catForm.name}
                    onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">标识 (slug) *</label>
                  <input
                    name="slug"
                    value={catForm.slug}
                    onChange={(e) =>
                      setCatForm({ ...catForm, slug: e.target.value.replace(/\s+/g, '-').toLowerCase() })
                    }
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">描述</label>
                <input
                  name="description"
                  value={catForm.description}
                  onChange={(e) => setCatForm({ ...catForm, description: e.target.value })}
                  className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                />
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">套件清单标题</label>
                <input
                  name="kit-list-title"
                  value={catForm.kitListTitle}
                  onChange={(e) => setCatForm({ ...catForm, kitListTitle: e.target.value })}
                  placeholder="默认：子零件清单，例如：组装清单 / BOM清单"
                  className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                />
                <p className="mt-1 text-[10px] text-on-surface-variant">
                  用于选型结果、分享页、复制清单和下载清单；产品参数里的“清单标题”可单独覆盖。
                </p>
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">所属分组（可选）</label>
                <select
                  name="select"
                  value={(() => {
                    const editCatObj = editCat ? categories.find((c) => c.id === editCat.id) : null;
                    return editCatObj?.groupId || '';
                  })()}
                  onChange={async (e) => {
                    const gid = e.target.value;
                    if (!gid) {
                      if (editCat)
                        await updateCategory(editCat.id, {
                          groupId: null,
                          groupName: null,
                          groupIcon: null,
                          groupImage: null,
                          groupImageFit: null,
                        });
                      toast('已移除分组', 'success');
                      mutateCats();
                    } else {
                      const src = categories.find((c) => c.groupId === gid);
                      if (editCat)
                        await updateCategory(editCat.id, {
                          groupId: gid,
                          groupName: src?.groupName || '',
                          groupIcon: src?.groupIcon || '',
                          groupImage: src?.groupImage || null,
                          groupImageFit: src?.groupImageFit === 'contain' ? 'contain' : 'cover',
                        });
                      toast('已设置分组', 'success');
                      mutateCats();
                    }
                  }}
                  className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                >
                  <option value="">不分组</option>
                  {(() => {
                    const groupMap = new Map<string, string>();
                    for (const c of categories) {
                      if (c.groupId && c.groupName && !groupMap.has(c.groupId)) groupMap.set(c.groupId, c.groupName);
                    }
                    return Array.from(groupMap.entries()).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ));
                  })()}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">图标名称</label>
                  <input
                    name="icon"
                    value={catForm.icon}
                    onChange={(e) => setCatForm({ ...catForm, icon: e.target.value })}
                    placeholder="如: tune"
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">封面图</label>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <input
                      name="image"
                      value={catForm.image}
                      onChange={(e) => setCatForm({ ...catForm, image: e.target.value })}
                      placeholder="URL 或上传"
                      className="w-full sm:flex-1 bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                    />
                    <label className="shrink-0">
                      <input
                        name="file"
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            try {
                              const { url } = await uploadOptionImage(f);
                              setCatForm((prev) => ({ ...prev, image: url }));
                            } catch {
                              toast('上传失败', 'error');
                            }
                          }
                          e.target.value = '';
                        }}
                      />
                      <span className="px-2.5 py-2 text-xs text-primary-container hover:underline cursor-pointer border border-outline-variant/20 rounded">
                        上传
                      </span>
                    </label>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-on-surface-variant">
                    用于前台选型大类/子类列表，推荐 1600×800 或 1200×600，比例 2:1，主体居中并保留少量边距。
                  </p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-on-surface-variant">
                    支持截图后 Ctrl+V 粘贴上传；过小图片会在前台大图区域显得模糊。
                  </p>
                  {catForm.image && (
                    <div className="mt-2 w-20 h-14 rounded overflow-hidden bg-surface-container-lowest border border-outline-variant/10">
                      <SafeImage src={catForm.image} alt="" className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
              </div>
              <ColumnEditor columns={catForm.columns} onChange={(columns) => setCatForm({ ...catForm, columns })} />
            </div>
            <div className="grid grid-cols-2 gap-2 shrink-0 pt-3 border-t border-outline-variant/10 sm:flex sm:justify-end">
              <button
                onClick={() => setShowCatModal(false)}
                className="px-4 py-2.5 sm:py-2 text-sm text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg sm:rounded"
              >
                取消
              </button>
              <button
                onClick={saveCat}
                disabled={!catForm.name || !catForm.slug}
                className="px-4 py-2.5 sm:py-2 text-sm font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Product Modal ===== */}
      {showProdModal && activeCat && (
        <div
          className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4"
          onClick={() => setShowProdModal(false)}
          onPaste={handleProductAssetPaste}
        >
          <div
            className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-lg sm:max-h-[90dvh] sm:p-5 sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-bold text-on-surface shrink-0">{editProd ? '编辑产品' : '新建产品'}</h2>
            <div className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-0.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">名称 *</label>
                  <input
                    name="name"
                    value={prodForm.name}
                    onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })}
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">型号编号</label>
                  <input
                    name="model-no"
                    value={prodForm.modelNo}
                    onChange={(e) => setProdForm({ ...prodForm, modelNo: e.target.value })}
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">产品图片 URL</label>
                  <input
                    name="image"
                    value={prodForm.image}
                    onChange={(e) => setProdForm({ ...prodForm, image: e.target.value })}
                    placeholder="https://..."
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">PDF 规格书 URL</label>
                  <input
                    name="pdf-url"
                    value={prodForm.pdfUrl}
                    onChange={(e) => setProdForm({ ...prodForm, pdfUrl: e.target.value })}
                    placeholder="https://..."
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
              </div>
              <div
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setProductAssetDragging(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setProductAssetDragging(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.currentTarget === e.target) setProductAssetDragging(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleProductAssetFiles(e.dataTransfer.files);
                }}
                className={`rounded-xl border border-dashed p-3 transition-colors ${
                  productAssetDragging
                    ? 'border-primary-container bg-primary-container/10'
                    : 'border-outline-variant/30 bg-surface-container-high/30'
                }`}
              >
                <input
                  name="file"
                  ref={productAssetInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files?.length) void handleProductAssetFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[88px_1fr] sm:items-center">
                  <button
                    type="button"
                    onClick={() => productAssetInputRef.current?.click()}
                    disabled={productAssetUploading}
                    className="flex h-20 items-center justify-center rounded-lg border border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant hover:text-on-surface disabled:opacity-50"
                  >
                    <Icon
                      name={productAssetUploading ? 'hourglass_empty' : 'upload_file'}
                      size={28}
                      className={productAssetUploading ? 'animate-spin' : ''}
                    />
                  </button>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-on-surface">拖拽图片或 PDF 到这里</p>
                    <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                      也可以点击选择文件，或直接截图后 Ctrl+V 粘贴。图片会填入产品图片，PDF 会填入规格书链接。
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      {prodForm.image && (
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-container-lowest px-2 py-1 text-on-surface-variant">
                          <Icon name="image" size={13} />
                          <span className="truncate">图片已设置</span>
                        </span>
                      )}
                      {prodForm.pdfUrl && (
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-container-lowest px-2 py-1 text-on-surface-variant">
                          <Icon name="picture_as_pdf" size={13} />
                          <span className="truncate">PDF 已设置</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {(prodForm.image || prodForm.pdfUrl) && (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {prodForm.image && (
                    <div className="rounded-lg border border-outline-variant/10 bg-surface-container-lowest p-2">
                      <div className="h-24 overflow-hidden rounded bg-surface-container-high">
                        <SafeImage
                          src={prodForm.image}
                          alt=""
                          className="h-full w-full object-contain p-1"
                          fallbackIcon="image"
                        />
                      </div>
                    </div>
                  )}
                  {prodForm.pdfUrl && (
                    <a
                      href={prodForm.pdfUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => {
                        event.preventDefault();
                        openDocumentUrl(prodForm.pdfUrl, { title: 'PDF 规格书' });
                      }}
                      className="flex items-center gap-2 rounded-lg border border-outline-variant/10 bg-surface-container-lowest p-3 text-xs text-on-surface-variant hover:text-on-surface"
                    >
                      <Icon name="picture_as_pdf" size={22} className="text-error" />
                      <span className="min-w-0 flex-1 truncate">{prodForm.pdfUrl}</span>
                    </a>
                  )}
                </div>
              )}
              {(activeCat.columns as ColumnDef[]).map((col) => (
                <div key={col.key}>
                  <label className="text-xs text-on-surface-variant mb-1 block">
                    {col.label}
                    {col.unit ? ` (${col.unit})` : ''}
                  </label>
                  <input
                    name="specs"
                    value={prodForm.specs[col.key] || ''}
                    onChange={(e) =>
                      setProdForm({ ...prodForm, specs: { ...prodForm.specs, [col.key]: e.target.value } })
                    }
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
              ))}

              {/* Kit / BOM toggle */}
              <div className="border-t border-outline-variant/10 pt-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-on-surface">套件（含子零件）</p>
                    <p className="text-xs text-on-surface-variant">开启后可添加子零件清单</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setProdForm({ ...prodForm, isKit: !prodForm.isKit })}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${prodForm.isKit ? 'bg-primary-container' : 'bg-outline-variant/30'}`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${prodForm.isKit ? 'translate-x-5' : 'translate-x-0'}`}
                    />
                  </button>
                </div>

                {prodForm.isKit && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-on-surface-variant">子零件清单</span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setKitImportText('');
                            setKitImportOpen(true);
                          }}
                          className="text-xs text-primary-container hover:underline"
                        >
                          批量导入
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setProdForm({
                              ...prodForm,
                              components: [...prodForm.components, { name: '', modelNo: '', qty: 1, specs: {} }],
                            })
                          }
                          className="text-xs text-primary-container hover:underline"
                        >
                          + 添加子零件
                        </button>
                      </div>
                    </div>
                    {prodForm.components.map((comp, i) => (
                      <div key={i} className="flex items-start gap-2 bg-surface-container-high/50 rounded-lg p-2">
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <input
                              name="name"
                              value={comp.name}
                              onChange={(e) => {
                                const next = [...prodForm.components];
                                next[i] = { ...next[i], name: e.target.value };
                                setProdForm({ ...prodForm, components: next });
                              }}
                              placeholder="零件名"
                              className="bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                            />
                            <input
                              name="model-no"
                              value={comp.modelNo || ''}
                              onChange={(e) => {
                                const next = [...prodForm.components];
                                next[i] = { ...next[i], modelNo: e.target.value };
                                setProdForm({ ...prodForm, components: next });
                              }}
                              placeholder="型号"
                              className="bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                            />
                            <input
                              name="qty"
                              type="number"
                              min={1}
                              value={comp.qty}
                              onChange={(e) => {
                                const next = [...prodForm.components];
                                next[i] = { ...next[i], qty: Math.max(1, parseInt(e.target.value) || 1) };
                                setProdForm({ ...prodForm, components: next });
                              }}
                              placeholder="数量"
                              className="bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                            />
                          </div>
                          {kitSpecKeys.length > 0 && (
                            <div
                              className="grid gap-2"
                              style={{
                                gridTemplateColumns: `repeat(${Math.min(kitSpecKeys.length, 4)}, minmax(0, 1fr))`,
                              }}
                            >
                              {kitSpecKeys.map((key) => (
                                <input
                                  key={key}
                                  name={`comp-spec-${key}`}
                                  value={comp.specs?.[key] || ''}
                                  onChange={(e) => {
                                    const next = [...prodForm.components];
                                    next[i] = {
                                      ...next[i],
                                      specs: { ...(next[i].specs || {}), [key]: e.target.value },
                                    };
                                    setProdForm({ ...prodForm, components: next });
                                  }}
                                  placeholder={key}
                                  className="bg-surface-container-lowest text-on-surface-variant text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                                />
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setProdForm({ ...prodForm, components: prodForm.components.filter((_, idx) => idx !== i) })
                          }
                          className="text-error/70 hover:text-error shrink-0 mt-1"
                        >
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 shrink-0 pt-2 border-t border-outline-variant/10 sm:flex sm:justify-end">
              <button
                onClick={() => setShowProdModal(false)}
                className="px-4 py-2.5 sm:py-2 text-sm text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg sm:rounded"
              >
                取消
              </button>
              <button
                onClick={saveProd}
                disabled={!prodForm.name}
                className="px-4 py-2.5 sm:py-2 text-sm font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Kit Components Batch Import Modal ===== */}
      {kitImportOpen && (
        <div
          className="fixed inset-0 z-[340] bg-black/50 flex items-center justify-center p-3 sm:p-4"
          onClick={() => setKitImportOpen(false)}
        >
          <div
            className="w-full max-w-lg max-h-[86dvh] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 sm:p-5 space-y-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="shrink-0">
              <h2 className="text-base font-bold text-on-surface">批量导入子零件</h2>
              <p className="mt-1 text-xs text-on-surface-variant leading-relaxed">
                每行一条，列之间用制表符（Excel 直接粘贴）、逗号或连续空格分隔，也可直接导入 .xlsx / .csv 表格文件。
                <br />
                <span className="font-bold text-on-surface">推荐带表头：</span>首行写列名（名称、型号、数量 +
                任意附加列如「编码」），列序任意、列数不限，附加列会显示在子零件清单和导出里。
                <br />
                不带表头则按位置解析：「零件名 型号 数量」，或「型号 数量」，或仅「型号」（数量默认 1）。
              </p>
            </div>
            <div className="shrink-0 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void downloadKitImportTemplate()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg"
              >
                <Icon name="download" size={13} />
                下载模板（.xlsx）
              </button>
              <label className="inline-flex cursor-pointer items-center gap-1 px-2.5 py-1.5 text-xs text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg">
                <Icon name="upload_file" size={13} />
                导入表格文件
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void handleKitImportFile(file);
                  }}
                />
              </label>
            </div>
            <textarea
              name="kit-import-text"
              value={kitImportText}
              onChange={(e) => setKitImportText(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={'名称\t型号\t编码\t数量\n弯头接头\tPC4-M5\tKAC-001\t2\nPC4-0.5\t\tKAC-002\t4'}
              className="flex-1 min-h-32 w-full resize-none bg-surface-container-lowest text-on-surface text-sm rounded-lg px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container font-mono"
            />
            {(() => {
              const { items, badLines } = parseKitComponentLines(kitImportText);
              return (
                <div className="shrink-0 text-xs space-y-1">
                  {items.length > 0 && (
                    <p className="text-on-surface-variant">
                      解析到 <span className="font-bold text-on-surface">{items.length}</span> 条子零件
                      {items.length <= 5 ? (
                        <span className="text-on-surface-variant/70">
                          （{items.map((c) => `${c.modelNo || c.name}×${c.qty}`).join('、')}）
                        </span>
                      ) : null}
                    </p>
                  )}
                  {badLines.length > 0 && (
                    <p className="text-error/80">
                      第 {badLines.join('、')} 行格式无法识别（数量需为正整数），这些行将被跳过
                    </p>
                  )}
                </div>
              );
            })()}
            <div className="shrink-0 flex items-center justify-end gap-2 pt-1 border-t border-outline-variant/10">
              <button
                type="button"
                onClick={() => setKitImportOpen(false)}
                className="px-4 py-2 text-sm text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg"
              >
                取消
              </button>
              {prodForm.components.length > 0 && (
                <button
                  type="button"
                  disabled={parseKitComponentLines(kitImportText).items.length === 0}
                  onClick={() => {
                    setProdForm({ ...prodForm, components: parseKitComponentLines(kitImportText).items });
                    setKitImportOpen(false);
                  }}
                  className="px-4 py-2 text-sm text-on-surface-variant bg-surface-container-high hover:bg-surface-container-high/80 rounded-lg disabled:opacity-50"
                >
                  替换现有清单
                </button>
              )}
              <button
                type="button"
                disabled={parseKitComponentLines(kitImportText).items.length === 0}
                onClick={() => {
                  setProdForm({
                    ...prodForm,
                    components: [...prodForm.components, ...parseKitComponentLines(kitImportText).items],
                  });
                  setKitImportOpen(false);
                }}
                className="px-4 py-2 text-sm font-bold bg-primary-container text-on-primary rounded-lg hover:opacity-90 disabled:opacity-50"
              >
                追加导入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Unified Option Settings Modal ===== */}
      {showOptImgModal && activeCat && (
        <div
          className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4"
          onClick={() => setShowOptImgModal(false)}
        >
          <div
            className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] max-w-none bg-surface-container-low rounded-2xl border border-outline-variant/20 p-3 space-y-3 flex min-h-0 flex-col overflow-hidden shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-2xl sm:max-h-[90dvh] sm:p-5 sm:space-y-4 sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 shrink-0 pb-2 border-b border-outline-variant/10 sm:pb-0 sm:border-b-0">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-on-surface leading-snug">选项设置</h2>
                <p className="mt-0.5 text-xs text-on-surface-variant truncate">{activeCat.name}</p>
              </div>
              <button
                onClick={() => setShowOptImgModal(false)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <p className="hidden sm:block text-xs leading-relaxed text-on-surface-variant shrink-0">
              拖拽调整顺序，点击图片上传/更换，点击编辑图标修改名称。
            </p>

            {/* Field selector + view toggle */}
            <div className="grid grid-cols-1 gap-2 shrink-0 pb-2 border-b border-outline-variant/10 sm:flex sm:flex-wrap sm:items-center sm:pb-0 sm:border-b-0">
              <div ref={optFieldPickerRef} className="relative w-full sm:w-56 shrink-0">
                <button
                  type="button"
                  name="opt-img-field"
                  onClick={() => setOptFieldOpen((v) => !v)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-surface-container-lowest px-3 py-2 text-left text-sm transition-colors ${
                    optFieldOpen
                      ? 'border-primary-container ring-2 ring-primary-container/20'
                      : 'border-outline-variant/20 hover:border-outline-variant/40'
                  }`}
                >
                  <span className={`truncate ${optImgField ? 'text-on-surface' : 'text-on-surface-variant/60'}`}>
                    {optImgField ? `${optImgField}（${fieldOptions[optImgField]?.length ?? 0} 个选项）` : '选择字段…'}
                  </span>
                  <Icon
                    name="expand_more"
                    size={16}
                    className={`shrink-0 text-on-surface-variant transition-transform ${optFieldOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {optFieldOpen && (
                  <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-20 max-h-64 overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container-low py-1 shadow-2xl">
                    <button
                      type="button"
                      onClick={() => {
                        pickOptField('');
                        setOptFieldOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                        optImgField === ''
                          ? 'bg-primary-container/10 font-medium text-primary-container'
                          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                      }`}
                    >
                      <span>选择字段…</span>
                      <span className="text-[10px] text-on-surface-variant/60">
                        {Object.keys(fieldOptions).length} 个字段
                      </span>
                    </button>
                    {filteredOptionFields.map((f) => (
                      <button
                        type="button"
                        key={f}
                        onClick={() => {
                          pickOptField(f);
                          setOptFieldOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                          f === optImgField
                            ? 'bg-primary-container/10 font-medium text-primary-container'
                            : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                        }`}
                      >
                        <span className="truncate">{f}</span>
                        <span className="shrink-0 text-[10px] tabular-nums text-on-surface-variant/60">
                          {fieldOptions[f].length} 项
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {optImgField && (
                <SearchField
                  inputProps={optSettingsSearchInputProps}
                  value={optSettingsSearchInputValue}
                  onClear={() => setOptSettingsSearch('')}
                  placeholder="搜索选项、型号或产品名..."
                  className="sm:flex-1"
                />
              )}
              {optSettingsSearch && (
                <span className="text-[11px] text-on-surface-variant sm:mr-auto">
                  {optImgField
                    ? `${filteredOrderItems.length}/${orderItems.length} 个选项`
                    : `${filteredOptionFields.length}/${Object.keys(fieldOptions).length} 个字段`}
                </span>
              )}
              {optImgField && (
                <div className="grid grid-cols-2 rounded-md border border-outline-variant/20 overflow-hidden shrink-0 sm:flex">
                  <button
                    onClick={() => setOptViewMode('grid')}
                    className={`px-3 py-2 text-xs flex items-center justify-center gap-1 transition-colors ${optViewMode === 'grid' ? 'bg-primary-container text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high'}`}
                  >
                    <Icon name="grid_view" size={14} /> 卡片
                  </button>
                  <button
                    onClick={() => setOptViewMode('list')}
                    className={`px-3 py-2 text-xs flex items-center justify-center gap-1 transition-colors ${optViewMode === 'list' ? 'bg-primary-container text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high'}`}
                  >
                    <Icon name="view_list" size={14} /> 列表
                  </button>
                </div>
              )}
              {optImgField && orderItems.length > 0 && (
                <button
                  onClick={() => {
                    const colDef = activeCat?.columns?.find((c: ColumnDef) => c.key === optImgField);
                    setOrderItems(smartSortOptions(orderItems, colDef?.sortType));
                  }}
                  className="w-full sm:w-auto px-3 py-2 text-xs font-medium bg-surface-container-lowest text-on-surface-variant border border-outline-variant/20 rounded-md hover:bg-surface-container-high hover:text-on-surface transition-colors shrink-0"
                >
                  <Icon name="sort" size={13} className="mr-0.5" /> 一键排序
                </button>
              )}
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-0.5 pb-2">
              {!optImgField || orderItems.length === 0 ? (
                <div className="min-h-full grid place-items-center rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-lowest/60 px-4 py-8 text-center">
                  <div className="space-y-2">
                    <Icon name="tune" size={28} className="mx-auto text-on-surface-variant/40" />
                    <p className="text-sm font-medium text-on-surface">请选择要设置的字段</p>
                    <p className="text-xs leading-relaxed text-on-surface-variant">
                      选择字段后可调整选项顺序、修改名称或上传图片。
                    </p>
                  </div>
                </div>
              ) : filteredOrderItems.length === 0 ? (
                <div className="min-h-full grid place-items-center rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-lowest/60 px-4 py-8 text-center">
                  <div className="space-y-2">
                    <Icon name="search_off" size={28} className="mx-auto text-on-surface-variant/40" />
                    <p className="text-sm font-medium text-on-surface">没有匹配的选项</p>
                    <p className="text-xs leading-relaxed text-on-surface-variant">
                      换个关键词，或清空搜索查看全部选项。
                    </p>
                  </div>
                </div>
              ) : optViewMode === 'grid' ? (
                /* ===== Card Grid View (for images) ===== */
                <div className="grid grid-cols-1 min-[430px]:grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
                  {visibleOrderItems.map((val) => {
                    const i = orderItems.indexOf(val);
                    const imgUrl = optImages[optImgField]?.[val];
                    const isUploading = uploadingVal === `${optImgField}::${val}`;
                    const valueProductCount = productsByOptionValue.get(`${optImgField}\u0000${val}`)?.length ?? 0;
                    return (
                      <div
                        key={val}
                        draggable
                        onDragStart={() => setOrderDragIdx(i)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (orderDragIdx === null || orderDragIdx === i) return;
                          const next = [...orderItems];
                          const [item] = next.splice(orderDragIdx, 1);
                          next.splice(i, 0, item);
                          setOrderItems(next);
                          setOrderDragIdx(i);
                        }}
                        onDragEnd={() => setOrderDragIdx(null)}
                        className={`rounded-lg border bg-surface-container p-2.5 sm:p-3 space-y-2 transition-opacity cursor-grab active:cursor-grabbing ${
                          orderDragIdx === i ? 'opacity-40 border-primary-container/30' : 'border-outline-variant/20'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-on-surface-variant/40 select-none text-xs shrink-0">⠿</span>
                          <span className="text-xs font-medium text-on-surface break-words line-clamp-2 flex-1 min-w-0">
                            {val}
                          </span>
                          <button
                            onClick={() => setValueProductsView({ field: optImgField, value: val })}
                            title="查看该选项值对应的产品"
                            className={`shrink-0 rounded-full bg-surface-container-high px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors hover:bg-primary-container/15 hover:text-primary-container ${
                              valueProductCount === 0 ? 'text-on-surface-variant/50' : 'text-on-surface-variant'
                            }`}
                          >
                            {valueProductCount} 型
                          </button>
                          <button
                            onClick={() => {
                              setRenameField(optImgField);
                              setRenameOldVal(val);
                              setRenameNewVal(val);
                            }}
                            className={SELECTION_ICON_BUTTON_EDIT}
                          >
                            <Icon name="edit" size={12} />
                          </button>
                        </div>
                        <button
                          onClick={() => {
                            setEditOptVal(val);
                            setHoverOptVal(null);
                          }}
                          onMouseEnter={() => setHoverOptVal(val)}
                          onMouseLeave={() => setHoverOptVal(null)}
                          className="w-full aspect-[2.2/1] min-[430px]:aspect-square rounded bg-surface-container-lowest flex items-center justify-center overflow-hidden border border-outline-variant/10 hover:border-primary-container/30 transition-colors"
                        >
                          {isUploading ? (
                            <Icon name="hourglass_empty" size={24} className="text-on-surface-variant animate-spin" />
                          ) : imgUrl ? (
                            <SafeImage
                              src={imgUrl}
                              alt={val}
                              className="w-full h-full object-contain"
                              fallbackIcon="add_photo_alternate"
                            />
                          ) : (
                            <Icon name="add_photo_alternate" size={24} className="text-on-surface-variant/30" />
                          )}
                        </button>
                        <span className="block text-center text-[10px] text-primary-container">
                          {imgUrl ? '点击或粘贴更换' : '点击或粘贴上传'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* ===== List View (for sorting & rename) ===== */
                <div className="space-y-1">
                  {visibleOrderItems.map((val) => {
                    const i = orderItems.indexOf(val);
                    const valueProductCount = productsByOptionValue.get(`${optImgField}\u0000${val}`)?.length ?? 0;
                    return (
                      <div
                        key={val}
                        draggable
                        onDragStart={() => setOrderDragIdx(i)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          if (orderDragIdx === null || orderDragIdx === i) return;
                          const next = [...orderItems];
                          const [item] = next.splice(orderDragIdx, 1);
                          next.splice(i, 0, item);
                          setOrderItems(next);
                          setOrderDragIdx(i);
                        }}
                        onDragEnd={() => setOrderDragIdx(null)}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                          orderDragIdx === i
                            ? 'opacity-40 border-primary-container/30 bg-primary-container/5'
                            : 'border-outline-variant/20 bg-surface-container-lowest hover:border-outline-variant/40'
                        }`}
                      >
                        <span className="cursor-grab active:cursor-grabbing text-on-surface-variant/40 select-none text-sm shrink-0">
                          ⠿
                        </span>
                        <span className="text-sm font-medium text-on-surface flex-1 min-w-0 break-words">{val}</span>
                        <button
                          onClick={() => setValueProductsView({ field: optImgField, value: val })}
                          title="查看该选项值对应的产品"
                          className={`shrink-0 rounded-full bg-surface-container-high px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors hover:bg-primary-container/15 hover:text-primary-container ${
                            valueProductCount === 0 ? 'text-on-surface-variant/50' : 'text-on-surface-variant'
                          }`}
                        >
                          {valueProductCount} 型
                        </button>
                        {optImages[optImgField]?.[val] && (
                          <SafeImage
                            src={optImages[optImgField][val]}
                            alt=""
                            className="w-7 h-7 object-contain rounded shrink-0"
                            fallbackIcon="image"
                          />
                        )}
                        <button
                          onClick={() => {
                            setRenameField(optImgField);
                            setRenameOldVal(val);
                            setRenameNewVal(val);
                          }}
                          className={SELECTION_ICON_BUTTON_EDIT}
                        >
                          <Icon name="edit" size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <InfiniteLoadTrigger
                hasMore={hasMoreOrderItems}
                isLoading={false}
                onLoadMore={loadMoreOrderItems}
                buttonless
                idleLabel={null}
              />
            </div>

            {/* Save order button */}
            <div className="grid grid-cols-2 gap-2 shrink-0 pt-2 border-t border-outline-variant/10 bg-surface-container-low sm:flex sm:justify-end">
              <button
                onClick={() => setShowOptImgModal(false)}
                className="px-3 py-2.5 sm:py-2 text-xs text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg sm:rounded"
              >
                关闭
              </button>
              <button
                onClick={async () => {
                  if (!optImgField || orderItems.length === 0) {
                    toast('请先选择要设置的字段', 'error');
                    return;
                  }
                  try {
                    const currentOrder = (activeCat.optionOrder as Record<string, string[] | string>) || {};
                    await updateCategory(activeCat.id, {
                      optionOrder: { ...currentOrder, [optImgField]: orderItems },
                    });
                    toast('设置已保存', 'success');
                    mutateCats();
                  } catch (err) {
                    if (import.meta.env.DEV) console.error('保存设置失败:', err);
                    toast('保存失败', 'error');
                  }
                }}
                disabled={!optImgField || orderItems.length === 0}
                className="px-3 py-2.5 sm:py-2 text-xs font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                保存设置
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(forceDeleteCat)}
        onClose={() => setForceDeleteCat(null)}
        onConfirm={() => {
          if (forceDeleteCat) void handleDeleteCat(forceDeleteCat.id, true);
        }}
        title="强制删除分类"
        description={`分类「${forceDeleteCat?.name || ''}」下还有 ${forceDeleteCat?.count ?? 0} 个产品，删除将连带清空这些产品，且不可恢复。确定要继续吗？`}
        confirmLabel="确认强制删除"
      />

      {/* 批量删除产品确认 */}
      <ConfirmDialog
        open={batchDeleteConfirmOpen}
        onClose={() => {
          if (!batchBusy) setBatchDeleteConfirmOpen(false);
        }}
        onConfirm={() => void handleBatchDeleteProducts()}
        title="批量删除产品"
        description={`确定删除已选的 ${selectedProdIds.size} 个产品吗？删除后不可恢复。`}
        confirmLabel={batchBusy ? '删除中...' : '确认删除'}
        confirmDisabled={batchBusy}
      />

      {/* ===== Single Option Upload Dialog ===== */}
      {editOptVal &&
        optImgField &&
        (() => {
          const handleDrop = async (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setOptDragActive(false);
            const files = Array.from(e.dataTransfer.files);
            for (const file of files) {
              if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                try {
                  await uploadOptCatalog(optImgField, editOptVal, file);
                } catch {
                  toast('上传 PDF 失败', 'error');
                }
                return;
              }
              if (file.type.startsWith('image/')) {
                await uploadOptImg(optImgField, editOptVal, file);
                return;
              }
            }
            toast('不支持的文件类型，请拖入图片或 PDF', 'error');
          };
          return (
            <div
              className="fixed inset-0 z-[330] flex items-center justify-center bg-black/50 p-3 sm:p-4"
              onClick={() => setEditOptVal(null)}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOptDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setOptDragActive(false);
              }}
              onDrop={handleDrop}
            >
              <div
                className={`flex max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-full max-w-sm flex-col gap-3 rounded-2xl border bg-surface-container-low p-4 shadow-2xl sm:max-h-[min(620px,90dvh)] sm:p-5 transition-colors ${optDragActive ? 'border-primary-container/60 ring-2 ring-primary-container/20' : 'border-outline-variant/20'}`}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 shrink-0">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold leading-snug text-on-surface">选项值设置</h3>
                    <p className="mt-1 text-xs leading-snug text-on-surface-variant break-words">{editOptVal}</p>
                  </div>
                  <button
                    onClick={() => setEditOptVal(null)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
                {(() => {
                  const imgUrl = optImages[optImgField]?.[editOptVal];
                  const catalogUrl = optCatalogs[optImgField]?.[editOptVal];
                  const isUploading = uploadingVal === `${optImgField}::${editOptVal}`;
                  return (
                    <>
                      <div className="min-h-0 overflow-y-auto">
                        <div className="flex flex-col gap-3.5">
                          {/* ❶ 选项图片：预览框即上传按钮（点击选文件），下方小文字操作 */}
                          <section className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <Icon name="photo_library" size={14} className="shrink-0 text-primary-container" />
                              <span className="text-xs font-bold text-on-surface">选项图片</span>
                              <span className="truncate text-[10px] text-on-surface-variant">推荐 1200×900 · 4:3</span>
                            </div>
                            <label
                              onMouseEnter={() => setOptPasteZone('image')}
                              onMouseLeave={() => setOptPasteZone(null)}
                              className={`group relative flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border bg-surface-container-lowest aspect-[4/3] max-h-[38dvh] transition-colors ${
                                optPasteZone === 'image'
                                  ? 'border-primary-container ring-2 ring-primary-container/20'
                                  : 'border-outline-variant/10 hover:border-primary-container/30'
                              }`}
                            >
                              <input
                                name="file"
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) uploadOptImg(optImgField, editOptVal, f);
                                  e.target.value = '';
                                }}
                              />
                              {isUploading ? (
                                <Icon
                                  name="hourglass_empty"
                                  size={30}
                                  className="text-on-surface-variant animate-spin"
                                />
                              ) : imgUrl ? (
                                <>
                                  <SafeImage
                                    src={imgUrl}
                                    alt={editOptVal}
                                    className="w-full h-full object-contain p-2"
                                    fallbackIcon="add_photo_alternate"
                                  />
                                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/45 py-1 text-center text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                                    点击更换图片
                                  </span>
                                </>
                              ) : (
                                <div className="flex flex-col items-center gap-2 text-on-surface-variant/40 transition-colors group-hover:text-on-surface-variant/70">
                                  <Icon name="add_photo_alternate" size={30} />
                                  <span className="text-xs">点击或粘贴上传图片</span>
                                </div>
                              )}
                            </label>
                            {imgUrl && (
                              <div className="flex items-center justify-end">
                                <button
                                  onClick={() => {
                                    removeOptImg(optImgField, editOptVal);
                                  }}
                                  className="rounded px-1.5 py-0.5 text-xs text-error/70 transition-colors hover:bg-error/10 hover:text-error"
                                >
                                  移除图片
                                </button>
                              </div>
                            )}
                          </section>

                          {/* ❷ 画册资料：与选项图片同构 —— 标题行在外，上传框（虚线=可投放）为唯一带边框元素 */}
                          <section className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <Icon name="menu_book" size={14} className="shrink-0 text-primary-container" />
                              <span className="shrink-0 text-xs font-bold text-on-surface">画册资料</span>
                              <span className="truncate text-[10px] text-on-surface-variant">图片或 PDF</span>
                              <span className="flex-1" />
                              <button
                                type="button"
                                role="switch"
                                aria-checked={activeCat?.catalogShared ?? false}
                                aria-label="选型结果页显示画册"
                                onClick={async () => {
                                  if (!activeCat) return;
                                  const next = !(activeCat.catalogShared ?? false);
                                  try {
                                    await updateCategory(activeCat.id, { catalogShared: next });
                                    mutateCats();
                                    toast(next ? '已开启画册显示' : '已关闭画册显示', 'success');
                                  } catch {
                                    toast('保存失败', 'error');
                                  }
                                }}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors ${activeCat?.catalogShared ? 'bg-primary-container' : 'bg-outline/30'}`}
                              >
                                <span
                                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${activeCat?.catalogShared ? 'translate-x-4' : 'translate-x-0.5'}`}
                                />
                              </button>
                            </div>
                            <label
                              onMouseEnter={() => setOptPasteZone('catalog')}
                              onMouseLeave={() => setOptPasteZone(null)}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setOptCatalogDragActive(true);
                              }}
                              onDragLeave={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setOptCatalogDragActive(false);
                              }}
                              onDrop={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setOptCatalogDragActive(false);
                                const f = Array.from(e.dataTransfer.files)[0];
                                if (!f) return;
                                if (
                                  f.type.startsWith('image/') ||
                                  f.type === 'application/pdf' ||
                                  f.name.toLowerCase().endsWith('.pdf')
                                ) {
                                  try {
                                    await uploadOptCatalog(optImgField, editOptVal, f);
                                  } catch {
                                    toast('上传失败', 'error');
                                  }
                                } else {
                                  toast('画册只支持图片或 PDF 文件', 'error');
                                }
                              }}
                              className={`group relative flex w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed bg-surface-container-lowest transition-colors ${
                                optCatalogDragActive || optPasteZone === 'catalog'
                                  ? 'border-primary-container ring-2 ring-primary-container/20'
                                  : 'border-outline-variant/25 hover:border-primary-container/30'
                              } ${catalogUrl ? 'min-h-[3.25rem] px-3 py-3' : 'flex-col gap-1 px-2.5 py-5'}`}
                            >
                              <input
                                name="file"
                                type="file"
                                accept=".pdf,image/*"
                                className="hidden"
                                onChange={async (e) => {
                                  const f = e.target.files?.[0];
                                  if (f) {
                                    try {
                                      await uploadOptCatalog(optImgField, editOptVal, f);
                                    } catch {
                                      toast('上传失败', 'error');
                                    }
                                  }
                                  e.target.value = '';
                                }}
                              />
                              {catalogUrl ? (
                                <>
                                  <div className="flex w-full items-center gap-2">
                                    <Icon
                                      name={/\.(pdf)(\?.*)?$/i.test(catalogUrl) ? 'picture_as_pdf' : 'image'}
                                      size={20}
                                      className="shrink-0 text-primary-container"
                                    />
                                    <span className="flex-1 truncate text-xs text-on-surface-variant">
                                      {catalogUrl.split('/').pop()?.split('?')[0] || '已上传'}
                                    </span>
                                  </div>
                                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/45 py-1 text-center text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                                    点击更换画册
                                  </span>
                                </>
                              ) : (
                                <div className="flex flex-col items-center gap-1 text-on-surface-variant/60 transition-colors group-hover:text-on-surface-variant">
                                  <Icon name="upload_file" size={22} />
                                  <span className="text-xs font-medium">点击 / 拖拽 上传，或停在此区按 Cmd+V</span>
                                  <span className="text-[10px]">图片或 PDF · 命中该选项值的产品会在选型结果页显示</span>
                                </div>
                              )}
                            </label>
                            <div className="flex items-center justify-between gap-2">
                              <p className="min-w-0 truncate text-[10px] text-on-surface-variant">
                                {activeCat?.catalogShared
                                  ? '已开启：选型结果页显示画册'
                                  : '已关闭：选型结果页不显示画册'}
                              </p>
                              {catalogUrl && (
                                <button
                                  onClick={() => removeOptCatalog(optImgField, editOptVal)}
                                  className="shrink-0 rounded px-1.5 py-0.5 text-xs text-error/70 transition-colors hover:bg-error/10 hover:text-error"
                                >
                                  移除画册
                                </button>
                              )}
                            </div>
                          </section>
                        </div>
                      </div>
                      <p className="shrink-0 text-center text-[10px] leading-snug text-on-surface-variant/70">
                        鼠标停在哪个上传区，Cmd+V 就传哪个区；拖文件进弹窗：图片 → 选项图片，PDF → 画册资料
                      </p>
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })()}

      {/* ===== 选项值 → 产品反查弹窗 ===== */}
      <AnimatePresence>
        {valueProductsView &&
          activeCat &&
          (() => {
            const fieldDef = activeCat.columns.find((c) => c.key === valueProductsView.field);
            const matched =
              productsByOptionValue.get(`${valueProductsView.field}\u0000${valueProductsView.value}`) || [];
            const MAX_ROWS = 200;
            const rows = matched.slice(0, MAX_ROWS);
            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="fixed inset-0 z-[330] flex items-center justify-center bg-black/50 p-3 sm:p-4"
                onClick={() => setValueProductsView(null)}
              >
                <motion.div
                  {...dialogPanelMotion}
                  className="flex max-h-[min(680px,92dvh)] w-full max-w-[min(1400px,94vw)] flex-col overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-low shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  {/* 头部：与选项设置弹窗同款（标题 + 副标题 + 分隔线 + 关闭钮） */}
                  <div className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/10 px-4 py-3.5 sm:px-5">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <h2 className="text-base font-bold leading-snug text-on-surface">
                          {fieldDef?.label || valueProductsView.field}
                        </h2>
                        <Icon name="chevron_right" size={14} className="shrink-0 text-on-surface-variant/40" />
                        <span className="min-w-0 break-words text-sm font-medium leading-snug text-on-surface">
                          {valueProductsView.value}
                        </span>
                        <span className="shrink-0 rounded-full bg-primary-container/15 px-2 py-0.5 text-[11px] font-medium tabular-nums text-primary-container">
                          {matched.length} 型号
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-on-surface-variant">
                        使用该选项值的全部产品及其参数
                        {matched.length > MAX_ROWS && ` · 仅显示前 ${MAX_ROWS} 行`}
                        {matched.length === 0 && ' · 暂无产品使用该选项值'}
                      </p>
                    </div>
                    <button
                      onClick={() => setValueProductsView(null)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </div>
                  {/* 表格：页面产品表格同款 AdminTable 组件（粘性表头/悬停行高亮/隐藏行置灰） */}
                  <div
                    // 只用 overflow-auto：面板类自带 overflow-hidden 会压掉横向滚动，宽表会被左右裁切
                    className="min-h-0 flex-1 overflow-auto custom-scrollbar"
                  >
                    <AdminTable>
                      <thead className={ADMIN_TABLE_HEAD_CLASS}>
                        <AdminTableHeadRow>
                          <AdminTableHeadCell className="whitespace-nowrap">型号</AdminTableHeadCell>
                          <AdminTableHeadCell className="whitespace-nowrap">名称</AdminTableHeadCell>
                          {activeCat.columns.map((col) => (
                            <AdminTableHeadCell
                              key={col.key}
                              className={`whitespace-nowrap ${col.key === valueProductsView.field ? 'text-primary-container' : ''}`}
                            >
                              {col.label}
                              {col.unit ? ` (${col.unit})` : ''}
                            </AdminTableHeadCell>
                          ))}
                        </AdminTableHeadRow>
                      </thead>
                      <tbody>
                        {rows.map((p) => (
                          <AdminTableBodyRow key={p.id} className={p.hidden ? 'opacity-50' : undefined}>
                            <AdminTableCell className="whitespace-nowrap font-medium">
                              {p.modelNo || '—'}
                            </AdminTableCell>
                            <AdminTableCell muted className="max-w-48 truncate" title={p.name}>
                              {p.name}
                            </AdminTableCell>
                            {activeCat.columns.map((col) => {
                              const v = (p.specs as Record<string, string>)[col.key];
                              return (
                                <AdminTableCell
                                  key={col.key}
                                  muted={col.key !== valueProductsView.field}
                                  className={`whitespace-nowrap ${
                                    col.key === valueProductsView.field ? 'font-medium !text-primary-container' : ''
                                  }`}
                                >
                                  {v ?? '—'}
                                </AdminTableCell>
                              );
                            })}
                          </AdminTableBodyRow>
                        ))}
                      </tbody>
                    </AdminTable>
                  </div>
                  {/* 底部：批量修改——单行布局，控件统一 h-8、收起/展开行高一致不跳动；
                      展开时小号下拉+输入框插在「批量修改」按钮左侧，最左侧提示文字与按钮都保留不遮挡 */}
                  <div className="flex shrink-0 flex-nowrap items-center gap-1.5 border-t border-outline-variant/10 bg-surface-container-low px-3 py-2 sm:gap-2 sm:px-5">
                    <p className="min-w-0 flex-1 truncate text-[11px] text-on-surface-variant">
                      {batchFieldEditOpen
                        ? `填值后 ✓ 应用到该选项值的 ${matched.length} 个产品；Esc 或点「批量修改」收起。`
                        : '名称不统一？可批量把该选项值下全部产品的名称或参数列设置为同一值。'}
                    </p>
                    {batchFieldEditOpen && (
                      <>
                        <div ref={batchFieldPickerRef} className="relative w-24 shrink-0 sm:w-28">
                          <button
                            type="button"
                            name="batch-field-picker"
                            onClick={() => setBatchFieldPickerOpen((v) => !v)}
                            className={`flex h-8 w-full items-center justify-between gap-1 rounded-lg border px-2 text-left text-xs transition-colors ${
                              batchFieldPickerOpen
                                ? 'border-primary-container text-on-surface ring-2 ring-primary-container/20'
                                : 'border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                            }`}
                          >
                            <span className="truncate text-on-surface">
                              {batchFieldKey === 'name'
                                ? '名称'
                                : activeCat.columns.find((c) => c.key === batchFieldKey)?.label || batchFieldKey}
                            </span>
                            <Icon
                              name="expand_more"
                              size={14}
                              className={`shrink-0 text-on-surface-variant transition-transform ${batchFieldPickerOpen ? 'rotate-180' : ''}`}
                            />
                          </button>
                          {batchFieldPickerOpen && (
                            <div className="absolute bottom-[calc(100%+4px)] left-0 z-20 max-h-56 w-max min-w-full overflow-y-auto rounded-xl border border-outline-variant/20 bg-surface-container-low py-1 shadow-2xl">
                              <button
                                type="button"
                                onClick={() => {
                                  setBatchFieldKey('name');
                                  setBatchFieldPickerOpen(false);
                                }}
                                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                                  batchFieldKey === 'name'
                                    ? 'bg-primary-container/10 font-medium text-primary-container'
                                    : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                                }`}
                              >
                                <span>名称</span>
                                <span className="text-[10px] text-on-surface-variant/60">基础字段</span>
                              </button>
                              {activeCat.columns
                                .filter((c) => c.key !== '型号')
                                .map((c) => (
                                  <button
                                    type="button"
                                    key={c.key}
                                    onClick={() => {
                                      setBatchFieldKey(c.key);
                                      setBatchFieldPickerOpen(false);
                                    }}
                                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                                      c.key === batchFieldKey
                                        ? 'bg-primary-container/10 font-medium text-primary-container'
                                        : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                                    }`}
                                  >
                                    <span className="truncate">{c.label}</span>
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                        <input
                          name="batch-field-value"
                          value={batchFieldValue}
                          onChange={(e) => setBatchFieldValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && batchFieldValue.trim() && !batchFieldBusy) {
                              e.preventDefault();
                              void handleBatchFieldUpdate();
                            } else if (e.key === 'Escape' && !batchFieldPickerOpen) {
                              setBatchFieldEditOpen(false);
                              setBatchFieldValue('');
                            }
                          }}
                          autoFocus
                          placeholder="统一设置的值"
                          className="h-8 w-52 shrink-0 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-2.5 text-xs text-on-surface outline-none transition-colors hover:border-outline-variant/40 focus:border-primary-container sm:w-72 sm:text-sm"
                        />
                        <button
                          type="button"
                          disabled={batchFieldBusy || !batchFieldValue.trim()}
                          onClick={() => void handleBatchFieldUpdate()}
                          title={`应用到该选项值命中的 ${matched.length} 个产品（含隐藏产品），操作不可撤销`}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-outline-variant/20 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
                        >
                          <Icon name={batchFieldBusy ? 'hourglass_empty' : 'check'} size={15} />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={!batchFieldEditOpen && matched.length === 0}
                      onClick={() => {
                        if (batchFieldEditOpen) {
                          setBatchFieldEditOpen(false);
                          setBatchFieldValue('');
                        } else {
                          setBatchFieldEditOpen(true);
                        }
                      }}
                      className={`flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                        batchFieldEditOpen
                          ? 'border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high'
                          : 'border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40'
                      }`}
                    >
                      <Icon name={batchFieldEditOpen ? 'close' : 'edit'} size={13} />
                      批量修改
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            );
          })()}
      </AnimatePresence>

      {/* ===== Single Rename Dialog ===== */}
      {renameOldVal && renameField && activeCat && (
        <div
          className="fixed inset-0 z-[330] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          onClick={() => setRenameOldVal('')}
        >
          <div
            className="max-h-[calc(100dvh-env(safe-area-inset-top))] w-full max-w-xs overflow-y-auto rounded-t-2xl border border-outline-variant/20 bg-surface-container-low p-4 pb-[max(env(safe-area-inset-bottom),1rem)] sm:max-h-[90dvh] sm:rounded-xl sm:p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-on-surface">修改选项值</h3>
              <button
                onClick={() => setRenameOldVal('')}
                className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div>
              <label className="text-xs text-on-surface-variant mb-1 block">当前值</label>
              <p className="text-sm text-on-surface font-medium bg-surface-container-lowest px-3 py-2 rounded border border-outline-variant/10 break-words">
                {renameOldVal}
              </p>
            </div>
            <div>
              <label className="text-xs text-on-surface-variant mb-1 block">改为</label>
              <input
                name="rename-new-val"
                value={renameNewVal}
                onChange={(e) => setRenameNewVal(e.target.value)}
                autoFocus
                className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
              <button
                onClick={() => setRenameOldVal('')}
                className="px-3 py-2 text-xs text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  if (!renameNewVal.trim() || renameNewVal === renameOldVal) return;
                  setRenaming(true);
                  try {
                    const newVal = renameNewVal.trim();
                    const { updated } = await renameOptionValue(activeCat.id, renameField, renameOldVal, newVal);
                    toast(`"${renameOldVal}" → "${newVal}"，已替换 ${updated} 个产品`, 'success');
                    // Update local orderItems to reflect the rename immediately
                    setOrderItems((prev) => prev.map((v) => (v === renameOldVal ? newVal : v)));
                    mutateCats();
                    mutateProds();
                    setRenameOldVal('');
                    setRenameNewVal('');
                  } catch {
                    toast('替换失败', 'error');
                  } finally {
                    setRenaming(false);
                  }
                }}
                disabled={renaming || !renameNewVal.trim() || renameNewVal === renameOldVal}
                className="px-3 py-2 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 disabled:opacity-50"
              >
                {renaming ? '替换中...' : '确认替换'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Product Generator Modal ===== */}
      <ProductGeneratorModal
        showGenerateModal={showGenerateModal}
        generateCat={generateCat}
        generateModelTemplate={generateModelTemplate}
        setGenerateModelTemplate={setGenerateModelTemplate}
        generateNameTemplate={generateNameTemplate}
        setGenerateNameTemplate={setGenerateNameTemplate}
        generateOptionTexts={generateOptionTexts}
        setGenerateOptionTexts={setGenerateOptionTexts}
        generateExcludeRules={generateExcludeRules}
        setGenerateExcludeRules={setGenerateExcludeRules}
        generatePreview={generatePreview}
        setGeneratePreview={setGeneratePreview}
        selectableGenerateColumns={selectableGenerateColumns}
        generateTemplateExample={generateTemplateExample}
        generateExcludeExample={generateExcludeExample}
        initialGeneratePreviewPageSize={initialGeneratePreviewPageSize}
        generatePreviewPageSize={generatePreviewPageSize}
        setGeneratePreviewPageSize={setGeneratePreviewPageSize}
        generatePreviewPage={generatePreviewPage}
        setGeneratePreviewPage={setGeneratePreviewPage}
        generatePreviewSearch={generatePreviewSearch}
        generatePreviewSearchInputValue={generatePreviewSearchInputValue}
        setGeneratePreviewSearch={setGeneratePreviewSearch}
        generatePreviewSearchInputProps={generatePreviewSearchInputProps}
        generateErrors={generateErrors}
        generateImporting={generateImporting}
        setShowGenerateModal={setShowGenerateModal}
        refreshGeneratePreview={refreshGeneratePreview}
        importGeneratedProducts={importGeneratedProducts}
        filteredGeneratePreview={filteredGeneratePreview}
        generatePreviewTotalPages={generatePreviewTotalPages}
        generatePreviewStart={generatePreviewStart}
        pagedGeneratePreview={pagedGeneratePreview}
      />

      {/* ===== Batch Import Modal ===== */}
      <BatchImportModal
        showBatchModal={showBatchModal}
        setShowBatchModal={setShowBatchModal}
        batchParsed={batchParsed}
        setBatchParsed={setBatchParsed}
        batchErrors={batchErrors}
        setBatchErrors={setBatchErrors}
        batchImporting={batchImporting}
        handleBatchImport={handleBatchImport}
        handleExcelFile={handleExcelFile}
        downloadProductImportTemplate={downloadProductImportTemplate}
        uploadPolicy={uploadPolicy}
      />

      {/* ===== 选型分类数据包搬运（本地站 ↔ 服务器站） ===== */}
      <SelectionExportModal
        open={showTransferExport}
        onClose={() => setShowTransferExport(false)}
        categories={categories}
        toast={toast}
      />
      <SelectionImportModal
        open={showTransferImport}
        onClose={() => setShowTransferImport(false)}
        onImported={() => {
          void mutateCats();
          void mutateProds();
        }}
        toast={toast}
        maxPackageMb={uploadPolicy?.selectionTransferMaxSizeMb ?? 200}
      />

      {/* ===== Group Management Modal ===== */}
      {showGroupModal && (
        <div
          className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4"
          onClick={() => {
            setShowGroupModal(false);
            setManageGroupCatsId(null);
            setDeleteGroupId(null);
            setRemoveGroupCatId(null);
          }}
        >
          <div
            className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-md sm:max-h-[90dvh] sm:p-5 sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* --- Sub-view: manage categories in a group --- */}
            {manageGroupCatsId ? (
              (() => {
                const g = groupItems.find((gi) => gi.id === manageGroupCatsId);
                const catsInGroup = categories.filter((c) => c.groupId === manageGroupCatsId);
                const otherCats = categories.filter((c) => c.groupId !== manageGroupCatsId);
                const updateManagedGroup = (
                  patch: Partial<{ name: string; icon: string; image: string; imageFit: 'cover' | 'contain' }>,
                ) => {
                  setGroupItems((items) =>
                    items.map((item) => (item.id === manageGroupCatsId ? { ...item, ...patch } : item)),
                  );
                };
                const saveManagedGroupSettings = async () => {
                  if (!g?.name.trim()) {
                    toast('请输入分组名称', 'error');
                    return;
                  }
                  try {
                    await updateSelectionGroup(manageGroupCatsId, {
                      groupName: g.name.trim(),
                      groupIcon: g.icon.trim() || 'category',
                      groupImage: g.image || null,
                      groupImageFit: g.imageFit,
                    });
                    patchGroupCategoryCache(manageGroupCatsId, {
                      groupName: g.name.trim(),
                      groupIcon: g.icon.trim() || 'category',
                      groupImage: g.image || null,
                      groupImageFit: g.imageFit,
                    });
                    toast('分组设置已保存', 'success');
                  } catch (err) {
                    toast(getApiErrorMessage(err, '分组设置保存失败'), 'error');
                  }
                };
                const saveManagedGroupImage = async (
                  image = g?.image || '',
                  imageFit: 'cover' | 'contain' = g?.imageFit || 'cover',
                ) => {
                  try {
                    const nextImage = image || '';
                    await updateSelectionGroup(manageGroupCatsId, {
                      groupImage: nextImage || null,
                      groupImageFit: imageFit,
                    });
                    updateManagedGroup({ image: nextImage, imageFit });
                    patchGroupCategoryCache(manageGroupCatsId, {
                      groupImage: nextImage || null,
                      groupImageFit: imageFit,
                    });
                    return true;
                  } catch (err) {
                    toast(getApiErrorMessage(err, '封面设置保存失败'), 'error');
                    return false;
                  }
                };
                const uploadManagedGroupImageFromUrl = async (imageUrl?: string) => {
                  const targetUrl = imageUrl?.trim() || '';
                  if (!targetUrl) return false;
                  if (!/^https?:\/\/.+/i.test(targetUrl)) {
                    return false;
                  }
                  try {
                    toast('正在下载图片...', 'info');
                    const { url } = await uploadOptionImageFromUrl(targetUrl);
                    if (await saveManagedGroupImage(url, g?.imageFit || 'cover')) {
                      updateManagedGroup({ image: url });
                      toast('图片已下载并保存', 'success');
                    }
                    return true;
                  } catch {
                    toast('下载图片失败', 'error');
                    return true;
                  }
                };
                const uploadManagedGroupFile = async (file: File) => {
                  try {
                    const { url } = await uploadOptionImage(file);
                    if (await saveManagedGroupImage(url, g?.imageFit || 'cover')) {
                      updateManagedGroup({ image: url });
                      toast('分组封面已上传', 'success');
                    }
                  } catch (err) {
                    toast(getApiErrorMessage(err, '上传失败'), 'error');
                  }
                };
                const importManagedGroupCover = async () => {
                  try {
                    if (navigator.clipboard?.read) {
                      const items = await navigator.clipboard.read();
                      for (const item of items) {
                        const imageType = item.types.find((type) => type.startsWith('image/'));
                        if (imageType) {
                          const blob = await item.getType(imageType);
                          await uploadManagedGroupFile(
                            new File([blob], `group-cover.${imageType.split('/')[1] || 'png'}`, { type: imageType }),
                          );
                          return;
                        }
                      }
                    }
                    const text = await navigator.clipboard?.readText?.();
                    if (text && (await uploadManagedGroupImageFromUrl(text))) return;
                  } catch {
                    // Clipboard permission may be unavailable; file picker is the graceful fallback.
                  }
                  groupCoverInputRef.current?.click();
                };
                const handleManagedGroupCoverPaste = async (e: React.ClipboardEvent) => {
                  for (const item of Array.from(e.clipboardData.items)) {
                    if (item.type.startsWith('image/')) {
                      e.preventDefault();
                      const file = item.getAsFile();
                      if (!file) return;
                      await uploadManagedGroupFile(file);
                      return;
                    }
                  }
                  const text = e.clipboardData.getData('text/plain')?.trim();
                  if (text && /^https?:\/\/.+/i.test(text)) {
                    e.preventDefault();
                    await uploadManagedGroupImageFromUrl(text);
                  }
                };
                return (
                  <>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => {
                          setManageGroupCatsId(null);
                          setRemoveGroupCatId(null);
                        }}
                        className="text-on-surface-variant hover:text-on-surface"
                      >
                        <Icon name="arrow_back" size={18} />
                      </button>
                      <h2 className="text-base font-bold text-on-surface">{g?.name} — 分类管理</h2>
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
                      <div className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3 space-y-3">
                        <div>
                          <p className="text-xs font-bold text-on-surface">分组设置</p>
                          <p className="text-[10px] text-on-surface-variant mt-0.5">修改当前分组的名称和图标</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr] gap-2">
                          <input
                            name="g"
                            value={g?.icon || ''}
                            onChange={(e) => updateManagedGroup({ icon: e.target.value })}
                            placeholder="图标"
                            className="w-full bg-surface-container-low text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                          />
                          <input
                            name="g"
                            value={g?.name || ''}
                            onChange={(e) => updateManagedGroup({ name: e.target.value })}
                            placeholder="分组名称"
                            className="w-full bg-surface-container-low text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            onClick={saveManagedGroupSettings}
                            disabled={!g?.name.trim()}
                            className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 disabled:opacity-50"
                          >
                            保存设置
                          </button>
                        </div>
                      </div>
                      <div
                        className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3 space-y-3"
                        onPaste={handleManagedGroupCoverPaste}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-on-surface">分组封面</p>
                            <p className="text-[10px] text-on-surface-variant mt-0.5">
                              推荐 1600×800 或 1200×600，比例 2:1，和前台分类大图一致
                            </p>
                          </div>
                          <div className="flex rounded-lg bg-surface-container-high p-0.5 text-[11px]">
                            {[
                              { value: 'cover', label: '铺满裁切' },
                              { value: 'contain', label: '完整显示' },
                            ].map((mode) => (
                              <button
                                key={mode.value}
                                onClick={async () => {
                                  const imageFit = mode.value as 'cover' | 'contain';
                                  const prevImageFit = g?.imageFit || 'cover';
                                  updateManagedGroup({ imageFit });
                                  const saved = await saveManagedGroupImage(g?.image || '', imageFit);
                                  if (!saved) updateManagedGroup({ imageFit: prevImageFit });
                                }}
                                className={`px-2.5 py-1 rounded-md transition-colors ${g?.imageFit === mode.value ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
                              >
                                {mode.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="aspect-[2.35/1] rounded-lg overflow-hidden border border-outline-variant/10 bg-surface-container-high">
                          {g?.image ? (
                            <SafeImage
                              src={g.image}
                              alt=""
                              className={
                                g.imageFit === 'contain'
                                  ? 'w-full h-full object-contain p-2'
                                  : 'w-full h-full object-cover'
                              }
                              fallbackIcon="image"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-on-surface-variant">
                              <Icon name={g?.icon || 'category'} size={26} />
                            </div>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-1.5 rounded-lg bg-surface-container-high/50 px-2.5 py-2 text-[10px] leading-relaxed text-on-surface-variant sm:grid-cols-2">
                          <span>上传：支持截图粘贴、远程图片地址或本地图片；推荐 2:1 横图</span>
                          <span>显示：产品影棚图建议“铺满裁切”，带边缘信息建议“完整显示”</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] text-on-surface-variant">图片主体尽量居中，四周保留 8% 安全边距</p>
                          <input
                            name="file"
                            ref={groupCoverInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (f) await uploadManagedGroupFile(f);
                              e.target.value = '';
                            }}
                          />
                          <div className="flex items-center gap-1.5">
                            {g?.image && (
                              <button
                                onClick={async () => {
                                  const saved = await saveManagedGroupImage('', g?.imageFit || 'cover');
                                  if (saved) {
                                    updateManagedGroup({ image: '' });
                                    toast('分组封面已删除', 'success');
                                  }
                                }}
                                className="px-3 py-1.5 text-xs font-medium border border-outline-variant/30 text-error/70 hover:text-error rounded hover:border-error/30 shrink-0"
                              >
                                删除封面
                              </button>
                            )}
                            <button
                              onClick={importManagedGroupCover}
                              className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 shrink-0"
                            >
                              上传封面
                            </button>
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wide">
                        当前分组内（{catsInGroup.length}）
                      </p>
                      {catsInGroup.length === 0 && (
                        <p className="text-xs text-on-surface-variant py-2 text-center">暂无分类</p>
                      )}
                      {catsInGroup.map((c) => (
                        <div
                          key={c.id}
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-outline-variant/20 bg-surface-container-lowest"
                        >
                          <Icon name={c.icon || 'category'} size={14} className="text-primary-container shrink-0" />
                          <span className="text-sm text-on-surface flex-1 truncate">{c.name}</span>
                          {removeGroupCatId === c.id ? (
                            <div className="flex shrink-0 items-center gap-1">
                              <button
                                onClick={async () => {
                                  await updateCategory(c.id, {
                                    groupId: null,
                                    groupName: null,
                                    groupIcon: null,
                                    groupImage: null,
                                    groupImageFit: null,
                                  });
                                  patchSelectionCategoryCache(c.id, {
                                    groupId: null,
                                    groupName: null,
                                    groupIcon: null,
                                    groupImage: null,
                                    groupImageFit: null,
                                  });
                                  setGroupItems((items) =>
                                    items.map((item) =>
                                      item.id === manageGroupCatsId
                                        ? { ...item, catCount: Math.max(0, item.catCount - 1) }
                                        : item,
                                    ),
                                  );
                                  setRemoveGroupCatId(null);
                                  toast(`"${c.name}" 已移出分组`, 'success');
                                }}
                                className="rounded bg-error/10 px-2 py-1 text-[11px] font-bold text-error"
                              >
                                确认
                              </button>
                              <button
                                onClick={() => setRemoveGroupCatId(null)}
                                className="rounded px-2 py-1 text-[11px] text-on-surface-variant hover:bg-surface-container-high"
                              >
                                取消
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setRemoveGroupCatId(c.id)}
                              className="text-error/60 hover:text-error shrink-0"
                              data-tooltip-ignore
                              aria-label="移出分组"
                              title="移出分组"
                            >
                              <Icon name="close" size={14} />
                            </button>
                          )}
                        </div>
                      ))}

                      {otherCats.length > 0 && (
                        <>
                          <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wide pt-2">
                            其他分类（点击添加到本组）
                          </p>
                          {otherCats.map((c) => {
                            const srcGroup = c.groupId ? groupItems.find((gi) => gi.id === c.groupId) : null;
                            return (
                              <button
                                key={c.id}
                                onClick={async () => {
                                  const previousGroupId = c.groupId || null;
                                  await updateCategory(c.id, {
                                    groupId: manageGroupCatsId,
                                    groupName: g?.name || '',
                                    groupIcon: g?.icon || 'category',
                                    groupImage: g?.image || null,
                                    groupImageFit: g?.imageFit || 'cover',
                                  });
                                  patchSelectionCategoryCache(c.id, {
                                    groupId: manageGroupCatsId,
                                    groupName: g?.name || '',
                                    groupIcon: g?.icon || 'category',
                                    groupImage: g?.image || null,
                                    groupImageFit: g?.imageFit || 'cover',
                                  });
                                  setGroupItems((items) =>
                                    items.map((item) => {
                                      if (item.id === manageGroupCatsId)
                                        return { ...item, catCount: item.catCount + 1 };
                                      if (previousGroupId && item.id === previousGroupId) {
                                        return { ...item, catCount: Math.max(0, item.catCount - 1) };
                                      }
                                      return item;
                                    }),
                                  );
                                  toast(`"${c.name}" 已移入本组`, 'success');
                                }}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-outline-variant/30 bg-surface-container-lowest hover:border-primary-container/40 hover:bg-primary-container/5 w-full text-left transition-colors"
                              >
                                <Icon name="add" size={14} className="text-primary-container shrink-0" />
                                <span className="text-sm text-on-surface-variant flex-1 truncate">{c.name}</span>
                                {srcGroup ? (
                                  <span className="text-[10px] text-on-surface-variant/60 shrink-0">
                                    来自: {srcGroup.name}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-on-surface-variant/60 shrink-0">未分组</span>
                                )}
                              </button>
                            );
                          })}
                        </>
                      )}
                    </div>

                    <div className="flex justify-end shrink-0 pt-2 border-t border-outline-variant/10">
                      <button
                        onClick={() => {
                          setManageGroupCatsId(null);
                          setRemoveGroupCatId(null);
                        }}
                        className="px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high/50 rounded"
                      >
                        返回
                      </button>
                    </div>
                  </>
                );
              })()
            ) : (
              <>
                {/* --- Main view: group list --- */}
                <div className="flex items-center justify-between shrink-0">
                  <h2 className="text-base font-bold text-on-surface">分组管理</h2>
                  <button
                    onClick={() => {
                      setShowGroupModal(false);
                      setDeleteGroupId(null);
                      setRemoveGroupCatId(null);
                    }}
                    className="text-on-surface-variant hover:text-on-surface"
                  >
                    <Icon name="close" size={18} />
                  </button>
                </div>

                {/* Add group form */}
                <div className="shrink-0 space-y-2 border-b border-outline-variant/10 pb-3">
                  <div className="flex items-center gap-2">
                    <input
                      name="icon"
                      value={groupForm.icon}
                      onChange={(e) => setGroupForm({ ...groupForm, icon: e.target.value })}
                      placeholder="图标"
                      className="w-20 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                    />
                    <input
                      name="name"
                      value={groupForm.name}
                      onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                      placeholder="分组名称"
                      className="flex-1 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                    />
                    <button
                      onClick={async () => {
                        if (!groupForm.name.trim()) return;
                        const newId = `group_${Date.now()}`;
                        setGroupItems([
                          ...groupItems,
                          {
                            id: newId,
                            name: groupForm.name.trim(),
                            icon: groupForm.icon.trim() || 'category',
                            image: '',
                            imageFit: 'cover',
                            catCount: 0,
                          },
                        ]);
                        toast('分组已创建');
                        setGroupForm({ name: '', icon: 'category', image: '', imageFit: 'cover' });
                        mutateCats();
                      }}
                      disabled={!groupForm.name.trim()}
                      className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 disabled:opacity-50 shrink-0"
                    >
                      创建
                    </button>
                  </div>
                  <p className="text-[10px] text-on-surface-variant">
                    名称、图标、封面和分类归属都在进入分组后的“管理分类”里调整。
                  </p>
                </div>

                {/* Group list */}
                <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
                  {groupItems.length === 0 && (
                    <p className="text-center py-8 text-on-surface-variant text-sm">暂无分组</p>
                  )}
                  {groupItems.map((g, i) => (
                    <div
                      key={g.id}
                      draggable
                      onDragStart={() => setGroupDragIdx(i)}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (groupDragIdx === null || groupDragIdx === i) return;
                        const next = [...groupItems];
                        const [moved] = next.splice(groupDragIdx, 1);
                        next.splice(i, 0, moved);
                        setGroupItems(next);
                        setGroupDragIdx(i);
                      }}
                      onDragEnd={() => setGroupDragIdx(null)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                        groupDragIdx === i
                          ? 'opacity-40 border-primary-container/30 bg-primary-container/5'
                          : 'border-outline-variant/20 bg-surface-container-lowest hover:border-outline-variant/40'
                      }`}
                    >
                      <span className="cursor-grab active:cursor-grabbing text-on-surface-variant/40 select-none text-sm">
                        ⠿
                      </span>
                      {g.image ? (
                        <SafeImage
                          src={g.image}
                          alt=""
                          className={`h-8 w-12 rounded border border-outline-variant/10 shrink-0 ${g.imageFit === 'contain' ? 'object-contain p-0.5 bg-surface-container-high' : 'object-cover'}`}
                          fallbackIcon="image"
                        />
                      ) : (
                        <Icon name={g.icon} size={16} className="text-primary-container shrink-0" />
                      )}
                      <span className="text-sm font-medium text-on-surface flex-1">{g.name}</span>
                      <span className="text-[10px] text-on-surface-variant">{g.catCount} 个分类</span>
                      <button
                        onClick={() => setManageGroupCatsId(g.id)}
                        className="text-primary-container hover:bg-primary-container/10 rounded p-1"
                      >
                        <Icon name="settings" size={13} />
                      </button>
                      {deleteGroupId === g.id ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            onClick={async () => {
                              const catsInGroup = categories.filter((c) => c.groupId === g.id);
                              for (const c of catsInGroup) {
                                await updateCategory(c.id, {
                                  groupId: null,
                                  groupName: null,
                                  groupIcon: null,
                                  groupImage: null,
                                  groupImageFit: null,
                                });
                              }
                              patchGroupCategoryCache(g.id, {
                                groupId: null,
                                groupName: null,
                                groupIcon: null,
                                groupImage: null,
                                groupImageFit: null,
                              });
                              setGroupItems(groupItems.filter((gi) => gi.id !== g.id));
                              setDeleteGroupId(null);
                              toast('分组已删除', 'success');
                            }}
                            className="rounded bg-error/10 px-2 py-1 text-[11px] font-bold text-error"
                          >
                            确认
                          </button>
                          <button
                            onClick={() => setDeleteGroupId(null)}
                            className="rounded px-2 py-1 text-[11px] text-on-surface-variant hover:bg-surface-container-high"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteGroupId(g.id)}
                          className={SELECTION_ICON_BUTTON_DELETE}
                          data-tooltip-ignore
                          aria-label="删除分组"
                        >
                          <Icon name="delete" size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {/* Save group order */}
                <div className="flex justify-end gap-2 shrink-0 pt-2 border-t border-outline-variant/10">
                  <button
                    onClick={() => {
                      setShowGroupModal(false);
                      setDeleteGroupId(null);
                      setRemoveGroupCatId(null);
                    }}
                    className="px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high/50 rounded"
                  >
                    关闭
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        for (const g of groupItems) {
                          await updateSelectionGroup(g.id, {
                            groupName: g.name,
                            groupIcon: g.icon,
                            groupImage: g.image || null,
                            groupImageFit: g.imageFit,
                          });
                        }
                        toast('分组已保存', 'success');
                        setShowGroupModal(false);
                        setDeleteGroupId(null);
                        setRemoveGroupCatId(null);
                        mutateCats();
                      } catch {
                        toast('保存失败', 'error');
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90"
                  >
                    保存设置
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== Category Sort Modal ===== */}
      {showCatSortModal && (
        <div
          className="fixed inset-0 z-[320] bg-black/50 p-0 sm:flex sm:items-center sm:justify-center sm:p-4"
          onClick={() => setShowCatSortModal(false)}
        >
          <div
            className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] flex min-h-0 flex-col bg-surface-container-low rounded-2xl border border-outline-variant/20 p-4 space-y-4 shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-md sm:max-h-[90dvh] sm:p-5 sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between shrink-0">
              <h2 className="text-base font-bold text-on-surface">分类排序</h2>
              <button
                onClick={() => setShowCatSortModal(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <p className="text-xs text-on-surface-variant shrink-0">拖拽调整分类显示顺序</p>
            <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
              {catSortItems.map((item, i) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setCatSortDragIdx(i)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (catSortDragIdx === null || catSortDragIdx === i) return;
                    const next = [...catSortItems];
                    const [moved] = next.splice(catSortDragIdx, 1);
                    next.splice(i, 0, moved);
                    setCatSortItems(next);
                    setCatSortDragIdx(i);
                  }}
                  onDragEnd={() => setCatSortDragIdx(null)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all ${
                    catSortDragIdx === i
                      ? 'opacity-40 border-primary-container/30 bg-primary-container/5'
                      : 'border-outline-variant/20 bg-surface-container-lowest hover:border-outline-variant/40'
                  }`}
                >
                  <span className="cursor-grab active:cursor-grabbing text-on-surface-variant/40 select-none text-sm">
                    ⠿
                  </span>
                  <span className="text-sm font-medium text-on-surface flex-1">{item.name}</span>
                  <span className="text-[10px] text-on-surface-variant">{i + 1}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 shrink-0 pt-2 border-t border-outline-variant/10">
              <button
                onClick={() => setShowCatSortModal(false)}
                className="px-3 py-1.5 text-xs text-on-surface-variant hover:bg-surface-container-high/50 rounded"
              >
                取消
              </button>
              <button
                onClick={async () => {
                  try {
                    await sortCategories(catSortItems.map((item, i) => ({ id: item.id, sortOrder: i })));
                    toast('排序已保存', 'success');
                    setShowCatSortModal(false);
                    mutateCats();
                  } catch (err: unknown) {
                    toast(getApiErrorMessage(err, '排序保存失败'), 'error');
                  }
                }}
                className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90"
              >
                保存排序
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminManagementPage>
  );
}

export default function SelectionAdminPage() {
  useDocumentTitle('选型管理');

  return (
    <AdminPageShell desktopContentClassName="overflow-y-scroll selection-scrollbarless [scrollbar-gutter:stable]">
      <Content />
    </AdminPageShell>
  );
}

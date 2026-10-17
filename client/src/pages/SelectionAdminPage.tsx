import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
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
  type OptionCatalogEntry,
  optionCatalogUrl,
  optionCatalogUpdatedAt,
} from '../api/selections';
import { CatalogZoomModal } from '../components/selection/CatalogZoomModal';
import { isSafeUrl } from '../lib/sanitizeHtml';
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
  parseGenerateEntries,
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

/** 反查弹窗「新增产品」草稿行：默认复制首行（上一行）数据，管理端改完确认后创建 */
interface ValueProductDraft {
  modelNo: string;
  name: string;
  specs: Record<string, string>;
  /** 以下为静默携带的模板行属性（草稿行内不可编辑，复制保持一致） */
  image?: string;
  pdfUrl?: string;
  isKit?: boolean;
  components?: SelectionComponent[];
  sortOrder?: number;
}

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
  const { t } = useTranslation();
  return (
    <AdminTableBodyRow className={p.hidden ? 'opacity-55' : undefined}>
      <AdminTableCell className="w-10 px-3 py-2.5">
        <input
          name="select-product"
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelected(p.id)}
          className="h-4 w-4 accent-primary-container"
          aria-label={t('selectionAdmin.selectProductAria', { name: p.modelNo || p.name })}
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
            aria-label={p.hidden ? t('selectionAdmin.restoreProduct') : t('selectionAdmin.hideProduct')}
          >
            <Icon name={p.hidden ? 'visibility_off' : 'visibility'} size={13} />
          </button>
          <button
            onClick={() => onEdit(p)}
            className={SELECTION_ICON_BUTTON_EDIT}
            data-tooltip-ignore
            aria-label={t('selectionAdmin.editProduct')}
          >
            <Icon name="edit" size={13} />
          </button>
          {isDeleting ? (
            <>
              <button
                onClick={() => onConfirmDelete(p.id)}
                className="px-1.5 py-0.5 text-[10px] bg-error text-on-error-container rounded"
              >
                {t('common.confirm')}
              </button>
              <button onClick={onCancelDelete} className="px-1.5 py-0.5 text-[10px] text-on-surface-variant">
                {t('common.cancel')}
              </button>
            </>
          ) : (
            <button
              onClick={() => onRequestDelete(p.id)}
              className={SELECTION_ICON_BUTTON_DELETE}
              data-tooltip-ignore
              aria-label={t('selectionAdmin.deleteProduct')}
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
  const { t } = useTranslation();
  const specs = (p.specs as Record<string, string>) || {};
  const primaryColumn = columns.find((col) => col.displayOnly) || columns[0];
  const title =
    p.modelNo || (primaryColumn ? specs[primaryColumn.key] : '') || p.name || t('selectionAdmin.unnamedProduct');
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
          aria-label={t('selectionAdmin.selectProductAria', { name: p.modelNo || p.name })}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-sm font-bold leading-snug text-on-surface break-words">
            <span>{title}</span>
            {p.hidden ? (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-surface-container-high px-1.5 py-0.5 text-[9px] font-medium text-on-surface-variant/70">
                <Icon name="visibility_off" size={10} />
                {t('selectionAdmin.hiddenBadge')}
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
            aria-label={p.hidden ? t('selectionAdmin.restoreProduct') : t('selectionAdmin.hideProduct')}
          >
            <Icon name={p.hidden ? 'visibility_off' : 'visibility'} size={14} />
          </button>
          <button
            onClick={() => onEdit(p)}
            className={SELECTION_ICON_BUTTON_EDIT}
            data-tooltip-ignore
            aria-label={t('selectionAdmin.editProduct')}
          >
            <Icon name="edit" size={14} />
          </button>
          {isDeleting ? (
            <>
              <button
                onClick={() => onConfirmDelete(p.id)}
                className="h-8 px-2 text-[10px] font-bold bg-error text-on-error-container rounded"
              >
                {t('common.confirm')}
              </button>
              <button
                onClick={onCancelDelete}
                className="h-8 px-2 text-[10px] text-on-surface-variant bg-surface-container-high rounded"
              >
                {t('common.cancel')}
              </button>
            </>
          ) : (
            <button
              onClick={() => onRequestDelete(p.id)}
              className={SELECTION_ICON_BUTTON_DELETE}
              data-tooltip-ignore
              aria-label={t('selectionAdmin.deleteProduct')}
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
  const { t } = useTranslation();
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
  // 画册查看弹窗（复用前台 CatalogZoomModal：管理员所见即用户所见，图片可缩放、PDF 内嵌渲染）
  const [optCatalogZoom, setOptCatalogZoom] = useState(false);
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
  // 反查弹窗产品批量管理：行勾选（批量删除）+ 新增产品草稿行（默认带首行数据，改完确认创建）
  const [valueProductsSelected, setValueProductsSelected] = useState<Set<string>>(new Set());
  const [valueProductsDraft, setValueProductsDraft] = useState<ValueProductDraft | null>(null);
  // 反查弹窗单行编辑：{ id, draft }，与新增草稿互斥（同时只开一个行内编辑）
  const [valueProductsEdit, setValueProductsEdit] = useState<{ id: string; draft: ValueProductDraft } | null>(null);
  const [valueProductsBusy, setValueProductsBusy] = useState(false);
  const [valueDeleteConfirmOpen, setValueDeleteConfirmOpen] = useState(false);
  // 新增草稿行插在表格首行：打开时把表格滚回顶部，保证草稿行可见
  const valueProductsScrollRef = useRef<HTMLDivElement | null>(null);

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
  // 勾选/新增草稿/行内编辑跟随弹窗目标重置：打开新选项值或关闭都清空
  useEffect(() => {
    setValueProductsSelected(new Set());
    setValueProductsDraft(null);
    setValueProductsEdit(null);
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
        toast(t('selectionAdmin.groupCoverPasted'), 'success');
      } catch (err) {
        toast(getApiErrorMessage(err, t('selectionAdmin.uploadFailed')), 'error');
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
        toast(t('selectionAdmin.categoryUpdated'), 'success');
      } else {
        await createCategory(payload);
        toast(t('selectionAdmin.categoryCreated'), 'success');
      }
      setShowCatModal(false);
      mutateCats();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, t('selectionAdmin.opFailed')), 'error');
    }
  }
  async function handleDeleteCat(id: string, force = false) {
    try {
      await deleteCategory(id, { force });
      toast(t('selectionAdmin.categoryDeleted'), 'success');
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
      toast(getApiErrorMessage(err, t('selectionAdmin.deleteFailed')), 'error');
    }
  }

  /* 隐藏开关：开启后分类/产品不再出现在公开选型页、不参与选型（管理端仍可见可编辑，方便配置好再上线） */
  async function toggleCatHidden(cat: SelectionCategory) {
    const next = !cat.hidden;
    try {
      await updateCategory(cat.id, { hidden: next });
      mutateCats();
      toast(
        next
          ? t('selectionAdmin.categoryHiddenToast', { name: cat.name })
          : t('selectionAdmin.categoryShownToast', { name: cat.name }),
        'success',
      );
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, t('selectionAdmin.opFailed')), 'error');
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
          next
            ? t('selectionAdmin.productHiddenToast', { name: p.modelNo || p.name })
            : t('selectionAdmin.productShownToast', { name: p.modelNo || p.name }),
          'success',
        );
      } catch (err: unknown) {
        toast(getApiErrorMessage(err, t('selectionAdmin.opFailed')), 'error');
      }
    },
    [mutateProds, t, toast],
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
    : t('selectionAdmin.templateExampleFallback');
  const generateExcludeExample = selectableGenerateColumns.length
    ? (() => {
        const [first, second, third] = selectableGenerateColumns;
        const firstKey = first?.key || t('selectionAdmin.fieldA');
        const secondKey = second?.key || t('selectionAdmin.fieldB');
        const thirdKey = third?.key || secondKey;
        return t('selectionAdmin.excludeExample', { first: firstKey, second: secondKey, third: thirdKey });
      })()
    : t('selectionAdmin.excludeExampleFallback');
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
      toast(t('selectionAdmin.pleaseSelectCategory'), 'error');
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
        toast(t('selectionAdmin.productUpdated'), 'success');
      } else {
        await createProduct({ categoryId: selectedCatId, ...payload });
        toast(t('selectionAdmin.productCreated'), 'success');
      }
      setShowProdModal(false);
      mutateProds();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, t('selectionAdmin.opFailed')), 'error');
    }
  }
  const handleDeleteProd = useCallback(
    async (id: string) => {
      try {
        await deleteProduct(id);
        toast(t('selectionAdmin.productDeleted'), 'success');
        setDeleteProdId(null);
        mutateProds();
      } catch (err: unknown) {
        toast(getApiErrorMessage(err, t('selectionAdmin.deleteFailed')), 'error');
      }
    },
    [mutateProds, t, toast],
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
      toast(
        hidden
          ? t('selectionAdmin.batchHiddenToast', { count: updated })
          : t('selectionAdmin.batchShownToast', { count: updated }),
        'success',
      );
      setSelectedProdIds(new Set());
      mutateProds();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, t('selectionAdmin.batchOpFailed')), 'error');
    } finally {
      setBatchBusy(false);
    }
  };
  // 反查弹窗「批量修改」：勾选了行只应用到勾选的，未勾选应用到当前选项值命中的全部产品
  const handleBatchFieldUpdate = async () => {
    if (!valueProductsView || batchFieldBusy) return;
    const value = batchFieldValue.trim();
    if (!value) {
      toast(t('selectionAdmin.fillValueFirst'), 'error');
      return;
    }
    // 与 productsByOptionValue 同语义（specs[field] === value 的全部产品），但该 memo 定义在本函数之后，
    // 这里直接从 products 过滤，避免 no-use-before-define
    const matched = products.filter(
      (p) => (p.specs as Record<string, string>)[valueProductsView.field] === valueProductsView.value,
    );
    if (!matched.length) return;
    // 批量修改只作用于勾选行：没勾选不允许改（防误改该选项值下全部产品）
    const matchedIds = new Set(matched.map((p) => p.id));
    const targetIds = [...valueProductsSelected].filter((id) => matchedIds.has(id));
    if (!targetIds.length) {
      toast(t('selectionAdmin.selectProductsFirst'), 'error');
      return;
    }
    setBatchFieldBusy(true);
    try {
      const { updated } = await batchUpdateSelectionProductField(targetIds, batchFieldKey, value);
      const fieldLabel =
        batchFieldKey === 'name'
          ? t('selectionAdmin.colName')
          : activeCat?.columns.find((c) => c.key === batchFieldKey)?.label || batchFieldKey;
      toast(t('selectionAdmin.batchFieldApplied', { count: updated, field: fieldLabel, value }), 'success');
      setBatchFieldEditOpen(false);
      setBatchFieldValue('');
      mutateProds();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, t('selectionAdmin.batchEditFailed')), 'error');
    } finally {
      setBatchFieldBusy(false);
    }
  };
  // ---- 反查弹窗：新增产品（草稿行默认带首行/上一行数据，改完 ✓ 确认创建）+ 单行编辑 + 批量删除勾选行 ----
  const startValueProductsDraft = () => {
    if (!valueProductsView) return;
    setValueProductsEdit(null);
    valueProductsScrollRef.current?.scrollTo({ top: 0 });
    const tpl = products.find(
      (p) => (p.specs as Record<string, string>)[valueProductsView.field] === valueProductsView.value,
    );
    setValueProductsDraft({
      modelNo: tpl?.modelNo || '',
      name: tpl?.name || '',
      specs: tpl
        ? { ...(tpl.specs as Record<string, string>) }
        : { [valueProductsView.field]: valueProductsView.value },
      image: tpl?.image || undefined,
      pdfUrl: tpl?.pdfUrl || undefined,
      isKit: tpl?.isKit || undefined,
      components: tpl?.components ? [...tpl.components] : undefined,
      sortOrder: tpl?.sortOrder,
    });
  };
  const handleValueProductCreate = async () => {
    if (!valueProductsView || !activeCat || !valueProductsDraft || valueProductsBusy) return;
    const modelNo = valueProductsDraft.modelNo.trim();
    const name = valueProductsDraft.name.trim();
    if (!modelNo && !name) {
      toast(t('selectionAdmin.modelOrNameRequired'), 'error');
      return;
    }
    // 型号在分类内是产品身份（批量导入按 categoryId+modelNo upsert）：
    // 草稿默认复制首行数据，未改动直接确认等于复制出同型号产品 → 拦截
    if (modelNo && products.some((p) => (p.modelNo || '').trim() === modelNo)) {
      toast(t('selectionAdmin.modelExists', { model: modelNo }), 'error');
      return;
    }
    // 新行必须属于当前选项值（当前字段锁定为该值，其余参数可改）
    const specs = { ...valueProductsDraft.specs, [valueProductsView.field]: valueProductsView.value };
    // specs['型号'] 与 modelNo 镜像同步（与批量导入同规则），避免带出的旧镜像和填写的型号不一致
    if (modelNo) specs['型号'] = modelNo;
    else delete specs['型号'];
    setValueProductsBusy(true);
    try {
      await createProduct({
        categoryId: activeCat.id,
        name: name || modelNo,
        modelNo: modelNo || undefined,
        specs,
        image: valueProductsDraft.image,
        pdfUrl: valueProductsDraft.pdfUrl,
        isKit: valueProductsDraft.isKit,
        components: valueProductsDraft.components,
        sortOrder: valueProductsDraft.sortOrder,
      });
      toast(t('selectionAdmin.productCreatedToast', { name: name || modelNo }), 'success');
      setValueProductsDraft(null);
      mutateProds();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, t('selectionAdmin.createProductFailed')), 'error');
    } finally {
      setValueProductsBusy(false);
    }
  };
  // 反查弹窗「编辑」：行内修改单个产品的型号/名称/参数（含当前选项值列，可把产品挪到别的选项值下）
  const startValueProductsEdit = (p: SelectionProduct) => {
    setValueProductsDraft(null);
    setValueProductsEdit({
      id: p.id,
      draft: {
        modelNo: p.modelNo || '',
        name: p.name || '',
        specs: { ...(p.specs as Record<string, string>) },
      },
    });
  };
  const handleValueProductSave = async () => {
    if (!valueProductsEdit || valueProductsBusy) return;
    const modelNo = valueProductsEdit.draft.modelNo.trim();
    const name = valueProductsEdit.draft.name.trim();
    if (!modelNo && !name) {
      toast(t('selectionAdmin.modelOrNameRequired'), 'error');
      return;
    }
    // 改型号撞上分类内其他产品 → 拦截（型号是产品身份，同型号会造成批量导入 upsert 冲突）
    if (modelNo && products.some((p) => (p.modelNo || '').trim() === modelNo && p.id !== valueProductsEdit.id)) {
      toast(t('selectionAdmin.modelTaken', { model: modelNo }), 'error');
      return;
    }
    // PUT 的 specs 是整体替换：带上草稿里的全部参数列，清空的列即清除该参数
    const specs: Record<string, string> = {};
    for (const [k, v] of Object.entries(valueProductsEdit.draft.specs)) {
      const t = (v ?? '').trim();
      if (t) specs[k] = t;
    }
    // specs['型号'] 是 modelNo 的镜像：改了型号要同步，避免残留旧值（表格里型号只显示专用列）
    if (modelNo) specs['型号'] = modelNo;
    setValueProductsBusy(true);
    try {
      await updateProduct(valueProductsEdit.id, { name: name || modelNo, modelNo: modelNo || undefined, specs });
      toast(t('selectionAdmin.productUpdated'), 'success');
      setValueProductsEdit(null);
      mutateProds();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, t('selectionAdmin.saveFailed')), 'error');
    } finally {
      setValueProductsBusy(false);
    }
  };
  const handleValueProductsDelete = async () => {
    if (!valueProductsView || valueProductsBusy) return;
    const ids = products
      .filter(
        (p) =>
          (p.specs as Record<string, string>)[valueProductsView.field] === valueProductsView.value &&
          valueProductsSelected.has(p.id),
      )
      .map((p) => p.id);
    if (!ids.length) {
      setValueDeleteConfirmOpen(false);
      setValueProductsSelected(new Set());
      return;
    }
    setValueProductsBusy(true);
    try {
      const { deleted } = await batchDeleteSelectionProducts(ids);
      toast(t('selectionAdmin.productsDeleted', { count: deleted }), 'success');
      setValueDeleteConfirmOpen(false);
      setValueProductsSelected(new Set());
      mutateProds();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, t('selectionAdmin.batchDeleteFailed')), 'error');
    } finally {
      setValueProductsBusy(false);
    }
  };
  const handleBatchDeleteProducts = async () => {
    const ids = Array.from(selectedProdIds);
    if (!ids.length || batchBusy) return;
    setBatchBusy(true);
    try {
      const { deleted } = await batchDeleteSelectionProducts(ids);
      toast(t('selectionAdmin.productsDeleted', { count: deleted }), 'success');
      setBatchDeleteConfirmOpen(false);
      setSelectedProdIds(new Set());
      mutateProds();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, t('selectionAdmin.batchDeleteFailed')), 'error');
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
      toast(t('selectionAdmin.onlyImageOrPdf'), 'error');
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
      const parts = [
        imageCount ? t('selectionAdmin.nImages', { count: imageCount }) : '',
        pdfCount ? t('selectionAdmin.nPdfs', { count: pdfCount }) : '',
      ].filter(Boolean);
      toast(t('selectionAdmin.assetsUploaded', { parts: parts.join('、') }), 'success');
    } catch (err) {
      toast(getApiErrorMessage(err, t('selectionAdmin.uploadFailed')), 'error');
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
        toast(t('selectionAdmin.pdfLinkPasted'), 'success');
      } else if (/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(text)) {
        e.preventDefault();
        toast(t('selectionAdmin.downloadingImage'), 'info');
        try {
          const { url } = await uploadOptionImageFromUrl(text);
          setProdForm((prev) => ({ ...prev, image: url }));
          toast(t('selectionAdmin.imageDownloadedSaved'), 'success');
        } catch {
          setProdForm((prev) => ({ ...prev, image: text }));
          toast(t('selectionAdmin.imageLinkPasteFallback'), 'error');
        }
      }
    }
  }
  async function handleBatchImport() {
    if (!batchParsed || batchParsed.length === 0) return;
    setBatchImporting(true);
    try {
      const { created, updated } = await batchImportProducts(selectedCatId, batchParsed);
      const msg =
        updated > 0
          ? t('selectionAdmin.importDoneCreated', { created, updated })
          : t('selectionAdmin.importSuccess', { count: created });
      toast(msg, 'success');
      setShowBatchModal(false);
      setBatchParsed(null);
      setBatchErrors([]);
      mutateProds();
      mutateCats();
    } catch (err: unknown) {
      toast(getApiErrorMessage(err, t('selectionAdmin.importFailed')), 'error');
    } finally {
      setBatchImporting(false);
    }
  }

  /* 子零件导入：读取 .xlsx / .csv 表格 → 制表符文本，交给 parseKitComponentLines（表头驱动解析） */
  async function handleKitImportFile(file: File) {
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error(t('selectionAdmin.kitFileTooLarge', { size: 5 }));
      const lowerName = file.name.toLowerCase();
      let rows: unknown[][];
      if (lowerName.endsWith('.csv')) {
        rows = parseCsvRows(await file.text());
      } else if (lowerName.endsWith('.xlsx')) {
        const { readSheet } = await import('read-excel-file/browser');
        rows = (await readSheet(file)) as unknown[][];
      } else {
        throw new Error(t('selectionAdmin.onlyXlsxCsv'));
      }
      const lines = rows
        .map((row) => row.map((cell) => normalizeImportCell(cell)))
        .filter((cells) => cells.some(Boolean))
        .map((cells) => cells.join('\t'));
      if (lines.length === 0) throw new Error(t('selectionAdmin.noDataInFile'));
      setKitImportText(lines.join('\n'));
      toast(t('selectionAdmin.fileParsedToast', { name: file.name }), 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : t('selectionAdmin.kitParseFailed'), 'error');
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
    toast(t('selectionAdmin.kitTemplateDownloaded'), 'success');
  }

  function handleExcelFile(file: File) {
    setBatchErrors([]);
    setBatchParsed(null);
    void (async () => {
      try {
        const rows = await readProductImportRows(file, uploadPolicy);
        if (rows.length === 0) {
          setBatchErrors([t('selectionAdmin.noDataInFile')]);
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
            rawName ||
              modelNo ||
              Object.values(specs).find(Boolean) ||
              t('selectionAdmin.fallbackName', { index: i + 1 }),
            modelNo,
          );
          if (!modelNo) {
            errors.push(t('selectionAdmin.rowMissingModel', { row: i + 2 }));
          } else if (seenModelNos.has(modelNo)) {
            errors.push(t('selectionAdmin.rowDuplicateModel', { row: i + 2, model: modelNo }));
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
              errors.push(t('selectionAdmin.rowBadJson', { row: i + 2 }));
            }
          }

          parsed.push(product);
        });

        if (errors.length > 0) setBatchErrors(errors);
        setBatchParsed(parsed);
      } catch (err) {
        setBatchErrors([err instanceof Error ? err.message : t('selectionAdmin.kitParseFailed')]);
      }
    })();
  }

  async function downloadProductImportTemplate() {
    if (!activeCat) {
      toast(t('selectionAdmin.pleaseSelectCategory'), 'error');
      return;
    }
    const { default: writeXlsxFile } = await import('write-excel-file/browser');
    const headers = productImportHeaders(productColumns);
    const rows: SheetData = [headers.map((header) => ({ value: header, fontWeight: 'bold' as const }))];
    await writeXlsxFile(rows, { sheet: '产品导入模板' }).toFile(`${activeCat.slug || 'products'}_import_template.xlsx`);
    toast(t('selectionAdmin.templateDownloaded'), 'success');
  }

  async function exportCurrentProducts() {
    if (!activeCat) {
      toast(t('selectionAdmin.pleaseSelectCategory'), 'error');
      return;
    }
    if (!products.length) {
      toast(t('selectionAdmin.noExportableProducts'), 'error');
      return;
    }
    // 列表数据不含子零件清单（体积优化），导出需要「组件(JSON)」列，单独拉一次全量
    let exportItems = products;
    try {
      toast(t('selectionAdmin.preparingExport'), 'info');
      const full = await getSelectionProducts(activeCat.slug, 1, 5000, '', {
        includeHidden: true,
        includeComponents: true,
      });
      if (full.items.length) exportItems = full.items;
    } catch {
      toast(t('selectionAdmin.fullFetchFailed'), 'error');
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
    toast(t('selectionAdmin.exportedProducts', { count: exportItems.length }), 'success');
  }

  // ---- Option Image handlers ----
  const optImages = (activeCat?.optionImages ?? {}) as Record<string, Record<string, string>>;
  const optCatalogs = (activeCat?.optionCatalogs ?? {}) as Record<string, Record<string, OptionCatalogEntry>>;

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
  // 选项值卡片跟随产品数据自动同步：反查弹窗里批量修改/新增/删除产品（或改了某个产品的参数值）后，
  // 卡片列表即时增删——角标计数本来就实时，这里同步的是卡片本身，不必退出选项设置再重新进入。
  // 增量合并：以当前列表为基准，保留未保存的手动排序，只剔除已无产品使用的值、追加新出现的值。
  useEffect(() => {
    if (!optImgField) return;
    const vals = new Set(fieldOptions[optImgField] || []);
    const savedOrderRaw = (activeCat?.optionOrder as Record<string, string[] | string> | undefined)?.[optImgField];
    const savedOrder = Array.isArray(savedOrderRaw) ? savedOrderRaw : [];
    setOrderItems((prev) => {
      // 基准：已有列表（保留手动/智能排序）；尚未初始化时（如选字段时产品还没加载完）按已保存顺序兜底
      const base = prev.length
        ? prev
        : [...savedOrder.filter((v) => vals.has(v)), ...Array.from(vals).filter((v) => !savedOrder.includes(v))];
      const kept = base.filter((v) => vals.has(v));
      const added = Array.from(vals).filter((v) => !base.includes(v));
      if (kept.length === base.length && added.length === 0) return prev;
      return [...kept, ...added];
    });
  }, [optImgField, fieldOptions, activeCat?.optionOrder]);
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
      toast(t('selectionAdmin.pleaseSelectCategory'), 'error');
      return;
    }
    const selectableColumns = selectableProductColumns;
    if (!selectableColumns.length) {
      toast(t('selectionAdmin.noSelectableColumns'), 'error');
      return;
    }
    resetGenerateFormForCategory(activeCat, products);
    setShowGenerateModal(true);
  }

  function refreshGeneratePreview() {
    const selectableColumns = selectableGenerateColumns;
    const errors: string[] = [];
    if (!generateCat) errors.push(t('selectionAdmin.pleaseSelectCategory'));
    if (!selectableColumns.length) errors.push(t('selectionAdmin.noSelectableColumns'));
    selectableColumns.forEach((col) => {
      if (parseGenerateEntries(generateOptionTexts[col.key] || '').length === 0) {
        errors.push(t('selectionAdmin.columnMissingOptions', { field: col.label || col.key }));
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

    if (preview.length >= 10000) errors.push(t('selectionAdmin.combosTruncated'));
    if (!preview.length && errors.length === 0) errors.push(t('selectionAdmin.allExcluded'));
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
      toast(t('selectionAdmin.pleaseSelectCategory'), 'error');
      return;
    }
    setGenerateImporting(true);
    try {
      const { created, updated } = await batchImportProducts(selectedCatId, generatePreview);
      const msg =
        updated > 0
          ? t('selectionAdmin.generateImportDone', { created, updated })
          : t('selectionAdmin.generateImportSuccess', { count: created });
      toast(msg, 'success');
      setShowGenerateModal(false);
      setGeneratePreview([]);
      mutateProds();
      mutateCats();
    } catch (err) {
      toast(getApiErrorMessage(err, t('selectionAdmin.generateImportFailed')), 'error');
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
      toast(t('selectionAdmin.imageUploaded'), 'success');
    } catch (err) {
      // 带服务端原因（如「图片不能超过 5MB」），失败不改动现有数据
      toast(getApiErrorMessage(err, t('selectionAdmin.uploadFailed')), 'error');
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
        if (zone === 'image') toast(t('selectionAdmin.pdfUploadedToCatalog'), 'info');
      } catch (err) {
        toast(getApiErrorMessage(err, t('selectionAdmin.uploadPdfFailed')), 'error');
      }
      return;
    }
    const imageFile = pastedFiles.find((f) => f.type.startsWith('image/'));
    if (imageFile) {
      e.preventDefault();
      if (zone === 'catalog') {
        try {
          await uploadOptCatalog(optImgField, targetVal, imageFile);
        } catch (err) {
          toast(getApiErrorMessage(err, t('selectionAdmin.uploadCatalogFailed')), 'error');
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
          } catch (err) {
            toast(getApiErrorMessage(err, t('selectionAdmin.uploadCatalogFailed')), 'error');
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
            [optImgField]: {
              ...(optCatalogs[optImgField] || {}),
              [targetVal]: { url: text, updatedAt: new Date().toISOString() },
            },
          };
          await updateCategory(activeCat!.id, { optionCatalogs: updated });
          mutateCats();
          toast(t('selectionAdmin.catalogLinkSaved'), 'success');
        } catch {
          toast(t('selectionAdmin.saveFailed'), 'error');
        }
        return;
      }
      toast(t('selectionAdmin.downloadingImage'), 'info');
      try {
        const { url } = await uploadOptionImageFromUrl(text);
        const updated = {
          ...optImages,
          [optImgField]: { ...(optImages[optImgField] || {}), [targetVal]: url },
        };
        await updateCategory(activeCat!.id, { optionImages: updated });
        mutateCats();
        toast(t('selectionAdmin.imageDownloadedSaved'), 'success');
      } catch {
        toast(t('selectionAdmin.downloadImageCheckUrl'), 'error');
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
    toast(t('selectionAdmin.imageRemoved'), 'success');
  }

  async function uploadOptCatalog(field: string, val: string, file: File) {
    if (!activeCat) return;
    // 画册走 product-asset 端点（接受图片和 PDF）；option-image 端点只收图片，传 PDF 会 400
    const { url } = await uploadSelectionProductAsset(file);
    // 新 shape 带上传时间：管理端卡片/弹窗展示「何时上传/更换」（旧数据是纯 URL 字符串）
    const updated = {
      ...optCatalogs,
      [field]: { ...(optCatalogs[field] || {}), [val]: { url, updatedAt: new Date().toISOString() } },
    };
    await updateCategory(activeCat.id, { optionCatalogs: updated });
    mutateCats();
    toast(t('selectionAdmin.catalogUploaded'), 'success');
  }

  async function removeOptCatalog(field: string, val: string) {
    const updated = { ...optCatalogs };
    if (updated[field]) {
      delete updated[field][val];
      if (Object.keys(updated[field]).length === 0) delete updated[field];
    }
    await updateCategory(activeCat!.id, { optionCatalogs: updated });
    mutateCats();
    toast(t('selectionAdmin.catalogRemoved'), 'success');
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
      title={t('selectionAdmin.pageTitle')}
      description={t('selectionAdmin.pageDescription')}
      actions={
        <div className="hidden items-center gap-2 md:flex">
          <button onClick={openNewProd} disabled={noProductCat} className={SELECTION_TOOLBAR_BUTTON_PRIMARY}>
            <SelectionToolbarButtonContent icon="add">{t('selectionAdmin.newProduct')}</SelectionToolbarButtonContent>
          </button>
          <ToolbarMoreMenu
            items={[
              {
                label: t('selectionAdmin.batchImport'),
                icon: 'upload',
                disabled: noProductCat,
                action: () => {
                  setBatchParsed(null);
                  setBatchErrors([]);
                  setShowBatchModal(true);
                },
              },
              {
                label: t('selectionAdmin.batchGenerate'),
                icon: 'auto_awesome',
                disabled: noProductCat,
                action: openGenerateProducts,
              },
              {
                label: t('selectionAdmin.exportProducts'),
                icon: 'download',
                disabled: noProductCat,
                action: exportCurrentProducts,
              },
              {
                label: t('selectionAdmin.exportPackage'),
                icon: 'inventory_2',
                action: () => setShowTransferExport(true),
              },
              { label: t('selectionAdmin.importPackage'), icon: 'archive', action: () => setShowTransferImport(true) },
              {
                label: t('selectionAdmin.optionSettings'),
                icon: 'settings',
                disabled: noProductCat,
                action: () => {
                  setOptImgField('');
                  setOptSettingsSearch('');
                  setOrderItems([]);
                  setShowOptImgModal(true);
                },
              },
              { label: t('selectionAdmin.newCategory'), icon: 'add', action: openNewCat },
              { label: t('selectionAdmin.groupManagement'), icon: 'folder', action: openGroupManager },
              {
                label: t('selectionAdmin.sortMenu'),
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
                { value: 'categories', label: t('selectionAdmin.tabCategories'), count: totalCats, icon: 'category' },
                {
                  value: 'products',
                  label: t('selectionAdmin.tabProducts'),
                  count: totalProducts,
                  icon: 'inventory_2',
                },
              ]}
              value={tab}
              onChange={(next) => {
                setTab(next as Tab);
                setCatFilter('all');
              }}
              mobileTitle={t('selectionAdmin.pageTitle')}
            />
          </div>
          <div className="grid min-w-0 grid-cols-4 items-center gap-1.5 overflow-visible md:hidden">
            <button onClick={openNewProd} disabled={noProductCat} className={SELECTION_TOOLBAR_BUTTON_PRIMARY}>
              <SelectionToolbarButtonContent icon="add">{t('selectionAdmin.newProduct')}</SelectionToolbarButtonContent>
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
              <SelectionToolbarButtonContent icon="upload">
                {t('selectionAdmin.batchImport')}
              </SelectionToolbarButtonContent>
            </button>
            <button
              onClick={openGenerateProducts}
              disabled={noProductCat}
              className={SELECTION_TOOLBAR_BUTTON_SECONDARY}
            >
              <SelectionToolbarButtonContent icon="auto_awesome">
                {t('selectionAdmin.batchGenerate')}
              </SelectionToolbarButtonContent>
            </button>
            <button
              disabled={noProductCat}
              onClick={exportCurrentProducts}
              className={SELECTION_TOOLBAR_BUTTON_SECONDARY}
            >
              <SelectionToolbarButtonContent icon="download">
                {t('selectionAdmin.exportProducts')}
              </SelectionToolbarButtonContent>
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
              <SelectionToolbarButtonContent icon="settings">
                {t('selectionAdmin.optionSettings')}
              </SelectionToolbarButtonContent>
            </button>
            <button onClick={openNewCat} className={SELECTION_TOOLBAR_BUTTON_SECONDARY}>
              <SelectionToolbarButtonContent icon="add">
                {t('selectionAdmin.newCategory')}
              </SelectionToolbarButtonContent>
            </button>
            <button onClick={openGroupManager} className={SELECTION_TOOLBAR_BUTTON_SECONDARY}>
              <SelectionToolbarButtonContent icon="folder">
                {t('selectionAdmin.groupManagement')}
              </SelectionToolbarButtonContent>
            </button>
            <button
              onClick={() => {
                setCatSortItems(categories.map((c) => ({ id: c.id, name: c.name })));
                setShowCatSortModal(true);
              }}
              className={SELECTION_TOOLBAR_BUTTON_SECONDARY}
            >
              <SelectionToolbarButtonContent icon="view_list">
                {t('selectionAdmin.sortMenu')}
              </SelectionToolbarButtonContent>
            </button>
            <button onClick={() => setShowTransferExport(true)} className={SELECTION_TOOLBAR_BUTTON_SECONDARY}>
              <SelectionToolbarButtonContent icon="inventory_2">
                {t('selectionAdmin.exportPackage')}
              </SelectionToolbarButtonContent>
            </button>
            <button onClick={() => setShowTransferImport(true)} className={SELECTION_TOOLBAR_BUTTON_SECONDARY}>
              <SelectionToolbarButtonContent icon="archive">
                {t('selectionAdmin.importPackage')}
              </SelectionToolbarButtonContent>
            </button>
          </div>
          <SearchField
            inputProps={tab === 'categories' ? catSearchInputProps : prodSearchInputProps}
            value={tab === 'categories' ? catSearchInputValue : prodSearchInputValue}
            onClear={() => (tab === 'categories' ? setCatSearch('') : setProdSearch(''))}
            placeholder={
              tab === 'categories'
                ? t('selectionAdmin.searchCategoryPlaceholder')
                : t('selectionAdmin.searchProductPlaceholder')
            }
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
              <span className="text-xs text-on-surface">{t('selectionAdmin.emptyFilterNotice')}</span>
              <button
                onClick={() => setCatFilter('all')}
                className="text-xs text-primary-container hover:underline ml-auto shrink-0"
              >
                {t('selectionAdmin.showAll')}
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
                    {catSearch
                      ? t('selectionAdmin.noMatchCategory')
                      : catFilter === 'empty'
                        ? t('selectionAdmin.noEmptyCategory')
                        : t('selectionAdmin.noCategories')}
                  </p>
                </div>
              );
            return (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low">
                <AdminGridHeader columns={SELECTION_CATEGORY_GRID_COLUMNS} className="gap-3 px-4">
                  <span>{t('selectionAdmin.colCategoryName')}</span>
                  <span>{t('selectionAdmin.colGroup')}</span>
                  <span className="text-center">{t('selectionAdmin.colParamColumns')}</span>
                  <span className="text-center">{t('selectionAdmin.colProductCount')}</span>
                  <span>{t('selectionAdmin.colSort')}</span>
                  <span className="text-right">{t('selectionAdmin.colActions')}</span>
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
                                  {t('selectionAdmin.hiddenBadge')}
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
                          <span>{cat.groupName || t('selectionAdmin.ungrouped')}</span>
                          <span>
                            {t('selectionAdmin.nParamColumns', { count: (cat.columns as ColumnDef[]).length })}
                          </span>
                          <span>{t('selectionAdmin.nProducts', { count: cat.productCount ?? 0 })}</span>
                          <span>{t('selectionAdmin.sortOrderLabel', { order: cat.sortOrder })}</span>
                        </div>
                      </div>
                      <span className={`hidden min-w-0 md:block ${ADMIN_ROW_META_CLASS}`}>
                        {cat.groupName || t('selectionAdmin.ungrouped')}
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
                          aria-label={
                            cat.hidden ? t('selectionAdmin.restoreCategory') : t('selectionAdmin.hideCategory')
                          }
                        >
                          <Icon name={cat.hidden ? 'visibility_off' : 'visibility'} size={14} />
                        </button>
                        <button
                          onClick={() => openEditCat(cat)}
                          className={SELECTION_ICON_BUTTON_EDIT}
                          data-tooltip-ignore
                          aria-label={t('selectionAdmin.editCategory')}
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        {deleteCatId === cat.id ? (
                          <>
                            <button
                              onClick={() => handleDeleteCat(cat.id)}
                              className="h-8 px-2 text-xs font-medium text-error hover:underline md:text-[10px]"
                            >
                              {t('selectionAdmin.confirmDelete')}
                            </button>
                            <button
                              onClick={() => setDeleteCatId(null)}
                              className="h-8 px-2 text-xs text-on-surface-variant hover:text-on-surface md:text-[10px]"
                            >
                              {t('common.cancel')}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setDeleteCatId(cat.id)}
                            className={SELECTION_ICON_BUTTON_DELETE}
                            data-tooltip-ignore
                            aria-label={t('selectionAdmin.deleteCategory')}
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
                        {activeCat?.name || t('selectionAdmin.selectCategoryPrompt')}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-on-surface-variant">
                        {activeCat
                          ? t('selectionAdmin.selectedCategoryMeta', {
                              slug: activeCat.slug,
                              count: activeCat.productCount ?? products.length,
                            })
                          : t('selectionAdmin.selectCategoryHint')}
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
                          placeholder={t('selectionAdmin.searchCategoryPlaceholder')}
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
                          <div className="px-3 py-8 text-center text-xs text-on-surface-variant">
                            {t('selectionAdmin.noMatchCategory')}
                          </div>
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
                <span>{t('selectionAdmin.nProducts', { count: activeCat.productCount ?? products.length })}</span>
                <span>{t('selectionAdmin.nParamColumns', { count: productColumns.length })}</span>
                {activeCat.groupName && <span>{activeCat.groupName}</span>}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-on-surface-variant">{t('selectionAdmin.selectCategoryHintFull')}</p>
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
                  <p className="text-sm">{t('selectionAdmin.noProducts')}</p>
                </div>
              ) : (
                <>
                  {prodSearch && (
                    <p className="text-xs text-on-surface-variant">
                      {t('selectionAdmin.searchMatch', {
                        query: prodSearch,
                        matched: filteredProducts.length,
                        total: products.length,
                      })}{' '}
                      <span className="text-on-surface font-medium">{prodSearch}</span>
                    </p>
                  )}
                  {selectedProdIds.size > 0 && (
                    <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-primary-container/25 bg-primary-container/5 px-3 py-2">
                      <span className="text-xs font-medium text-on-surface">
                        {t('selectionAdmin.selectedCount', { count: selectedProdIds.size })}
                      </span>
                      <span className="mx-0.5 h-4 w-px bg-outline-variant/25" />
                      <button
                        type="button"
                        disabled={batchBusy}
                        onClick={() => void handleBatchUpdateHidden(true)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
                      >
                        <Icon name="visibility_off" size={13} />
                        {t('selectionAdmin.batchHide')}
                      </button>
                      <button
                        type="button"
                        disabled={batchBusy}
                        onClick={() => void handleBatchUpdateHidden(false)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
                      >
                        <Icon name="visibility" size={13} />
                        {t('selectionAdmin.batchShow')}
                      </button>
                      <button
                        type="button"
                        disabled={batchBusy}
                        onClick={() => setBatchDeleteConfirmOpen(true)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-error transition-colors hover:bg-error/10 disabled:opacity-40"
                      >
                        <Icon name="delete" size={13} />
                        {t('selectionAdmin.batchDelete')}
                      </button>
                      <span className="flex-1" />
                      <button
                        type="button"
                        disabled={batchBusy}
                        onClick={clearProdSelection}
                        className="rounded-lg px-2 py-1 text-xs text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
                      >
                        {t('selectionAdmin.clearSelection')}
                      </button>
                    </div>
                  )}
                  {filteredProducts.length === 0 ? (
                    <div className="text-center py-12 text-on-surface-variant">
                      <Icon name="search_off" size={40} className="mx-auto mb-2 opacity-30" />
                      <p className="text-sm">{t('selectionAdmin.noMatchProducts')}</p>
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
                                  aria-label={t('selectionAdmin.selectAllResults')}
                                />
                              </AdminTableHeadCell>
                              <AdminTableHeadCell className="whitespace-nowrap px-3">
                                {t('selectionAdmin.colName')}
                              </AdminTableHeadCell>
                              {productColumns.map((col) => (
                                <AdminTableHeadCell key={col.key} className="whitespace-nowrap px-3">
                                  {col.label}
                                  {col.unit ? ` (${col.unit})` : ''}
                                </AdminTableHeadCell>
                              ))}
                              <AdminTableHeadCell className="px-3 text-right">
                                {t('selectionAdmin.colActions')}
                              </AdminTableHeadCell>
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
              <p className="text-sm">{t('selectionAdmin.pleaseSelectCategory')}</p>
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
                    toast(t('selectionAdmin.imagePasted'), 'success');
                  } catch {
                    toast(t('selectionAdmin.uploadFailed'), 'error');
                  }
                }
                return;
              }
            }
            // Check for URL text
            const text = e.clipboardData.getData('text/plain')?.trim();
            if (text && /^https?:\/\/.+/i.test(text)) {
              e.preventDefault();
              toast(t('selectionAdmin.downloadingImage'), 'info');
              try {
                const { url } = await uploadOptionImageFromUrl(text);
                setCatForm((prev) => ({ ...prev, image: url }));
                toast(t('selectionAdmin.imageDownloadedSaved'), 'success');
              } catch {
                toast(t('selectionAdmin.downloadImageFailed'), 'error');
              }
            }
          }}
        >
          <div
            className="fixed inset-0 flex min-h-0 flex-col bg-surface-container-low p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl sm:relative sm:inset-auto sm:w-[min(96vw,1280px)] sm:max-w-none sm:max-h-[90dvh] sm:rounded-xl sm:border sm:border-outline-variant/20 sm:p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex shrink-0 items-center justify-between gap-3 border-b border-outline-variant/10 pb-3 sm:mb-4 sm:border-b-0 sm:pb-0">
              <h2 className="text-base font-bold text-on-surface">
                {editCat ? t('selectionAdmin.editCategory') : t('selectionAdmin.newCategory')}
              </h2>
              <button
                onClick={() => setShowCatModal(false)}
                className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface sm:hidden"
                data-tooltip-ignore
                aria-label={t('common.close')}
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-0.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">
                    {t('selectionAdmin.labelNameRequired')}
                  </label>
                  <input
                    name="name"
                    value={catForm.name}
                    onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">{t('selectionAdmin.labelSlug')}</label>
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
                <label className="text-xs text-on-surface-variant mb-1 block">
                  {t('selectionAdmin.labelDescription')}
                </label>
                <input
                  name="description"
                  value={catForm.description}
                  onChange={(e) => setCatForm({ ...catForm, description: e.target.value })}
                  className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                />
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">
                  {t('selectionAdmin.labelKitListTitle')}
                </label>
                <input
                  name="kit-list-title"
                  value={catForm.kitListTitle}
                  onChange={(e) => setCatForm({ ...catForm, kitListTitle: e.target.value })}
                  placeholder={t('selectionAdmin.kitListTitlePlaceholder')}
                  className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                />
                <p className="mt-1 text-[10px] text-on-surface-variant">{t('selectionAdmin.kitListTitleHint')}</p>
              </div>
              <div>
                <label className="text-xs text-on-surface-variant mb-1 block">{t('selectionAdmin.labelGroup')}</label>
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
                      toast(t('selectionAdmin.groupRemoved'), 'success');
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
                      toast(t('selectionAdmin.groupSet'), 'success');
                      mutateCats();
                    }
                  }}
                  className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                >
                  <option value="">{t('selectionAdmin.noGroup')}</option>
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
                  <label className="text-xs text-on-surface-variant mb-1 block">
                    {t('selectionAdmin.labelIconName')}
                  </label>
                  <input
                    name="icon"
                    value={catForm.icon}
                    onChange={(e) => setCatForm({ ...catForm, icon: e.target.value })}
                    placeholder={t('selectionAdmin.iconPlaceholder')}
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">
                    {t('selectionAdmin.labelCoverImage')}
                  </label>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <input
                      name="image"
                      value={catForm.image}
                      onChange={(e) => setCatForm({ ...catForm, image: e.target.value })}
                      placeholder={t('selectionAdmin.urlOrUpload')}
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
                              toast(t('selectionAdmin.uploadFailed'), 'error');
                            }
                          }
                          e.target.value = '';
                        }}
                      />
                      <span className="px-2.5 py-2 text-xs text-primary-container hover:underline cursor-pointer border border-outline-variant/20 rounded">
                        {t('selectionAdmin.upload')}
                      </span>
                    </label>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-on-surface-variant">
                    {t('selectionAdmin.coverHint1')}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-relaxed text-on-surface-variant">
                    {t('selectionAdmin.coverHint2')}
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
                {t('common.cancel')}
              </button>
              <button
                onClick={saveCat}
                disabled={!catForm.name || !catForm.slug}
                className="px-4 py-2.5 sm:py-2 text-sm font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-50"
              >
                {t('common.save')}
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
            <h2 className="text-base font-bold text-on-surface shrink-0">
              {editProd ? t('selectionAdmin.editProduct') : t('selectionAdmin.newProduct')}
            </h2>
            <div className="space-y-3 flex-1 min-h-0 overflow-y-auto pr-0.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">
                    {t('selectionAdmin.labelNameRequired')}
                  </label>
                  <input
                    name="name"
                    value={prodForm.name}
                    onChange={(e) => setProdForm({ ...prodForm, name: e.target.value })}
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">
                    {t('selectionAdmin.labelModelNo')}
                  </label>
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
                  <label className="text-xs text-on-surface-variant mb-1 block">
                    {t('selectionAdmin.labelImageUrl')}
                  </label>
                  <input
                    name="image"
                    value={prodForm.image}
                    onChange={(e) => setProdForm({ ...prodForm, image: e.target.value })}
                    placeholder="https://..."
                    className="w-full bg-surface-container-lowest text-on-surface text-sm rounded px-3 py-2 border border-outline-variant/20 outline-none focus:border-primary-container"
                  />
                </div>
                <div>
                  <label className="text-xs text-on-surface-variant mb-1 block">
                    {t('selectionAdmin.labelPdfUrl')}
                  </label>
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
                    <p className="text-sm font-bold text-on-surface">{t('selectionAdmin.dragAssetHere')}</p>
                    <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                      {t('selectionAdmin.assetHint')}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      {prodForm.image && (
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-container-lowest px-2 py-1 text-on-surface-variant">
                          <Icon name="image" size={13} />
                          <span className="truncate">{t('selectionAdmin.imageSet')}</span>
                        </span>
                      )}
                      {prodForm.pdfUrl && (
                        <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-container-lowest px-2 py-1 text-on-surface-variant">
                          <Icon name="picture_as_pdf" size={13} />
                          <span className="truncate">{t('selectionAdmin.pdfSet')}</span>
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
                        openDocumentUrl(prodForm.pdfUrl, { title: t('selectionAdmin.pdfSpecTitle') });
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
                    <p className="text-sm text-on-surface">{t('selectionAdmin.kitToggle')}</p>
                    <p className="text-xs text-on-surface-variant">{t('selectionAdmin.kitToggleHint')}</p>
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
                      <span className="text-xs font-bold text-on-surface-variant">
                        {t('selectionAdmin.componentList')}
                      </span>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setKitImportText('');
                            setKitImportOpen(true);
                          }}
                          className="text-xs text-primary-container hover:underline"
                        >
                          {t('selectionAdmin.batchImport')}
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
                          {t('selectionAdmin.addComponent')}
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
                              placeholder={t('selectionAdmin.compNamePlaceholder')}
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
                              placeholder={t('selectionAdmin.colModel')}
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
                              placeholder={t('selectionAdmin.compQtyPlaceholder')}
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
                {t('common.cancel')}
              </button>
              <button
                onClick={saveProd}
                disabled={!prodForm.name}
                className="px-4 py-2.5 sm:py-2 text-sm font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-50"
              >
                {t('common.save')}
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
              <h2 className="text-base font-bold text-on-surface">{t('selectionAdmin.kitImportTitle')}</h2>
              <p className="mt-1 text-xs text-on-surface-variant leading-relaxed">
                {t('selectionAdmin.kitImportDescLine1')}
                <br />
                <span className="font-bold text-on-surface">{t('selectionAdmin.kitImportDescHeaderTitle')}</span>
                {t('selectionAdmin.kitImportDescHeader')}
                <br />
                {t('selectionAdmin.kitImportDescNoHeader')}
              </p>
            </div>
            <div className="shrink-0 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void downloadKitImportTemplate()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg"
              >
                <Icon name="download" size={13} />
                {t('selectionAdmin.downloadTemplateXlsx')}
              </button>
              <label className="inline-flex cursor-pointer items-center gap-1 px-2.5 py-1.5 text-xs text-on-surface-variant bg-surface-container-high/40 hover:bg-surface-container-high rounded-lg">
                <Icon name="upload_file" size={13} />
                {t('selectionAdmin.importSpreadsheet')}
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
                      {t('selectionAdmin.parsedComponentsPrefix')}
                      <span className="font-bold text-on-surface">{items.length}</span>
                      {t('selectionAdmin.parsedComponentsSuffix')}
                      {items.length <= 5 ? (
                        <span className="text-on-surface-variant/70">
                          （{items.map((c) => `${c.modelNo || c.name}×${c.qty}`).join('、')}）
                        </span>
                      ) : null}
                    </p>
                  )}
                  {badLines.length > 0 && (
                    <p className="text-error/80">
                      {t('selectionAdmin.badLinesWarning', { lines: badLines.join('、') })}
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
                {t('common.cancel')}
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
                  {t('selectionAdmin.replaceList')}
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
                {t('selectionAdmin.appendImport')}
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
            className="fixed left-3 right-3 top-[max(1rem,env(safe-area-inset-top))] bottom-[max(1rem,env(safe-area-inset-bottom))] max-w-none bg-surface-container-low rounded-2xl border border-outline-variant/20 p-3 space-y-3 flex min-h-0 flex-col overflow-hidden shadow-2xl sm:relative sm:inset-auto sm:w-full sm:max-w-3xl sm:max-h-[90dvh] sm:p-5 sm:space-y-4 sm:rounded-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 shrink-0 pb-2 border-b border-outline-variant/10 sm:pb-0 sm:border-b-0">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-on-surface leading-snug">
                  {t('selectionAdmin.optionSettings')}
                </h2>
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
              {t('selectionAdmin.optionSettingsHint')}
            </p>

            {/* Field selector + view toggle；搜索框独占下一行，输入搜索词后不再被计数徽章挤窄 */}
            <div className="grid grid-cols-1 gap-2 shrink-0 pb-2 border-b border-outline-variant/10 sm:pb-0 sm:border-b-0">
              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
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
                      {optImgField
                        ? t('selectionAdmin.fieldWithOptions', {
                            field: optImgField,
                            count: fieldOptions[optImgField]?.length ?? 0,
                          })
                        : t('selectionAdmin.selectField')}
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
                        <span>{t('selectionAdmin.selectField')}</span>
                        <span className="text-[10px] text-on-surface-variant/60">
                          {t('selectionAdmin.nFields', { count: Object.keys(fieldOptions).length })}
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
                            {t('selectionAdmin.nItems', { count: fieldOptions[f].length })}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {optImgField && (
                  <div className="grid grid-cols-2 rounded-md border border-outline-variant/20 overflow-hidden shrink-0 sm:flex">
                    <button
                      onClick={() => setOptViewMode('grid')}
                      className={`px-3 py-2 text-xs flex items-center justify-center gap-1 transition-colors ${optViewMode === 'grid' ? 'bg-primary-container text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high'}`}
                    >
                      <Icon name="grid_view" size={14} /> {t('selectionAdmin.viewCards')}
                    </button>
                    <button
                      onClick={() => setOptViewMode('list')}
                      className={`px-3 py-2 text-xs flex items-center justify-center gap-1 transition-colors ${optViewMode === 'list' ? 'bg-primary-container text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-high'}`}
                    >
                      <Icon name="view_list" size={14} /> {t('selectionAdmin.viewList')}
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
                    <Icon name="sort" size={13} className="mr-0.5" /> {t('selectionAdmin.smartSort')}
                  </button>
                )}
              </div>
              {optImgField && (
                <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                  <SearchField
                    inputProps={optSettingsSearchInputProps}
                    value={optSettingsSearchInputValue}
                    onClear={() => setOptSettingsSearch('')}
                    placeholder={t('selectionAdmin.searchOptionsPlaceholder')}
                    className="w-full sm:flex-1"
                  />
                  {optSettingsSearch && (
                    <span className="shrink-0 text-[11px] text-on-surface-variant">
                      {t('selectionAdmin.filteredOptionsCount', {
                        shown: filteredOrderItems.length,
                        total: orderItems.length,
                      })}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto min-h-0 pr-0.5 pb-2">
              {!optImgField || orderItems.length === 0 ? (
                <div className="min-h-full grid place-items-center rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-lowest/60 px-4 py-8 text-center">
                  <div className="space-y-2">
                    <Icon name="tune" size={28} className="mx-auto text-on-surface-variant/40" />
                    <p className="text-sm font-medium text-on-surface">{t('selectionAdmin.pickFieldPrompt')}</p>
                    <p className="text-xs leading-relaxed text-on-surface-variant">
                      {t('selectionAdmin.pickFieldHint')}
                    </p>
                  </div>
                </div>
              ) : filteredOrderItems.length === 0 ? (
                <div className="min-h-full grid place-items-center rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-lowest/60 px-4 py-8 text-center">
                  <div className="space-y-2">
                    <Icon name="search_off" size={28} className="mx-auto text-on-surface-variant/40" />
                    <p className="text-sm font-medium text-on-surface">{t('selectionAdmin.noMatchOptions')}</p>
                    <p className="text-xs leading-relaxed text-on-surface-variant">
                      {t('selectionAdmin.noMatchOptionsHint')}
                    </p>
                  </div>
                </div>
              ) : optViewMode === 'grid' ? (
                /* ===== Card Grid View (for images) ===== */
                <div className="grid grid-cols-1 min-[430px]:grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-3">
                  {visibleOrderItems.map((val) => {
                    const i = orderItems.indexOf(val);
                    const imgUrl = optImages[optImgField]?.[val];
                    const catalogEntry = optCatalogs[optImgField]?.[val];
                    const catalogUrl = optionCatalogUrl(catalogEntry);
                    const catalogUpdatedAt = optionCatalogUpdatedAt(catalogEntry);
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
                          {/* 画册状态：有画册 → 拖拽手柄着主题色；没有 → 默认弱化色。悬停手柄看更新时间 */}
                          <span
                            title={
                              catalogUrl
                                ? catalogUpdatedAt
                                  ? `${t('selectionAdmin.catalogBadgeHint')} · ${t('selectionAdmin.catalogUpdatedAt', {
                                      time: new Date(catalogUpdatedAt).toLocaleString(),
                                    })}`
                                  : t('selectionAdmin.catalogBadgeHint')
                                : undefined
                            }
                            className={`select-none text-xs shrink-0 ${
                              catalogUrl ? 'text-primary-container' : 'text-on-surface-variant/40'
                            }`}
                          >
                            ⠿
                          </span>
                          <span className="text-xs font-medium text-on-surface break-words line-clamp-2 flex-1 min-w-0">
                            {val}
                          </span>
                          <button
                            onClick={() => setValueProductsView({ field: optImgField, value: val })}
                            title={t('selectionAdmin.viewValueProducts')}
                            className={`shrink-0 rounded-full bg-surface-container-high px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors hover:bg-primary-container/15 hover:text-primary-container ${
                              valueProductCount === 0 ? 'text-on-surface-variant/50' : 'text-on-surface-variant'
                            }`}
                          >
                            {t('selectionAdmin.nModels', { count: valueProductCount })}
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
                          {imgUrl ? t('selectionAdmin.clickOrPasteReplace') : t('selectionAdmin.clickOrPasteUpload')}
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
                    const catalogEntry = optCatalogs[optImgField]?.[val];
                    const catalogUrl = optionCatalogUrl(catalogEntry);
                    const catalogUpdatedAt = optionCatalogUpdatedAt(catalogEntry);
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
                        {/* 画册状态同卡片网格视图：有画册 → 手柄主题色，悬停看更新时间 */}
                        <span
                          title={
                            catalogUrl
                              ? catalogUpdatedAt
                                ? `${t('selectionAdmin.catalogBadgeHint')} · ${t('selectionAdmin.catalogUpdatedAt', {
                                    time: new Date(catalogUpdatedAt).toLocaleString(),
                                  })}`
                                : t('selectionAdmin.catalogBadgeHint')
                              : undefined
                          }
                          className={`cursor-grab active:cursor-grabbing select-none text-sm shrink-0 ${
                            catalogUrl ? 'text-primary-container' : 'text-on-surface-variant/40'
                          }`}
                        >
                          ⠿
                        </span>
                        <span className="text-sm font-medium text-on-surface flex-1 min-w-0 break-words">{val}</span>
                        <button
                          onClick={() => setValueProductsView({ field: optImgField, value: val })}
                          title={t('selectionAdmin.viewValueProducts')}
                          className={`shrink-0 rounded-full bg-surface-container-high px-1.5 py-0.5 text-[10px] font-medium tabular-nums transition-colors hover:bg-primary-container/15 hover:text-primary-container ${
                            valueProductCount === 0 ? 'text-on-surface-variant/50' : 'text-on-surface-variant'
                          }`}
                        >
                          {t('selectionAdmin.nModels', { count: valueProductCount })}
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
                {t('common.close')}
              </button>
              <button
                onClick={async () => {
                  if (!optImgField || orderItems.length === 0) {
                    toast(t('selectionAdmin.pickFieldFirst'), 'error');
                    return;
                  }
                  try {
                    const currentOrder = (activeCat.optionOrder as Record<string, string[] | string>) || {};
                    await updateCategory(activeCat.id, {
                      optionOrder: { ...currentOrder, [optImgField]: orderItems },
                    });
                    toast(t('selectionAdmin.settingsSaved'), 'success');
                    mutateCats();
                  } catch (err) {
                    if (import.meta.env.DEV) console.error('保存设置失败:', err);
                    toast(t('selectionAdmin.saveFailed'), 'error');
                  }
                }}
                disabled={!optImgField || orderItems.length === 0}
                className="px-3 py-2.5 sm:py-2 text-xs font-bold bg-primary-container text-on-primary rounded-lg sm:rounded hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('selectionAdmin.saveSettings')}
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
        title={t('selectionAdmin.forceDeleteTitle')}
        description={t('selectionAdmin.forceDeleteDesc', {
          name: forceDeleteCat?.name || '',
          count: forceDeleteCat?.count ?? 0,
        })}
        confirmLabel={t('selectionAdmin.forceDeleteConfirm')}
      />

      {/* 批量删除产品确认 */}
      <ConfirmDialog
        open={batchDeleteConfirmOpen}
        onClose={() => {
          if (!batchBusy) setBatchDeleteConfirmOpen(false);
        }}
        onConfirm={() => void handleBatchDeleteProducts()}
        title={t('selectionAdmin.batchDeleteTitle')}
        description={t('selectionAdmin.batchDeleteDesc', { count: selectedProdIds.size })}
        confirmLabel={batchBusy ? t('selectionAdmin.deleting') : t('selectionAdmin.confirmDelete')}
        confirmDisabled={batchBusy}
      />

      {/* 选项值反查弹窗：批量删除勾选产品确认 */}
      <ConfirmDialog
        open={valueDeleteConfirmOpen}
        onClose={() => {
          if (!valueProductsBusy) setValueDeleteConfirmOpen(false);
        }}
        onConfirm={() => void handleValueProductsDelete()}
        title={t('selectionAdmin.deleteSelectedTitle')}
        description={t('selectionAdmin.batchDeleteDesc', { count: valueProductsSelected.size })}
        confirmLabel={valueProductsBusy ? t('selectionAdmin.deleting') : t('selectionAdmin.confirmDelete')}
        confirmDisabled={valueProductsBusy}
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
                } catch (err) {
                  toast(getApiErrorMessage(err, t('selectionAdmin.uploadPdfFailed')), 'error');
                }
                return;
              }
              if (file.type.startsWith('image/')) {
                await uploadOptImg(optImgField, editOptVal, file);
                return;
              }
            }
            toast(t('selectionAdmin.unsupportedFileType'), 'error');
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
                    <h3 className="text-sm font-bold leading-snug text-on-surface">
                      {t('selectionAdmin.optionValueSettings')}
                    </h3>
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
                  const optCatalogEntry = optCatalogs[optImgField]?.[editOptVal];
                  const catalogUrl = optionCatalogUrl(optCatalogEntry);
                  const catalogUpdatedAt = optionCatalogUpdatedAt(optCatalogEntry);
                  const isUploading = uploadingVal === `${optImgField}::${editOptVal}`;
                  return (
                    <>
                      <div className="min-h-0 overflow-y-auto">
                        <div className="flex flex-col gap-3.5">
                          {/* ❶ 选项图片：预览框即上传按钮（点击选文件），下方小文字操作 */}
                          <section className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <Icon name="photo_library" size={14} className="shrink-0 text-primary-container" />
                              <span className="text-xs font-bold text-on-surface">
                                {t('selectionAdmin.optionImage')}
                              </span>
                              <span className="truncate text-[10px] text-on-surface-variant">
                                {t('selectionAdmin.optionImageHint')}
                              </span>
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
                                    {t('selectionAdmin.clickReplaceImage')}
                                  </span>
                                </>
                              ) : (
                                <div className="flex flex-col items-center gap-2 text-on-surface-variant/40 transition-colors group-hover:text-on-surface-variant/70">
                                  <Icon name="add_photo_alternate" size={30} />
                                  <span className="text-xs">{t('selectionAdmin.clickPasteUploadImage')}</span>
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
                                  {t('selectionAdmin.removeImage')}
                                </button>
                              </div>
                            )}
                          </section>

                          {/* ❷ 画册资料：与选项图片同构 —— 标题行在外，上传框（虚线=可投放）为唯一带边框元素 */}
                          <section className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5">
                              <Icon name="menu_book" size={14} className="shrink-0 text-primary-container" />
                              <span className="shrink-0 text-xs font-bold text-on-surface">
                                {t('selectionAdmin.catalogSection')}
                              </span>
                              <span className="truncate text-[10px] text-on-surface-variant">
                                {t('selectionAdmin.imageOrPdf')}
                              </span>
                              <span className="flex-1" />
                              <button
                                type="button"
                                role="switch"
                                aria-checked={activeCat?.catalogShared ?? false}
                                aria-label={t('selectionAdmin.catalogSharedLabel')}
                                onClick={async () => {
                                  if (!activeCat) return;
                                  const next = !(activeCat.catalogShared ?? false);
                                  try {
                                    await updateCategory(activeCat.id, { catalogShared: next });
                                    mutateCats();
                                    toast(
                                      next ? t('selectionAdmin.catalogShareOn') : t('selectionAdmin.catalogShareOff'),
                                      'success',
                                    );
                                  } catch {
                                    toast(t('selectionAdmin.saveFailed'), 'error');
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
                                  } catch (err) {
                                    toast(getApiErrorMessage(err, t('selectionAdmin.uploadFailed')), 'error');
                                  }
                                } else {
                                  toast(t('selectionAdmin.catalogOnlyImagePdf'), 'error');
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
                                    } catch (err) {
                                      toast(getApiErrorMessage(err, t('selectionAdmin.uploadFailed')), 'error');
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
                                    <span className="min-w-0 flex-1 truncate text-xs text-on-surface-variant">
                                      {catalogUrl.split('/').pop()?.split('?')[0] || t('selectionAdmin.uploaded')}
                                    </span>
                                    {/* 上传/更新时间：旧数据（纯 URL 字符串）没有时间则不显示 */}
                                    {catalogUpdatedAt && (
                                      <span
                                        title={new Date(catalogUpdatedAt).toLocaleString()}
                                        className="shrink-0 text-[10px] tabular-nums text-on-surface-variant/60"
                                      >
                                        {t('selectionAdmin.catalogUpdatedAt', {
                                          time: new Date(catalogUpdatedAt).toLocaleString(),
                                        })}
                                      </span>
                                    )}
                                  </div>
                                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/45 py-1 text-center text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                                    {t('selectionAdmin.clickReplaceCatalog')}
                                  </span>
                                </>
                              ) : (
                                <div className="flex flex-col items-center gap-1 text-on-surface-variant/60 transition-colors group-hover:text-on-surface-variant">
                                  <Icon name="upload_file" size={22} />
                                  <span className="text-xs font-medium">{t('selectionAdmin.catalogUploadHint')}</span>
                                  <span className="text-[10px]">{t('selectionAdmin.catalogUploadSub')}</span>
                                </div>
                              )}
                            </label>
                            <div className="flex items-center justify-between gap-2">
                              <p className="min-w-0 truncate text-[10px] text-on-surface-variant">
                                {activeCat?.catalogShared
                                  ? t('selectionAdmin.catalogShareOnHint')
                                  : t('selectionAdmin.catalogShareOffHint')}
                              </p>
                              {catalogUrl && (
                                <div className="flex shrink-0 items-center gap-1">
                                  {isSafeUrl(catalogUrl) && (
                                    <button
                                      onClick={() => setOptCatalogZoom(true)}
                                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-primary-container transition-colors hover:bg-primary-container/10"
                                    >
                                      <Icon name="visibility" size={13} />
                                      {t('selectionAdmin.viewCatalog')}
                                    </button>
                                  )}
                                  <button
                                    onClick={() => removeOptCatalog(optImgField, editOptVal)}
                                    className="rounded px-1.5 py-0.5 text-xs text-error/70 transition-colors hover:bg-error/10 hover:text-error"
                                  >
                                    {t('selectionAdmin.removeCatalog')}
                                  </button>
                                </div>
                              )}
                            </div>
                          </section>
                        </div>
                      </div>
                      <p className="shrink-0 text-center text-[10px] leading-snug text-on-surface-variant/70">
                        {t('selectionAdmin.pasteZoneHint')}
                      </p>
                      {/* 画册查看弹窗：layer 压过选项弹窗的 330；关闭时只收弹窗、不退出选项编辑 */}
                      {optCatalogZoom && catalogUrl && isSafeUrl(catalogUrl) && (
                        <CatalogZoomModal
                          productTitle={`${activeCat?.name ?? ''} · ${editOptVal}`}
                          src={catalogUrl}
                          isImage={/\.(jpe?g|png|gif|webp|svg)(\?.*)?$/i.test(catalogUrl)}
                          onClose={() => setOptCatalogZoom(false)}
                          layer={360}
                        />
                      )}
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
            // specs['型号'] 是 modelNo 的镜像（批量导入会写入）：参数列跳过它，型号统一由专用列展示/编辑，
            // 否则表格会出现两列「型号」（保存时同步镜像，见 handleValueProductCreate/Save）
            const paramCols = activeCat.columns.filter((c) => c.key !== '型号');
            const matched =
              productsByOptionValue.get(`${valueProductsView.field}\u0000${valueProductsView.value}`) || [];
            const MAX_ROWS = 200;
            const rows = matched.slice(0, MAX_ROWS);
            // 勾选只统计当前选项值命中的行（防关闭后残留或跨值误删）
            const selectedInView = rows.filter((r) => valueProductsSelected.has(r.id));
            const allInViewSelected = rows.length > 0 && selectedInView.length === rows.length;
            // 新增草稿行内联输入框（型号/名称/各参数列共用）
            const draftInputClass =
              'h-7 w-full min-w-0 rounded border border-outline-variant/30 bg-surface-container-lowest px-1.5 text-xs text-on-surface outline-none transition-colors hover:border-outline-variant/50 focus:border-primary-container';
            const onDraftKey = (e: React.KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleValueProductCreate();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setValueProductsDraft(null);
              }
            };
            const onEditKey = (e: React.KeyboardEvent) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleValueProductSave();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setValueProductsEdit(null);
              }
            };
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
                          {t('selectionAdmin.nModelsFull', { count: matched.length })}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-on-surface-variant">
                        {t('selectionAdmin.valueProductsSubtitle')}
                        {matched.length > MAX_ROWS && t('selectionAdmin.onlyFirstRows', { count: MAX_ROWS })}
                        {matched.length === 0 && t('selectionAdmin.noProductsUseValue')}
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
                    ref={valueProductsScrollRef}
                    className="min-h-0 flex-1 overflow-auto custom-scrollbar"
                  >
                    <AdminTable>
                      <thead className={ADMIN_TABLE_HEAD_CLASS}>
                        <AdminTableHeadRow>
                          <AdminTableHeadCell className="w-12 px-3">
                            <input
                              type="checkbox"
                              checked={allInViewSelected}
                              onChange={() =>
                                setValueProductsSelected(allInViewSelected ? new Set() : new Set(rows.map((r) => r.id)))
                              }
                              disabled={rows.length === 0}
                              className="h-4 w-4 accent-primary-container"
                              aria-label={t('selectionAdmin.selectAllValueProducts')}
                              title={t('selectionAdmin.selectAllValueProductsTitle', { count: rows.length })}
                            />
                          </AdminTableHeadCell>
                          <AdminTableHeadCell className="whitespace-nowrap">
                            {t('selectionAdmin.colModel')}
                          </AdminTableHeadCell>
                          <AdminTableHeadCell className="whitespace-nowrap">
                            {t('selectionAdmin.colName')}
                          </AdminTableHeadCell>
                          {paramCols.map((col) => (
                            <AdminTableHeadCell
                              key={col.key}
                              className={`whitespace-nowrap ${col.key === valueProductsView.field ? 'text-primary-container' : ''}`}
                            >
                              {col.label}
                              {col.unit ? ` (${col.unit})` : ''}
                            </AdminTableHeadCell>
                          ))}
                          {/* 操作列 sticky 右侧固定：宽表横向滚动时 ✓/✗/编辑按钮始终可见 */}
                          <AdminTableHeadCell className="sticky right-0 w-24 border-l border-outline-variant/12">
                            <div className="text-center">{t('selectionAdmin.colActions')}</div>
                          </AdminTableHeadCell>
                        </AdminTableHeadRow>
                      </thead>
                      <tbody>
                        {/* 新增产品草稿行：默认带首行（上一行）数据，改完 ✓ 或回车创建，Esc 取消 */}
                        {valueProductsDraft && (
                          <AdminTableBodyRow className="bg-primary-container/5">
                            <AdminTableCell className="w-12 px-3 text-center text-primary-container">
                              <Icon name="add_circle" size={16} />
                            </AdminTableCell>
                            <AdminTableCell className="whitespace-nowrap px-1.5 py-1.5">
                              <input
                                name="draft-model-no"
                                value={valueProductsDraft.modelNo}
                                onChange={(e) =>
                                  setValueProductsDraft((d) => (d ? { ...d, modelNo: e.target.value } : d))
                                }
                                onKeyDown={onDraftKey}
                                autoFocus
                                placeholder={t('selectionAdmin.colModel')}
                                className={`${draftInputClass} w-24 sm:w-28`}
                              />
                            </AdminTableCell>
                            <AdminTableCell className="px-1.5 py-1.5">
                              <input
                                name="draft-name"
                                value={valueProductsDraft.name}
                                onChange={(e) => setValueProductsDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                                onKeyDown={onDraftKey}
                                placeholder={t('selectionAdmin.colName')}
                                className={`${draftInputClass} w-32 sm:w-40`}
                              />
                            </AdminTableCell>
                            {paramCols.map((col) => (
                              <AdminTableCell key={col.key} className="whitespace-nowrap px-1.5 py-1.5">
                                <input
                                  name={`draft-spec-${col.key}`}
                                  value={valueProductsDraft.specs[col.key] ?? ''}
                                  onChange={(e) =>
                                    setValueProductsDraft((d) =>
                                      d ? { ...d, specs: { ...d.specs, [col.key]: e.target.value } } : d,
                                    )
                                  }
                                  onKeyDown={onDraftKey}
                                  disabled={col.key === valueProductsView.field}
                                  placeholder={col.label}
                                  className={`${draftInputClass} w-20 sm:w-24 disabled:opacity-70`}
                                  title={
                                    col.key === valueProductsView.field
                                      ? t('selectionAdmin.valueLockedTitle', { value: valueProductsView.value })
                                      : col.label
                                  }
                                />
                              </AdminTableCell>
                            ))}
                            <AdminTableCell className="sticky right-0 w-24 border-l border-outline-variant/12 bg-surface-container-low whitespace-nowrap">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => void handleValueProductCreate()}
                                  disabled={valueProductsBusy}
                                  title={t('selectionAdmin.confirmCreateTitle')}
                                  aria-label={t('selectionAdmin.confirmCreate')}
                                  className="grid h-7 w-7 place-items-center rounded-md bg-primary-container text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                                >
                                  <Icon name={valueProductsBusy ? 'hourglass_empty' : 'check'} size={14} />
                                </button>
                                <button
                                  onClick={() => setValueProductsDraft(null)}
                                  disabled={valueProductsBusy}
                                  title={t('selectionAdmin.cancelEscTitle')}
                                  aria-label={t('selectionAdmin.cancelCreate')}
                                  className="grid h-7 w-7 place-items-center rounded-md border border-outline-variant/20 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
                                >
                                  <Icon name="close" size={14} />
                                </button>
                              </div>
                            </AdminTableCell>
                          </AdminTableBodyRow>
                        )}
                        {rows.map((p) => {
                          const editing = valueProductsEdit?.id === p.id;
                          return (
                            <AdminTableBodyRow
                              key={p.id}
                              className={`group ${editing ? 'bg-primary-container/5' : ''} ${
                                p.hidden ? 'opacity-50' : ''
                              }`}
                            >
                              <AdminTableCell className="w-12 px-3 py-2.5">
                                <input
                                  type="checkbox"
                                  checked={valueProductsSelected.has(p.id)}
                                  onChange={() =>
                                    setValueProductsSelected((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(p.id)) next.delete(p.id);
                                      else next.add(p.id);
                                      return next;
                                    })
                                  }
                                  className="h-4 w-4 accent-primary-container"
                                  aria-label={t('selectionAdmin.selectProductAria', { name: p.modelNo || p.name })}
                                />
                              </AdminTableCell>
                              {editing ? (
                                <>
                                  <AdminTableCell className="whitespace-nowrap px-1.5 py-1.5">
                                    <input
                                      name={`edit-model-no-${p.id}`}
                                      value={valueProductsEdit.draft.modelNo}
                                      onChange={(e) =>
                                        setValueProductsEdit((s) =>
                                          s ? { ...s, draft: { ...s.draft, modelNo: e.target.value } } : s,
                                        )
                                      }
                                      onKeyDown={onEditKey}
                                      autoFocus
                                      placeholder={t('selectionAdmin.colModel')}
                                      className={`${draftInputClass} w-24 sm:w-28`}
                                    />
                                  </AdminTableCell>
                                  <AdminTableCell className="px-1.5 py-1.5">
                                    <input
                                      name={`edit-name-${p.id}`}
                                      value={valueProductsEdit.draft.name}
                                      onChange={(e) =>
                                        setValueProductsEdit((s) =>
                                          s ? { ...s, draft: { ...s.draft, name: e.target.value } } : s,
                                        )
                                      }
                                      onKeyDown={onEditKey}
                                      placeholder={t('selectionAdmin.colName')}
                                      className={`${draftInputClass} w-32 sm:w-40`}
                                    />
                                  </AdminTableCell>
                                  {paramCols.map((col) => (
                                    <AdminTableCell key={col.key} className="whitespace-nowrap px-1.5 py-1.5">
                                      <input
                                        name={`edit-spec-${p.id}-${col.key}`}
                                        value={valueProductsEdit.draft.specs[col.key] ?? ''}
                                        onChange={(e) =>
                                          setValueProductsEdit((s) =>
                                            s
                                              ? {
                                                  ...s,
                                                  draft: {
                                                    ...s.draft,
                                                    specs: { ...s.draft.specs, [col.key]: e.target.value },
                                                  },
                                                }
                                              : s,
                                          )
                                        }
                                        onKeyDown={onEditKey}
                                        placeholder={col.label}
                                        className={`${draftInputClass} w-20 sm:w-24`}
                                        title={
                                          col.key === valueProductsView.field
                                            ? t('selectionAdmin.editSpecMoveHint')
                                            : col.label
                                        }
                                      />
                                    </AdminTableCell>
                                  ))}
                                </>
                              ) : (
                                <>
                                  <AdminTableCell className="whitespace-nowrap font-medium">
                                    {p.modelNo || '—'}
                                  </AdminTableCell>
                                  <AdminTableCell muted className="max-w-48 truncate" title={p.name}>
                                    {p.name}
                                  </AdminTableCell>
                                  {paramCols.map((col) => {
                                    const v = (p.specs as Record<string, string>)[col.key];
                                    return (
                                      <AdminTableCell
                                        key={col.key}
                                        muted={col.key !== valueProductsView.field}
                                        className={`whitespace-nowrap ${
                                          col.key === valueProductsView.field
                                            ? 'font-medium !text-primary-container'
                                            : ''
                                        }`}
                                      >
                                        {v ?? '—'}
                                      </AdminTableCell>
                                    );
                                  })}
                                </>
                              )}
                              <AdminTableCell className="sticky right-0 w-24 border-l border-outline-variant/12 bg-surface-container-low whitespace-nowrap group-hover:bg-surface-container-high">
                                <div className="flex items-center justify-center gap-1">
                                  {editing ? (
                                    <>
                                      <button
                                        onClick={() => void handleValueProductSave()}
                                        disabled={valueProductsBusy}
                                        title={t('selectionAdmin.confirmSaveTitle')}
                                        aria-label={t('selectionAdmin.saveChanges')}
                                        className="grid h-7 w-7 place-items-center rounded-md bg-primary-container text-on-primary transition-opacity hover:opacity-90 disabled:opacity-50"
                                      >
                                        <Icon name={valueProductsBusy ? 'hourglass_empty' : 'check'} size={14} />
                                      </button>
                                      <button
                                        onClick={() => setValueProductsEdit(null)}
                                        disabled={valueProductsBusy}
                                        title={t('selectionAdmin.cancelEscTitle')}
                                        aria-label={t('selectionAdmin.cancelEdit')}
                                        className="grid h-7 w-7 place-items-center rounded-md border border-outline-variant/20 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50"
                                      >
                                        <Icon name="close" size={14} />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() => startValueProductsEdit(p)}
                                      title={t('selectionAdmin.editProductFull')}
                                      aria-label={t('selectionAdmin.editProduct')}
                                      className={SELECTION_ICON_BUTTON_EDIT}
                                    >
                                      <Icon name="edit" size={14} />
                                    </button>
                                  )}
                                </div>
                              </AdminTableCell>
                            </AdminTableBodyRow>
                          );
                        })}
                      </tbody>
                    </AdminTable>
                  </div>
                  {/* 底部：批量修改——单行布局，控件统一 h-8、收起/展开行高一致不跳动；
                      展开时小号下拉+输入框插在「批量修改」按钮左侧，最左侧提示文字与按钮都保留不遮挡 */}
                  <div className="flex shrink-0 flex-nowrap items-center gap-1.5 border-t border-outline-variant/10 bg-surface-container-low px-3 py-2 sm:gap-2 sm:px-5">
                    <p className="min-w-0 flex-1 truncate text-[11px] text-on-surface-variant">
                      {valueProductsDraft
                        ? t('selectionAdmin.draftHint')
                        : valueProductsEdit
                          ? t('selectionAdmin.editHint')
                          : batchFieldEditOpen
                            ? t('selectionAdmin.batchFieldHint', { count: selectedInView.length })
                            : selectedInView.length > 0
                              ? t('selectionAdmin.selectedHint', { count: selectedInView.length })
                              : t('selectionAdmin.idleHint')}
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
                                ? t('selectionAdmin.colName')
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
                                <span>{t('selectionAdmin.colName')}</span>
                                <span className="text-[10px] text-on-surface-variant/60">
                                  {t('selectionAdmin.baseField')}
                                </span>
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
                          placeholder={t('selectionAdmin.batchValuePlaceholder')}
                          className="h-8 w-52 shrink-0 rounded-lg border border-outline-variant/20 bg-surface-container-lowest px-2.5 text-xs text-on-surface outline-none transition-colors hover:border-outline-variant/40 focus:border-primary-container sm:w-72 sm:text-sm"
                        />
                        <button
                          type="button"
                          disabled={batchFieldBusy || !batchFieldValue.trim() || selectedInView.length === 0}
                          onClick={() => void handleBatchFieldUpdate()}
                          aria-label={t('selectionAdmin.applyBatchEdit')}
                          title={
                            selectedInView.length > 0
                              ? t('selectionAdmin.applyBatchEditTitle', { count: selectedInView.length })
                              : t('selectionAdmin.selectProductsFirst')
                          }
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-outline-variant/20 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
                        >
                          <Icon name={batchFieldBusy ? 'hourglass_empty' : 'check'} size={15} />
                        </button>
                      </>
                    )}
                    {/* 批量修改展开时隐藏新增/删除按钮，避免底部工具条在窄屏溢出 */}
                    {!batchFieldEditOpen && (
                      <>
                        <button
                          type="button"
                          disabled={valueProductsBusy}
                          onClick={() => (valueProductsDraft ? setValueProductsDraft(null) : startValueProductsDraft())}
                          className={`flex h-8 shrink-0 items-center gap-1 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
                            valueProductsDraft
                              ? 'border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high'
                              : 'border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40'
                          }`}
                        >
                          <Icon name={valueProductsDraft ? 'close' : 'add'} size={13} />
                          {valueProductsDraft ? t('selectionAdmin.cancelCreate') : t('selectionAdmin.newProduct')}
                        </button>
                        <button
                          type="button"
                          disabled={selectedInView.length === 0 || valueProductsBusy}
                          onClick={() => setValueDeleteConfirmOpen(true)}
                          className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-outline-variant/20 px-2.5 text-xs font-medium text-on-surface-variant transition-colors hover:border-error/40 hover:bg-surface-container-high hover:text-error disabled:opacity-40 disabled:hover:border-outline-variant/20 disabled:hover:bg-transparent disabled:hover:text-on-surface-variant"
                        >
                          <Icon name="delete" size={13} />
                          {t('selectionAdmin.deleteSelected')}
                          {selectedInView.length > 0 ? ` (${selectedInView.length})` : ''}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={!batchFieldEditOpen && selectedInView.length === 0}
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
                      {t('selectionAdmin.batchEdit')}
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
              <h3 className="text-sm font-bold text-on-surface">{t('selectionAdmin.renameTitle')}</h3>
              <button
                onClick={() => setRenameOldVal('')}
                className="grid h-8 w-8 place-items-center rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div>
              <label className="text-xs text-on-surface-variant mb-1 block">{t('selectionAdmin.currentValue')}</label>
              <p className="text-sm text-on-surface font-medium bg-surface-container-lowest px-3 py-2 rounded border border-outline-variant/10 break-words">
                {renameOldVal}
              </p>
            </div>
            <div>
              <label className="text-xs text-on-surface-variant mb-1 block">{t('selectionAdmin.changeTo')}</label>
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
                {t('common.cancel')}
              </button>
              <button
                onClick={async () => {
                  if (!renameNewVal.trim() || renameNewVal === renameOldVal) return;
                  setRenaming(true);
                  try {
                    const newVal = renameNewVal.trim();
                    const { updated } = await renameOptionValue(activeCat.id, renameField, renameOldVal, newVal);
                    toast(
                      t('selectionAdmin.renameToast', { old: renameOldVal, new: newVal, count: updated }),
                      'success',
                    );
                    // Update local orderItems to reflect the rename immediately
                    setOrderItems((prev) => prev.map((v) => (v === renameOldVal ? newVal : v)));
                    mutateCats();
                    mutateProds();
                    setRenameOldVal('');
                    setRenameNewVal('');
                  } catch {
                    toast(t('selectionAdmin.replaceFailed'), 'error');
                  } finally {
                    setRenaming(false);
                  }
                }}
                disabled={renaming || !renameNewVal.trim() || renameNewVal === renameOldVal}
                className="px-3 py-2 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 disabled:opacity-50"
              >
                {renaming ? t('selectionAdmin.replacing') : t('selectionAdmin.replaceConfirm')}
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
                    toast(t('selectionAdmin.groupNameRequired'), 'error');
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
                    toast(t('selectionAdmin.groupSettingsSaved'), 'success');
                  } catch (err) {
                    toast(getApiErrorMessage(err, t('selectionAdmin.groupSettingsSaveFailed')), 'error');
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
                    toast(getApiErrorMessage(err, t('selectionAdmin.coverSaveFailed')), 'error');
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
                    toast(t('selectionAdmin.downloadingImage'), 'info');
                    const { url } = await uploadOptionImageFromUrl(targetUrl);
                    if (await saveManagedGroupImage(url, g?.imageFit || 'cover')) {
                      updateManagedGroup({ image: url });
                      toast(t('selectionAdmin.imageDownloadedSaved'), 'success');
                    }
                    return true;
                  } catch {
                    toast(t('selectionAdmin.downloadImageFailed'), 'error');
                    return true;
                  }
                };
                const uploadManagedGroupFile = async (file: File) => {
                  try {
                    const { url } = await uploadOptionImage(file);
                    if (await saveManagedGroupImage(url, g?.imageFit || 'cover')) {
                      updateManagedGroup({ image: url });
                      toast(t('selectionAdmin.groupCoverUploaded'), 'success');
                    }
                  } catch (err) {
                    toast(getApiErrorMessage(err, t('selectionAdmin.uploadFailed')), 'error');
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
                      <h2 className="text-base font-bold text-on-surface">
                        {g?.name} — {t('selectionAdmin.tabCategories')}
                      </h2>
                    </div>

                    <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
                      <div className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3 space-y-3">
                        <div>
                          <p className="text-xs font-bold text-on-surface">{t('selectionAdmin.groupSettingsTitle')}</p>
                          <p className="text-[10px] text-on-surface-variant mt-0.5">
                            {t('selectionAdmin.groupSettingsHint')}
                          </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr] gap-2">
                          <input
                            name="g"
                            value={g?.icon || ''}
                            onChange={(e) => updateManagedGroup({ icon: e.target.value })}
                            placeholder={t('selectionAdmin.iconPlaceholderShort')}
                            className="w-full bg-surface-container-low text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                          />
                          <input
                            name="g"
                            value={g?.name || ''}
                            onChange={(e) => updateManagedGroup({ name: e.target.value })}
                            placeholder={t('selectionAdmin.groupNamePlaceholder')}
                            className="w-full bg-surface-container-low text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                          />
                        </div>
                        <div className="flex justify-end">
                          <button
                            onClick={saveManagedGroupSettings}
                            disabled={!g?.name.trim()}
                            className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 disabled:opacity-50"
                          >
                            {t('selectionAdmin.saveSettings')}
                          </button>
                        </div>
                      </div>
                      <div
                        className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-3 space-y-3"
                        onPaste={handleManagedGroupCoverPaste}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-bold text-on-surface">{t('selectionAdmin.groupCoverTitle')}</p>
                            <p className="text-[10px] text-on-surface-variant mt-0.5">
                              {t('selectionAdmin.coverRecommend')}
                            </p>
                          </div>
                          <div className="flex rounded-lg bg-surface-container-high p-0.5 text-[11px]">
                            {[
                              { value: 'cover', label: t('selectionAdmin.fitCover') },
                              { value: 'contain', label: t('selectionAdmin.fitContain') },
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
                          <span>{t('selectionAdmin.coverUploadHint')}</span>
                          <span>{t('selectionAdmin.coverDisplayHint')}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] text-on-surface-variant">{t('selectionAdmin.coverSafeHint')}</p>
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
                                    toast(t('selectionAdmin.groupCoverDeleted'), 'success');
                                  }
                                }}
                                className="px-3 py-1.5 text-xs font-medium border border-outline-variant/30 text-error/70 hover:text-error rounded hover:border-error/30 shrink-0"
                              >
                                {t('selectionAdmin.deleteCover')}
                              </button>
                            )}
                            <button
                              onClick={importManagedGroupCover}
                              className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 shrink-0"
                            >
                              {t('selectionAdmin.uploadCover')}
                            </button>
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wide">
                        {t('selectionAdmin.catsInGroup', { count: catsInGroup.length })}
                      </p>
                      {catsInGroup.length === 0 && (
                        <p className="text-xs text-on-surface-variant py-2 text-center">
                          {t('selectionAdmin.noCategories')}
                        </p>
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
                                  toast(t('selectionAdmin.removedFromGroup', { name: c.name }), 'success');
                                }}
                                className="rounded bg-error/10 px-2 py-1 text-[11px] font-bold text-error"
                              >
                                {t('common.confirm')}
                              </button>
                              <button
                                onClick={() => setRemoveGroupCatId(null)}
                                className="rounded px-2 py-1 text-[11px] text-on-surface-variant hover:bg-surface-container-high"
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setRemoveGroupCatId(c.id)}
                              className="text-error/60 hover:text-error shrink-0"
                              data-tooltip-ignore
                              aria-label={t('selectionAdmin.removeFromGroup')}
                              title={t('selectionAdmin.removeFromGroup')}
                            >
                              <Icon name="close" size={14} />
                            </button>
                          )}
                        </div>
                      ))}

                      {otherCats.length > 0 && (
                        <>
                          <p className="text-[10px] text-on-surface-variant font-bold uppercase tracking-wide pt-2">
                            {t('selectionAdmin.otherCats')}
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
                                  toast(t('selectionAdmin.movedToGroup', { name: c.name }), 'success');
                                }}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-outline-variant/30 bg-surface-container-lowest hover:border-primary-container/40 hover:bg-primary-container/5 w-full text-left transition-colors"
                              >
                                <Icon name="add" size={14} className="text-primary-container shrink-0" />
                                <span className="text-sm text-on-surface-variant flex-1 truncate">{c.name}</span>
                                {srcGroup ? (
                                  <span className="text-[10px] text-on-surface-variant/60 shrink-0">
                                    {t('selectionAdmin.fromGroup', { name: srcGroup.name })}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-on-surface-variant/60 shrink-0">
                                    {t('selectionAdmin.ungrouped')}
                                  </span>
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
                        {t('selectionAdmin.back')}
                      </button>
                    </div>
                  </>
                );
              })()
            ) : (
              <>
                {/* --- Main view: group list --- */}
                <div className="flex items-center justify-between shrink-0">
                  <h2 className="text-base font-bold text-on-surface">{t('selectionAdmin.groupManagement')}</h2>
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
                      placeholder={t('selectionAdmin.iconPlaceholderShort')}
                      className="w-20 bg-surface-container-lowest text-on-surface text-xs rounded px-2 py-1.5 border border-outline-variant/20 outline-none focus:border-primary-container"
                    />
                    <input
                      name="name"
                      value={groupForm.name}
                      onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                      placeholder={t('selectionAdmin.groupNamePlaceholder')}
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
                        toast(t('selectionAdmin.groupCreated'));
                        setGroupForm({ name: '', icon: 'category', image: '', imageFit: 'cover' });
                        mutateCats();
                      }}
                      disabled={!groupForm.name.trim()}
                      className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90 disabled:opacity-50 shrink-0"
                    >
                      {t('selectionAdmin.create')}
                    </button>
                  </div>
                  <p className="text-[10px] text-on-surface-variant">{t('selectionAdmin.groupCreateHint')}</p>
                </div>

                {/* Group list */}
                <div className="flex-1 overflow-y-auto min-h-0 space-y-1">
                  {groupItems.length === 0 && (
                    <p className="text-center py-8 text-on-surface-variant text-sm">{t('selectionAdmin.noGroups')}</p>
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
                      <span className="text-[10px] text-on-surface-variant">
                        {t('selectionAdmin.nCategories', { count: g.catCount })}
                      </span>
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
                              toast(t('selectionAdmin.groupDeleted'), 'success');
                            }}
                            className="rounded bg-error/10 px-2 py-1 text-[11px] font-bold text-error"
                          >
                            {t('common.confirm')}
                          </button>
                          <button
                            onClick={() => setDeleteGroupId(null)}
                            className="rounded px-2 py-1 text-[11px] text-on-surface-variant hover:bg-surface-container-high"
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteGroupId(g.id)}
                          className={SELECTION_ICON_BUTTON_DELETE}
                          data-tooltip-ignore
                          aria-label={t('selectionAdmin.deleteGroup')}
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
                    {t('common.close')}
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
                        toast(t('selectionAdmin.groupSaved'), 'success');
                        setShowGroupModal(false);
                        setDeleteGroupId(null);
                        setRemoveGroupCatId(null);
                        mutateCats();
                      } catch {
                        toast(t('selectionAdmin.saveFailed'), 'error');
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90"
                  >
                    {t('selectionAdmin.saveSettings')}
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
              <h2 className="text-base font-bold text-on-surface">{t('selectionAdmin.catSortTitle')}</h2>
              <button
                onClick={() => setShowCatSortModal(false)}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <p className="text-xs text-on-surface-variant shrink-0">{t('selectionAdmin.catSortHint')}</p>
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
                {t('common.cancel')}
              </button>
              <button
                onClick={async () => {
                  try {
                    await sortCategories(catSortItems.map((item, i) => ({ id: item.id, sortOrder: i })));
                    toast(t('selectionAdmin.orderSaved'), 'success');
                    setShowCatSortModal(false);
                    mutateCats();
                  } catch (err: unknown) {
                    toast(getApiErrorMessage(err, t('selectionAdmin.orderSaveFailed')), 'error');
                  }
                }}
                className="px-3 py-1.5 text-xs font-bold bg-primary-container text-on-primary rounded hover:opacity-90"
              >
                {t('selectionAdmin.saveOrder')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminManagementPage>
  );
}

export default function SelectionAdminPage() {
  const { t } = useTranslation();
  useDocumentTitle(t('selectionAdmin.pageTitle'));

  return (
    <AdminPageShell desktopContentClassName="overflow-y-scroll selection-scrollbarless [scrollbar-gutter:stable]">
      <Content />
    </AdminPageShell>
  );
}

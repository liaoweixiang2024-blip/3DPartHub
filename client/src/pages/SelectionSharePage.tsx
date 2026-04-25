import { useEffect, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import useSWR from "swr";
import {
  getSelectionShare,
  type SelectionShareInfo,
  type SelectionProduct,
  type SelectionComponent,
  type ColumnDef,
} from "../api/selections";
import { getSiteTitle, getSiteIcon } from "../lib/publicSettings";
import Icon from "../components/shared/Icon";
import { useToast } from "../components/shared/Toast";

function sv(specs: Record<string, string>, key: string): string {
  return specs[key] || "—";
}

function ShareResultCard({ product, columns }: { product: SelectionProduct; columns: ColumnDef[] }) {
  const specCols = columns.filter((c) => c.key !== "型号");
  const comps = (product.isKit && product.components ? product.components : []) as SelectionComponent[];

  return (
    <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3">
        {product.image && (
          <img src={product.image} alt="" className="w-16 h-16 rounded-lg object-cover shrink-0 border border-outline-variant/10" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-on-surface">{product.modelNo || product.name}</span>
            {product.isKit && <span className="text-[10px] font-medium text-primary-container bg-primary-container/10 px-2 py-0.5 rounded-full">套件</span>}
          </div>
          {product.modelNo && product.name !== product.modelNo && (
            <p className="text-xs text-on-surface-variant mt-0.5 truncate">{product.name}</p>
          )}
        </div>
      </div>

      <div className="px-4 pb-2.5">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1">
          {specCols.map((col) => {
            const v = sv(product.specs as Record<string, string>, col.key);
            if (v === "—") return null;
            return (
              <div key={col.key} className="text-xs">
                <span className="text-on-surface-variant">{col.label}: </span>
                <span className="text-on-surface font-medium">{v}</span>
              </div>
            );
          })}
        </div>
      </div>

      {product.isKit && comps.length > 0 && (
        <div className="border-t border-outline-variant/10 px-4 py-2.5">
          <p className="text-xs text-on-surface-variant mb-1">子零件（{comps.length}）</p>
          <div className="space-y-0.5">
            {comps.map((c, i) => (
              <div key={i} className="flex items-center gap-2 text-xs pl-2">
                <span className="w-px h-3 bg-on-surface-variant/20 shrink-0" />
                <span className="text-on-surface">{c.name}</span>
                {c.modelNo && <span className="text-[10px] text-on-surface-variant">{c.modelNo}</span>}
                {c.qty > 1 && <span className="text-[10px] text-on-surface-variant">&times;{c.qty}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border-t border-outline-variant/10 px-4 py-2.5 flex items-center gap-2 flex-wrap">
        {product.pdfUrl && (
          <a href={product.pdfUrl} target="_blank" rel="noopener" className="px-3 py-1 text-xs font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 transition-colors inline-flex items-center gap-1">
            <Icon name="library_books" size={14} />规格书
          </a>
        )}
        {product.matchedModelId && (
          <Link to={`/model/${product.matchedModelId}`} className="px-3 py-1 text-xs font-medium border border-outline-variant/30 text-on-surface-variant rounded-lg hover:bg-surface-container-high/50 transition-colors inline-flex items-center gap-1">
            <Icon name="view_in_ar" size={14} />查看模型
          </Link>
        )}
      </div>
    </div>
  );
}

export default function SelectionSharePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const siteTitle = getSiteTitle();
  const siteIcon = getSiteIcon();

  const { data, error } = useSWR<SelectionShareInfo>(
    token ? `selection-share-${token}` : null,
    () => getSelectionShare(token!)
  );

  const redirected = useRef(false);

  // Redirect selection-mode shares to the selection page
  useEffect(() => {
    if (!data || redirected.current) return;
    const specs = data.specs as Record<string, string>;
    const isSelectionMode = data.products.length === 0;
    if (!isSelectionMode) return;

    redirected.current = true;
    const isGroupShare = data.categorySlug.startsWith("beize-group-");

    if (isGroupShare) {
      navigate(`/selection?g=${data.categorySlug}`, { replace: true });
    } else {
      navigate("/selection", { replace: true, state: { shareSlug: data.categorySlug, shareSpecs: specs } });
    }
  }, [data, navigate]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-surface gap-4">
        <div className="flex items-center gap-2 mb-2">
          {siteIcon ? (
            <img src={siteIcon} alt={siteTitle} className="h-8 w-8 shrink-0 object-contain" />
          ) : (
            <Icon name="view_in_ar" size={32} className="text-primary-container shrink-0" />
          )}
          <span className="text-lg font-bold text-on-surface">{siteTitle}</span>
        </div>
        <Icon name="link_off" size={48} className="text-on-surface-variant/30" />
        <p className="text-sm text-on-surface-variant">分享链接无效或已过期</p>
        <Link to="/" className="text-primary-container hover:underline mt-2 text-sm">返回首页</Link>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface">
        <Icon name="hourglass_empty" size={32} className="text-on-surface-variant/30 animate-spin" />
      </div>
    );
  }

  const specs = data.specs as Record<string, string>;

  // Still loading redirect
  if (data.products.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface">
        <Icon name="hourglass_empty" size={32} className="text-on-surface-variant/30 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Top bar */}
      <div className="border-b border-outline-variant/10 bg-surface-container-low px-4 md:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {siteIcon ? (
            <img src={siteIcon} alt={siteTitle} className="h-6 w-6 shrink-0 object-contain" />
          ) : (
            <Icon name="view_in_ar" size={20} className="text-primary-container shrink-0" />
          )}
          <span className="text-sm font-bold text-on-surface">{siteTitle}</span>
          <span className="text-on-surface-variant/30">·</span>
          <span className="text-sm text-on-surface-variant">选型分享</span>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/selection" className="text-xs text-primary-container hover:underline">开始新的选型</Link>
          <Link to="/login" className="text-xs text-on-surface-variant hover:text-on-surface">登录</Link>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-3xl mx-auto px-4 md:px-8 py-6 space-y-6">
        {/* Category & specs */}
        <div>
          <h1 className="text-xl font-bold text-on-surface mb-2">{data.categoryName}</h1>
          {Object.keys(specs).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(specs).map(([k, v]) => (
                <span key={k} className="text-xs bg-surface-container-high text-on-surface px-2.5 py-1 rounded-full">
                  {k}: <strong className="text-on-surface">{v}</strong>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Product count */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-on-surface-variant">匹配到 <strong className="text-on-surface">{data.products.length}</strong> 个型号</p>
        </div>

        {/* Products */}
        {data.products.length > 0 ? (
          <div className="space-y-3">
            {data.products.map((p) => (
              <ShareResultCard key={p.id} product={p} columns={data.columns} />
            ))}
          </div>
        ) : (
          <div className="text-center py-10">
            <Icon name="search_off" size={36} className="mx-auto mb-2 text-on-surface-variant/20" />
            <p className="text-sm text-on-surface-variant">产品信息已更新，暂无匹配结果</p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-outline-variant/10 pt-4 text-center">
          <p className="text-xs text-on-surface-variant">
            由 {siteTitle} 选型系统生成 ·{" "}
            <Link to="/selection" className="text-primary-container hover:underline">开始新的选型</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

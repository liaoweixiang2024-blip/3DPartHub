import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Icon from './Icon';

// 与后端 cleanTicketSourceUrl 同口径：仅接受站内白名单相对路径，其余一律不渲染成链接
export function isTicketSourceUrl(value?: string | null): value is string {
  if (!value) return false;
  return value.startsWith('/model/') || value.startsWith('/selection') || value.startsWith('/?q=');
}

/**
 * 工单来源展示：
 * - 有合法 sourceUrl → 按来源类型标注（来源模型/来源选型/来源搜索）+ 可点的站内链接
 * - 无 sourceUrl（历史工单）→ 纯文本 basePart，调用方自行加「基准零件」类前缀
 */
export default function TicketSourceLink({
  basePart,
  sourceUrl,
  className = '',
}: {
  basePart?: string | null;
  sourceUrl?: string | null;
  className?: string;
}) {
  const { t } = useTranslation();

  if (!isTicketSourceUrl(sourceUrl)) {
    return basePart ? <span className={className}>{basePart}</span> : null;
  }

  const label = sourceUrl.startsWith('/model/')
    ? t('ticketSource.typeModel', { defaultValue: '来源模型' })
    : sourceUrl.startsWith('/?q=')
      ? t('ticketSource.typeSearch', { defaultValue: '来源搜索' })
      : t('ticketSource.typeSelection', { defaultValue: '来源选型' });

  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-1 ${className}`}>
      <span className="shrink-0">{label}:</span>
      <Link
        to={sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex min-w-0 items-center gap-1 text-primary hover:underline"
        title={basePart || sourceUrl}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="truncate">{basePart || t('ticketDetail.viewSource', { defaultValue: '查看来源' })}</span>
        <Icon name="open_in_new" size={12} className="shrink-0 opacity-70" />
      </Link>
    </span>
  );
}

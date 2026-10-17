import { i18n } from '../i18n';
import { useToast } from '../components/shared/Toast';
import { getErrorMessage } from './errorNotifications';

/**
 * Convenience hooks for standard CRUD toast notifications.
 *
 * Usage:
 *   const crud = useCrudToast();
 *   crud.created('项目');
 *   crud.updated('角色');
 *   crud.deleted('分类');
 *   crud.failed(err, '删除失败');
 */
export function useCrudToast() {
  const { toast } = useToast();
  return {
    created: (name: string) => toast(i18n.t('sharedMisc.crudCreated', { name }), 'success'),
    updated: (name: string) => toast(i18n.t('sharedMisc.crudUpdated', { name }), 'success'),
    deleted: (name: string) => toast(i18n.t('sharedMisc.crudDeleted', { name }), 'success'),
    failed: (err: unknown, fallback = i18n.t('sharedMisc.crudFailedFallback')) =>
      toast(getErrorMessage(err, fallback), 'error'),
  };
}

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
    created: (name: string) => toast(`${name}已创建`, 'success'),
    updated: (name: string) => toast(`${name}已更新`, 'success'),
    deleted: (name: string) => toast(`${name}已删除`, 'success'),
    failed: (err: unknown, fallback = '操作失败') => toast(getErrorMessage(err, fallback), 'error'),
  };
}

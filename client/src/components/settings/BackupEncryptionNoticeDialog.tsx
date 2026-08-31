import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { copyText } from '../../lib/clipboard';
import { dialogPanelMotion } from '../../lib/motion';
import DialogOverlay from '../shared/DialogOverlay';
import Icon from '../shared/Icon';
import { useToast } from '../shared/Toast';

interface BackupEncryptionNoticeDialogProps {
  open: boolean;
  onClose: () => void;
  /** 备份加密密钥来源提示：环境变量名（如 BACKUP_ENCRYPTION_SECRET），仅展示名字，不展示密钥本身 */
  secretEnvName?: string;
}

/**
 * 备份创建完成后的加密告知弹窗。
 *
 * 密钥（BACKUP_ENCRYPTION_SECRET）只存在服务器环境变量里，接口从不回传密钥本身——
 * 这里也只提示「去哪看、怎么保管」，避免密钥出现在浏览器端（网络面板/截图/缓存）。
 */
export default function BackupEncryptionNoticeDialog({
  open,
  onClose,
  secretEnvName = 'BACKUP_ENCRYPTION_SECRET',
}: BackupEncryptionNoticeDialogProps) {
  const { toast } = useToast();
  const [copyingEnvName, setCopyingEnvName] = useState(false);

  const handleCopyEnvName = async () => {
    try {
      setCopyingEnvName(true);
      await copyText(secretEnvName);
      toast('已复制环境变量名', 'success');
    } catch {
      toast('复制失败', 'error');
    } finally {
      setCopyingEnvName(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <DialogOverlay onClose={onClose} zIndex={10000}>
          <motion.div
            variants={dialogPanelMotion}
            initial="initial"
            animate="animate"
            exit="exit"
            className="bg-surface-container-high rounded-xl shadow-2xl p-6 w-full max-w-sm border border-outline-variant/20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
                <Icon name="enhanced_encryption" size={20} className="text-green-500" />
              </div>
              <h3 className="text-lg font-bold text-on-surface">备份已加密保存</h3>
            </div>

            <div className="text-sm text-on-surface-variant space-y-2.5 mb-4">
              <p>
                本次备份已用 <span className="font-medium text-on-surface">aes-256-gcm</span>{' '}
                加密后写入磁盘，下载或恢复时系统会自动解密，操作方式不变。
              </p>
              <div className="rounded-lg border border-yellow-500/25 bg-yellow-500/10 px-3 py-2.5">
                <p className="flex items-start gap-1.5 text-xs leading-relaxed text-on-surface">
                  <Icon name="key" size={14} className="mt-0.5 shrink-0 text-yellow-600" />
                  <span>
                    <span className="font-medium">请务必把加密密钥另存一份</span>
                    （密码管理器 / 纸质抄录）。密钥在服务器的{' '}
                    <code className="font-mono text-[11px] bg-surface-container-lowest/60 px-1 py-0.5 rounded">
                      {secretEnvName}
                    </code>{' '}
                    环境变量里——<span className="font-medium">丢失密钥 = 加密备份永久无法恢复</span>。
                  </span>
                </p>
              </div>
              <p className="text-xs leading-relaxed">
                在其他服务器恢复时，目标服务器的环境变量需配置同一密钥；想关闭加密，删除该环境变量并重启容器即可（旧加密备份仍需密钥）。
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleCopyEnvName()}
                disabled={copyingEnvName}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-outline-variant/20 bg-surface-container-lowest/30 px-3 py-2 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high/65 hover:text-on-surface disabled:opacity-50"
              >
                <Icon name="content_copy" size={14} />
                复制变量名
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-transparent bg-primary-container px-3 py-2 text-xs font-medium text-on-primary shadow-sm transition-colors hover:opacity-90"
              >
                <Icon name="check" size={14} />
                我知道了
              </button>
            </div>
          </motion.div>
        </DialogOverlay>
      )}
    </AnimatePresence>
  );
}

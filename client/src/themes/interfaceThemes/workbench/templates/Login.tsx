import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { LoginThemeProps } from '../../types';

export default function WorkbenchLogin({ mode, brand, form, modeSwitch, legalLinks, backLink }: LoginThemeProps) {
  const { t } = useTranslation();
  const heading = mode === 'login' ? t('auth.loginHeading') : t('auth.registerHeading');

  return (
    <div className="workbench-auth-page flex-1 overflow-hidden bg-surface">
      <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-4 py-6 sm:px-6">
        <motion.section
          className={`workbench-auth-dialog workbench-auth-dialog-${mode} flex max-h-[calc(100dvh-13rem)] w-full max-w-[27rem] flex-col overflow-hidden rounded-2xl border border-outline-variant/14 bg-surface-container-low shadow-modal-soft`}
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
        >
          <div className="workbench-auth-header shrink-0 border-b border-outline-variant/10 px-6 pb-5 pt-6 text-center sm:px-7">
            {brand}
            <h1 className="text-lg font-bold text-on-surface">{heading}</h1>
          </div>
          {/* 限高移到卡片整体（头部固定 + 表单区滚动）：此前限高在 body 内且卡片会被
              外层 flex 挤压，overflow-hidden 把底部协议行裁掉一截（手机端注册模式尤甚） */}
          <div className="workbench-auth-body min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {form}
            {modeSwitch}
            {legalLinks}
          </div>
        </motion.section>
        <div className="workbench-auth-back">{backLink}</div>
      </div>
    </div>
  );
}

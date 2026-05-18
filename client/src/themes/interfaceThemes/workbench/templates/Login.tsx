import { motion } from 'framer-motion';
import type { LoginThemeProps } from '../../types';

export default function WorkbenchLogin({ mode, brand, form, modeSwitch, legalLinks, backLink }: LoginThemeProps) {
  const heading = mode === 'login' ? '登录您的账户' : '注册新账户';

  return (
    <div className="workbench-auth-page flex-1 overflow-hidden bg-surface">
      <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-4 py-6 sm:px-6">
        <motion.section
          className={`workbench-auth-dialog workbench-auth-dialog-${mode} w-full max-w-[27rem] overflow-hidden rounded-2xl border border-outline-variant/14 bg-surface-container-low shadow-modal-soft`}
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
        >
          <div className="workbench-auth-header border-b border-outline-variant/10 px-6 pb-5 pt-6 text-center sm:px-7">
            {brand}
            <h1 className="text-lg font-bold text-on-surface">{heading}</h1>
          </div>
          <div className="workbench-auth-body max-h-[calc(100dvh-13rem)] overflow-y-auto overscroll-contain">
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

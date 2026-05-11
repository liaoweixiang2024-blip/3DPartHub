import { motion } from 'framer-motion';
import type { LoginThemeProps } from '../../types';

export default function WorkbenchLogin({
  mode,
  brand,
  title,
  subtitle,
  form,
  modeSwitch,
  legalLinks,
  backLink,
}: LoginThemeProps) {
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden bg-surface px-4 py-5 md:px-8 md:py-8">
      <motion.div
        className="mx-auto grid min-h-full w-full max-w-6xl items-center gap-6 md:grid-cols-[minmax(0,0.92fr)_minmax(380px,460px)]"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.36, ease: 'easeOut' }}
      >
        <section className="hidden min-h-[520px] flex-col justify-between rounded-xl border border-outline-variant/10 bg-surface-container-low px-8 py-8 shadow-sm md:flex">
          <div>
            {brand}
            <p className="mt-8 max-w-md text-3xl font-headline font-bold leading-tight text-on-surface">
              {mode === 'login' ? '回到你的模型工作台。' : '创建一个可持续协作的模型账户。'}
            </p>
            <p className="mt-4 max-w-md text-sm leading-7 text-on-surface-variant">
              登录后可以继续管理收藏、下载历史、询价清单与工单沟通，所有操作都会跟随当前界面主题保持一致。
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3 text-xs text-on-surface-variant">
            {['模型', '询价', '工单'].map((item) => (
              <span key={item} className="rounded-lg border border-outline-variant/10 bg-surface-container px-3 py-2">
                {item}
              </span>
            ))}
          </div>
        </section>

        <section className="w-full max-w-md justify-self-center overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low shadow-xl md:max-w-none">
          <div className="border-b border-outline-variant/10 px-6 py-6 text-center md:hidden">
            {brand}
            {title}
            {subtitle}
          </div>
          <div className="hidden border-b border-outline-variant/10 px-8 py-7 md:block">
            {title}
            {subtitle}
          </div>
          {form}
          {modeSwitch}
          {legalLinks}
        </section>

        <div className="md:col-start-2">{backLink}</div>
      </motion.div>
    </div>
  );
}

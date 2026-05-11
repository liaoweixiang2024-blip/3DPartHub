import { motion } from 'framer-motion';
import type { LoginThemeProps } from '../../types';

export default function ClassicLogin({
  brand,
  title,
  subtitle,
  form,
  modeSwitch,
  legalLinks,
  backLink,
}: LoginThemeProps) {
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden bg-surface p-4">
      <div className="my-4 w-full max-w-md mx-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <div className="bg-surface-container-low rounded-lg border border-outline-variant/20 overflow-hidden">
            <div className="p-6 sm:p-8 border-b border-outline-variant/10 text-center">
              {brand}
              {title}
              {subtitle}
            </div>
            {form}
            {modeSwitch}
            {legalLinks}
          </div>
          {backLink}
        </motion.div>
      </div>
    </div>
  );
}

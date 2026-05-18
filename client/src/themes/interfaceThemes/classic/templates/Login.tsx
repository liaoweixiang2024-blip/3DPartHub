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
      <div className="mx-auto my-4 w-full max-w-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          <div className="overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-low">
            <div className="border-b border-outline-variant/10 p-6 text-center sm:p-8">
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

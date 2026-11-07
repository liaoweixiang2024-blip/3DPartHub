import { Component, type ReactNode } from 'react';
import { i18n } from '../../i18n';
import { notifyGlobalError } from '../../lib/errorNotifications';
import Icon from './Icon';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** 旧内核浏览器的模块解析失败：懒加载 chunk 里的新语法（如 three.js 的 class static block）
 *  在 Chrome<94 / Safari<16.4 上以 SyntaxError（"Unexpected token"）抛进 ErrorBoundary。
 *  这类错误刷新无用，只有升级浏览器才能解决——识别出来换成可操作的提示。 */
function isLegacyBrowserParseError(error: Error | null): boolean {
  if (!error) return false;
  if (error instanceof SyntaxError) return true;
  return /Unexpected (token|identifier|reserved word)|Invalid or unexpected token|Unexpected end of input/i.test(
    error.message,
  );
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    notifyGlobalError(error, i18n.t('errorBoundary.toast'));
  }

  render() {
    if (this.state.hasError) {
      const legacyBrowser = isLegacyBrowserParseError(this.state.error);
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 p-8">
          <Icon
            name={legacyBrowser ? 'devices' : 'error'}
            size={48}
            className={legacyBrowser ? 'text-on-surface-variant' : 'text-error'}
          />
          <h2 className="font-headline text-lg font-semibold text-on-surface">
            {legacyBrowser ? i18n.t('errorBoundary.outdatedTitle') : i18n.t('errorBoundary.title')}
          </h2>
          <p className="text-on-surface-variant text-sm max-w-md text-center">
            {legacyBrowser
              ? i18n.t('errorBoundary.outdatedDescription')
              : this.state.error?.message || i18n.t('errorBoundary.unknown')}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="bg-primary-container text-on-primary px-5 py-2 rounded-sm text-sm font-medium hover:opacity-90 transition-opacity"
          >
            {i18n.t('errorBoundary.reload')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
      return (
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 p-8">
          <Icon name="error" size={48} className="text-error" />
          <h2 className="font-headline text-lg font-semibold text-on-surface">{i18n.t('errorBoundary.title')}</h2>
          <p className="text-on-surface-variant text-sm max-w-md text-center">
            {this.state.error?.message || i18n.t('errorBoundary.unknown')}
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

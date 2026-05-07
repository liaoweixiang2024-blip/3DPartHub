type SpinnerSize = 'sm' | 'md' | 'lg';

interface LoadingSpinnerProps {
  size?: SpinnerSize;
}

const sizeClasses: Record<SpinnerSize, string> = {
  sm: 'h-5 w-5',
  md: 'h-7 w-7',
  lg: 'h-10 w-10',
};

export default function LoadingSpinner({ size = 'md' }: LoadingSpinnerProps) {
  return (
    <div className="flex min-h-[50vh] flex-1 items-center justify-center">
      <div
        className={`${sizeClasses[size]} animate-spin rounded-full border-[2.5px] border-primary-container border-t-transparent`}
      />
    </div>
  );
}

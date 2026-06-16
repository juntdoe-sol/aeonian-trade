import * as React from 'react';
export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {}
export declare function Spinner({ className, ...props }: SpinnerProps): React.JSX.Element;
export interface LoadingProps extends React.HTMLAttributes<HTMLDivElement> {
  text?: string;
}
export declare function Loading({ text, className, ...props }: LoadingProps): React.JSX.Element;

import * as ResizablePrimitive from 'react-resizable-panels';
declare const ResizablePanelGroup: ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => import('react').JSX.Element;
declare const ResizablePanel: import('react').ForwardRefExoticComponent<
  Omit<import('react').HTMLAttributes<any>, 'id' | 'onResize'> & {
    className?: string | undefined;
    collapsedSize?: number | undefined;
    collapsible?: boolean | undefined;
    defaultSize?: number | undefined;
    id?: string | undefined;
    maxSize?: number | undefined;
    minSize?: number | undefined;
    onCollapse?: ResizablePrimitive.PanelOnCollapse | undefined;
    onExpand?: ResizablePrimitive.PanelOnExpand | undefined;
    onResize?: ResizablePrimitive.PanelOnResize | undefined;
    order?: number | undefined;
    style?: object | undefined;
    tagName?: string | number | symbol | undefined;
  } & {
    children?: import('react').ReactNode;
  } & import('react').RefAttributes<ResizablePrimitive.ImperativePanelHandle>
>;
declare const ResizableHandle: ({
  withHandle,
  className,
  ...props
}: Omit<import('react').HTMLAttributes<string | number | symbol>, 'id' | 'onFocus' | 'onBlur'> & {
  className?: string | undefined;
  disabled?: boolean | undefined;
  hitAreaMargins?: ResizablePrimitive.PointerHitAreaMargins | undefined;
  id?: string | null | undefined;
  onBlur?: (() => void) | undefined;
  onDragging?: ResizablePrimitive.PanelResizeHandleOnDragging | undefined;
  onFocus?: (() => void) | undefined;
  style?: import('react').CSSProperties | undefined;
  tabIndex?: number | undefined;
  tagName?: string | number | symbol | undefined;
} & {
  children?: import('react').ReactNode;
} & {
  withHandle?: boolean | undefined;
}) => import('react').JSX.Element;
export { ResizablePanelGroup, ResizablePanel, ResizableHandle };

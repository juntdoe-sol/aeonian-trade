import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
declare const THEMES: {
  readonly light: '';
  readonly dark: '.dark';
};
export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | {
        color?: string;
        theme?: never;
      }
    | {
        color?: never;
        theme: Record<keyof typeof THEMES, string>;
      }
  );
};
declare const ChartContainer: React.ForwardRefExoticComponent<
  Omit<
    React.ClassAttributes<HTMLDivElement> &
      React.HTMLAttributes<HTMLDivElement> & {
        config: ChartConfig;
        children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
      },
    'ref'
  > &
    React.RefAttributes<HTMLDivElement>
>;
declare const ChartStyle: ({
  id,
  config,
}: {
  id: string;
  config: ChartConfig;
}) => React.JSX.Element | null;
declare const ChartTooltip: typeof RechartsPrimitive.Tooltip;
declare const ChartTooltipContent: React.ForwardRefExoticComponent<
  Omit<
    RechartsPrimitive.DefaultTooltipContentProps<
      import('recharts/types/component/DefaultTooltipContent.js').ValueType,
      import('recharts/types/component/DefaultTooltipContent.js').NameType
    > & {
      accessibilityLayer?: boolean | undefined;
      active?: boolean | undefined;
      includeHidden?: boolean | undefined;
      allowEscapeViewBox?: import('recharts/types/util/types.js').AllowInDimension | undefined;
      animationDuration?: number | undefined;
      animationEasing?: import('recharts/types/util/types.js').AnimationTiming | undefined;
      content?:
        | import('recharts/types/component/Tooltip.js').ContentType<
            import('recharts/types/component/DefaultTooltipContent.js').ValueType,
            import('recharts/types/component/DefaultTooltipContent.js').NameType
          >
        | undefined;
      coordinate?: Partial<import('recharts/types/util/types.js').Coordinate> | undefined;
      cursor?:
        | boolean
        | React.ReactElement<unknown, string | React.JSXElementConstructor<any>>
        | React.SVGProps<SVGElement>
        | undefined;
      filterNull?: boolean | undefined;
      defaultIndex?: number | undefined;
      isAnimationActive?: boolean | undefined;
      offset?: number | undefined;
      payloadUniqBy?:
        | import('recharts/types/util/payload/getUniqPayload.js').UniqueOption<
            import('recharts/types/component/DefaultTooltipContent.js').Payload<
              import('recharts/types/component/DefaultTooltipContent.js').ValueType,
              import('recharts/types/component/DefaultTooltipContent.js').NameType
            >
          >
        | undefined;
      position?: Partial<import('recharts/types/util/types.js').Coordinate> | undefined;
      reverseDirection?: import('recharts/types/util/types.js').AllowInDimension | undefined;
      shared?: boolean | undefined;
      trigger?: 'hover' | 'click' | undefined;
      useTranslate3d?: boolean | undefined;
      viewBox?: import('recharts/types/util/types.js').CartesianViewBox | undefined;
      wrapperStyle?: React.CSSProperties | undefined;
    } & React.ClassAttributes<HTMLDivElement> &
      React.HTMLAttributes<HTMLDivElement> & {
        hideLabel?: boolean | undefined;
        hideIndicator?: boolean | undefined;
        indicator?: 'line' | 'dot' | 'dashed' | undefined;
        nameKey?: string | undefined;
        labelKey?: string | undefined;
      },
    'ref'
  > &
    React.RefAttributes<HTMLDivElement>
>;
declare const ChartLegend: typeof RechartsPrimitive.Legend;
declare const ChartLegendContent: React.ForwardRefExoticComponent<
  Omit<
    React.ClassAttributes<HTMLDivElement> &
      React.HTMLAttributes<HTMLDivElement> &
      Pick<RechartsPrimitive.LegendProps, 'payload' | 'verticalAlign'> & {
        hideIcon?: boolean | undefined;
        nameKey?: string | undefined;
      },
    'ref'
  > &
    React.RefAttributes<HTMLDivElement>
>;
export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
};

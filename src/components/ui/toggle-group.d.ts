import * as React from 'react';
import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { type VariantProps } from 'class-variance-authority';
declare const ToggleGroup: React.ForwardRefExoticComponent<
  ((
    | Omit<ToggleGroupPrimitive.ToggleGroupSingleProps & React.RefAttributes<HTMLDivElement>, 'ref'>
    | Omit<
        ToggleGroupPrimitive.ToggleGroupMultipleProps & React.RefAttributes<HTMLDivElement>,
        'ref'
      >
  ) &
    VariantProps<any>) &
    React.RefAttributes<HTMLDivElement>
>;
declare const ToggleGroupItem: React.ForwardRefExoticComponent<
  Omit<ToggleGroupPrimitive.ToggleGroupItemProps & React.RefAttributes<HTMLButtonElement>, 'ref'> &
    VariantProps<any> &
    React.RefAttributes<HTMLButtonElement>
>;
export { ToggleGroup, ToggleGroupItem };

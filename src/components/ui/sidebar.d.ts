import * as React from 'react';
import { VariantProps } from 'class-variance-authority';
import { TooltipContent } from '@/components/ui/tooltip';
type SidebarContext = {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};
declare const SidebarContext: React.Context<SidebarContext | null>;
declare function useSidebar(): SidebarContext;
declare const SidebarProvider: React.ForwardRefExoticComponent<
  Omit<
    React.ClassAttributes<HTMLDivElement> &
      React.HTMLAttributes<HTMLDivElement> & {
        defaultOpen?: boolean | undefined;
        open?: boolean | undefined;
        onOpenChange?: ((open: boolean) => void) | undefined;
      },
    'ref'
  > &
    React.RefAttributes<HTMLDivElement>
>;
declare const Sidebar: React.ForwardRefExoticComponent<
  Omit<
    React.ClassAttributes<HTMLDivElement> &
      React.HTMLAttributes<HTMLDivElement> & {
        side?: 'right' | 'left' | undefined;
        variant?: 'inset' | 'sidebar' | 'floating' | undefined;
        collapsible?: 'none' | 'icon' | 'offcanvas' | undefined;
      },
    'ref'
  > &
    React.RefAttributes<HTMLDivElement>
>;
declare const SidebarTrigger: React.ForwardRefExoticComponent<
  Omit<any, 'ref'> & React.RefAttributes<unknown>
>;
declare const SidebarRail: React.ForwardRefExoticComponent<
  Omit<
    React.DetailedHTMLProps<React.ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement>,
    'ref'
  > &
    React.RefAttributes<HTMLButtonElement>
>;
declare const SidebarInset: React.ForwardRefExoticComponent<
  Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
declare const SidebarInput: React.ForwardRefExoticComponent<
  Omit<any, 'ref'> & React.RefAttributes<unknown>
>;
declare const SidebarHeader: React.ForwardRefExoticComponent<
  Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
declare const SidebarFooter: React.ForwardRefExoticComponent<
  Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
declare const SidebarSeparator: React.ForwardRefExoticComponent<
  Omit<any, 'ref'> & React.RefAttributes<unknown>
>;
declare const SidebarContent: React.ForwardRefExoticComponent<
  Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
declare const SidebarGroup: React.ForwardRefExoticComponent<
  Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
declare const SidebarGroupLabel: React.ForwardRefExoticComponent<
  Omit<
    React.ClassAttributes<HTMLDivElement> &
      React.HTMLAttributes<HTMLDivElement> & {
        asChild?: boolean | undefined;
      },
    'ref'
  > &
    React.RefAttributes<HTMLDivElement>
>;
declare const SidebarGroupAction: React.ForwardRefExoticComponent<
  Omit<
    React.ClassAttributes<HTMLButtonElement> &
      React.ButtonHTMLAttributes<HTMLButtonElement> & {
        asChild?: boolean | undefined;
      },
    'ref'
  > &
    React.RefAttributes<HTMLButtonElement>
>;
declare const SidebarGroupContent: React.ForwardRefExoticComponent<
  Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
declare const SidebarMenu: React.ForwardRefExoticComponent<
  Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLUListElement>, HTMLUListElement>, 'ref'> &
    React.RefAttributes<HTMLUListElement>
>;
declare const SidebarMenuItem: React.ForwardRefExoticComponent<
  Omit<React.DetailedHTMLProps<React.LiHTMLAttributes<HTMLLIElement>, HTMLLIElement>, 'ref'> &
    React.RefAttributes<HTMLLIElement>
>;
declare const SidebarMenuButton: React.ForwardRefExoticComponent<
  Omit<
    React.ClassAttributes<HTMLButtonElement> &
      React.ButtonHTMLAttributes<HTMLButtonElement> & {
        asChild?: boolean | undefined;
        isActive?: boolean | undefined;
        tooltip?: string | React.ComponentProps<typeof TooltipContent>;
      } & VariantProps<
        (
          props?:
            | ({
                variant?: 'default' | 'outline' | null | undefined;
                size?: 'default' | 'sm' | 'lg' | null | undefined;
              } & import('class-variance-authority/types').ClassProp)
            | undefined,
        ) => string
      >,
    'ref'
  > &
    React.RefAttributes<HTMLButtonElement>
>;
declare const SidebarMenuAction: React.ForwardRefExoticComponent<
  Omit<
    React.ClassAttributes<HTMLButtonElement> &
      React.ButtonHTMLAttributes<HTMLButtonElement> & {
        asChild?: boolean | undefined;
        showOnHover?: boolean | undefined;
      },
    'ref'
  > &
    React.RefAttributes<HTMLButtonElement>
>;
declare const SidebarMenuBadge: React.ForwardRefExoticComponent<
  Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLDivElement>, HTMLDivElement>, 'ref'> &
    React.RefAttributes<HTMLDivElement>
>;
declare const SidebarMenuSkeleton: React.ForwardRefExoticComponent<
  Omit<
    React.ClassAttributes<HTMLDivElement> &
      React.HTMLAttributes<HTMLDivElement> & {
        showIcon?: boolean | undefined;
      },
    'ref'
  > &
    React.RefAttributes<HTMLDivElement>
>;
declare const SidebarMenuSub: React.ForwardRefExoticComponent<
  Omit<React.DetailedHTMLProps<React.HTMLAttributes<HTMLUListElement>, HTMLUListElement>, 'ref'> &
    React.RefAttributes<HTMLUListElement>
>;
declare const SidebarMenuSubItem: React.ForwardRefExoticComponent<
  Omit<React.DetailedHTMLProps<React.LiHTMLAttributes<HTMLLIElement>, HTMLLIElement>, 'ref'> &
    React.RefAttributes<HTMLLIElement>
>;
declare const SidebarMenuSubButton: React.ForwardRefExoticComponent<
  Omit<
    React.ClassAttributes<HTMLAnchorElement> &
      React.AnchorHTMLAttributes<HTMLAnchorElement> & {
        asChild?: boolean | undefined;
        size?: 'sm' | 'md' | undefined;
        isActive?: boolean | undefined;
      },
    'ref'
  > &
    React.RefAttributes<HTMLAnchorElement>
>;
export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
};

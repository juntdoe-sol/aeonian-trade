// Centralized toast helpers for AEONIAN.
//
// Goal: keep status/warning toasts short and human-readable, and make EVERY
// error/failure toast point users to the Aeonian support group chat with a
// clickable "Contact support" action.
//
// Use `errorToast(message, opts?)` instead of `toast.error(...)` for anything
// that surfaces a failure/error/bug to the user — it automatically appends the
// support action. `successToast` / `loadingToast` are thin passthroughs kept here
// so trade flows can import everything from one place.

import { toast } from 'sonner';

// Aeonian support group chat (X / Twitter).
export const SUPPORT_CHAT_URL =
  'https://x.com/i/chat/group_join/g2057103803988742289/qoG57AKqAN';

function openSupportChat() {
  window.open(SUPPORT_CHAT_URL, '_blank', 'noopener,noreferrer');
}

type ErrorToastOptions = {
  // Forwarded to Sonner (duration, className, id, etc.).
  duration?: number;
  className?: string;
  id?: string | number;
};

/**
 * Show an error/failure toast. Always includes a clickable "Contact support"
 * action that opens the Aeonian support group chat in a new tab.
 *
 * Use this for every failed/error/bug toast across the app.
 */
export function errorToast(message: string, opts: ErrorToastOptions = {}) {
  return toast.error(message, {
    duration: opts.duration ?? 8000,
    className: opts.className,
    id: opts.id,
    description: 'Need a hand? Reach out to the Aeonian support group.',
    action: {
      label: 'Contact support',
      onClick: openSupportChat,
    },
  });
}

// Passthroughs so trade flows can import status helpers from one module.
export const successToast = toast.success;
export const loadingToast = toast.loading;
export const dismissToast = toast.dismiss;

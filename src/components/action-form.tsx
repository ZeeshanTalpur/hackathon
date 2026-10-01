'use client';

import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

import type { ActionState } from '@/app/operator/actions';
import { buttonClass, primaryButtonClass } from '@/components/ui';

/**
 * Wraps a Server Action form with useActionState so validation / permission
 * failures show inline instead of crashing the page.
 */
export function ActionForm({
  action,
  children,
  className = 'flex flex-wrap items-center gap-2',
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className={className}>
      {children}
      {state ? (
        <span
          role="status"
          className={`text-xs ${state.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

export function SubmitButton({ children, primary = false }: { children: ReactNode; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={primary ? primaryButtonClass : buttonClass}>
      {pending ? 'Saving…' : children}
    </button>
  );
}

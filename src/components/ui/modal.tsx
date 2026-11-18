"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { XIcon } from "@phosphor-icons/react";
import { useRef, type ReactNode } from "react";
import { Button } from "./button";

export function Modal({ open, onOpenChange, trigger, title, description, children, busy = false }: {
  open?: boolean; onOpenChange?: (value: boolean) => void; trigger?: ReactNode; title: string;
  description: string; children: ReactNode; busy?: boolean;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className="clip-dialog" onOpenAutoFocus={() => {
          const focused = document.activeElement;
          opener.current = focused instanceof HTMLElement && focused !== document.body ? focused : null;
        }} onCloseAutoFocus={event => {
          if (!trigger && opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); }
        }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}
          onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
          <header className="clip-dialog-header">
            <div>
              <Dialog.Title className="dashboard-section">{title}</Dialog.Title>
              <Dialog.Description className="body-6 muted">{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild><Button size="icon" variant="ghost" disabled={busy} aria-label="Close dialog"><XIcon size={20} /></Button></Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

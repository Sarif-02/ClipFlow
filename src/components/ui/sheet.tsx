"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { XIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "./button";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({ children }: { children: ReactNode }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="sheet-overlay" />
      <Dialog.Content className="sheet-content" data-slot="sheet-content">
        <div className="sheet-header">
          <Dialog.Title className="title-3">ClipFlow navigation</Dialog.Title>
          <Dialog.Close asChild>
            <Button size="icon" variant="ghost" aria-label="Close navigation"><XIcon size={20} /></Button>
          </Dialog.Close>
        </div>
        <Dialog.Description className="sr-only">Workspace and management destinations.</Dialog.Description>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

 'use client';
import * as Dialog from '@radix-ui/react-dialog';
import {ApprovalCard} from './assistant-ui/elements/approval-card';
interface ConfirmDialogProps {open:boolean;title:string;message:string;confirmLabel:string;cancelLabel:string;destructive?:boolean;onConfirm:()=>void;onCancel:()=>void;}
export default function ConfirmDialog({open,title,message,confirmLabel,cancelLabel,destructive,onConfirm,onCancel}:ConfirmDialogProps) {
 return <Dialog.Root open={open} onOpenChange={value=>{if(!value)onCancel();}}><Dialog.Portal><Dialog.Overlay className="aui-dialog-overlay"/><Dialog.Content className="aui-confirm-dialog"><Dialog.Title className="sr-only">{title}</Dialog.Title><Dialog.Description className="sr-only">{message}</Dialog.Description><ApprovalCard state="request" title={title} subtitle={message} variant={destructive?'destructive':'default'} allowOnceLabel={confirmLabel} denyLabel={cancelLabel} onAllowOnce={onConfirm} onDeny={onCancel}/></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

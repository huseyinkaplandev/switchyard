'use client';

import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';

export interface ToastData {
  message: string;
  type?: 'success' | 'error';
}

export function useToast() {
  const [toast, setToast] = useState<ToastData | null>(null);

  const show = (data: ToastData) => {
    setToast(data);
  };

  return { toast, show, clear: () => setToast(null) } as const;
}

export default function Toast({ toast, onClear }: { toast: ToastData | null; onClear: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onClear, 3000);
    return () => clearTimeout(t);
  }, [toast, onClear]);

  if (!toast) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-in fade-in slide-in-from-bottom-2 duration-200">
      <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-xs font-mono shadow-lg backdrop-blur-md ${
        toast.type === 'error'
          ? 'bg-red-950/80 border-red-900/60 text-red-300'
          : 'bg-emerald-950/80 border-emerald-900/60 text-emerald-300'
      }`}>
        {toast.type === 'error'
          ? <X size={14} className="shrink-0" />
          : <Check size={14} className="shrink-0" />
        }
        {toast.message}
      </div>
    </div>
  );
}

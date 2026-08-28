import { type InputHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-11 w-full rounded-md border border-border bg-inset px-3 text-sm text-fg placeholder:text-subtle",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          "min-h-28 w-full rounded-md border border-border bg-inset px-3 py-2 text-sm text-fg placeholder:text-subtle",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/25",
          className,
        )}
        {...props}
      />
    );
  },
);

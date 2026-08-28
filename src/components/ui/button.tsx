import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 font-medium transition-opacity duration-150 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 active:scale-[0.98]",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:opacity-90",
        secondary: "bg-elevated text-fg border border-border hover:border-border-strong",
        ghost: "bg-transparent text-muted hover:text-fg hover:bg-inset",
        danger: "bg-danger text-danger-fg hover:opacity-90",
      },
      size: {
        sm: "h-9 px-3 text-2xs rounded-sm",
        md: "h-11 px-4 text-sm rounded-md",
        icon: "size-11 rounded-md",
      },
    },
    defaultVariants: { variant: "secondary", size: "sm" },
  },
);

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>
>(function Button({ className, variant, size, ...props }, ref) {
  return (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
});

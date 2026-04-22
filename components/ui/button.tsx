import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Base: uses CSS-variable ring offset so it adapts to light/dark automatically
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-base font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Primary action — bright emerald, readable on both themes
        default:
          "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800",

        // Destructive — red, works on both themes
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80",

        // Outline — transparent bg with border, uses CSS vars
        outline:
          "border border-border bg-background hover:bg-muted hover:text-foreground text-foreground",

        // Secondary — subtle filled, uses CSS vars
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70 active:bg-secondary/60",

        // Ghost — no border, subtle hover
        ghost:
          "hover:bg-accent hover:text-accent-foreground text-foreground active:bg-accent/70",

        // Link — text-only
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-5 py-2.5",
        sm:      "h-9 rounded-md px-3.5 text-sm",
        lg:      "h-13 rounded-xl px-8 text-lg",
        icon:    "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

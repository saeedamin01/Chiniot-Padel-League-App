import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // ring-offset-background uses CSS var — works on light and dark
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
  {
    variants: {
      variant: {
        default:
          "border border-border bg-muted text-foreground",
        diamond:
          "border border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
        platinum:
          "border border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
        gold:
          "border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        silver:
          "border border-slate-400/30 bg-slate-400/10 text-slate-600 dark:text-slate-300",
        bronze:
          "border border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-400",
        pending:
          "border border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
        scheduled:
          "border border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400",
        played:
          "border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
        forfeited:
          "border border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
        dissolved:
          "border border-slate-400/30 bg-slate-400/10 text-slate-500 dark:text-slate-400",
        available:
          "border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        frozen:
          "border border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
        destructive:
          "border border-destructive bg-destructive text-destructive-foreground",
        secondary:
          "border border-border bg-secondary text-secondary-foreground",
        outline:
          "border border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }

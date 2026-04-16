import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-950",
  {
    variants: {
      variant: {
        default:
          "border border-slate-700 bg-slate-700 text-slate-100",
        diamond:
          "border border-cyan-500/30 bg-cyan-500/10 text-cyan-400",
        platinum:
          "border border-slate-500/30 bg-slate-500/10 text-slate-300",
        gold:
          "border border-amber-500/30 bg-amber-500/10 text-amber-400",
        silver:
          "border border-gray-500/30 bg-gray-500/10 text-gray-300",
        bronze:
          "border border-orange-500/30 bg-orange-500/10 text-orange-400",
        pending:
          "border border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
        scheduled:
          "border border-green-500/30 bg-green-500/10 text-green-400",
        played:
          "border border-blue-500/30 bg-blue-500/10 text-blue-400",
        forfeited:
          "border border-red-500/30 bg-red-500/10 text-red-400",
        dissolved:
          "border border-slate-500/30 bg-slate-500/10 text-slate-400",
        available:
          "border border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
        frozen:
          "border border-blue-500/30 bg-blue-500/10 text-blue-400",
        destructive:
          "border border-red-600 bg-red-600 text-slate-50",
        secondary:
          "border border-slate-700 bg-slate-700 text-slate-100",
        outline:
          "border border-slate-700 text-slate-100",
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

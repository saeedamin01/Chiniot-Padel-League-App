import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        // Uses CSS variables — adapts to light/dark automatically
        "flex h-11 w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50 transition-colors",
        className
      )}
      ref={ref}
      {...props}
    />
  )
)
Input.displayName = "Input"

export { Input }

import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Sidebar } from "@/components/layout/Sidebar"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: player } = await supabase
    .from("players")
    .select("is_admin")
    .eq("id", user.id)
    .single()

  if (!player?.is_admin) {
    redirect("/dashboard")
  }

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar isAdmin={true} />
      <main className="flex-1 p-8 overflow-auto">
        {children}
      </main>
    </div>
  )
}

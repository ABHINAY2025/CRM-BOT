import { useEffect, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { motion } from "motion/react"
import { Lock, MessageCircle } from "lucide-react"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type Me = { required: boolean; authed: boolean; configured: boolean }

/** Shows a login screen when the server requires a password (always on Vercel). */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [me, setMe] = useState<Me | null>(null)
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const check = () => api<Me>("/me").then(setMe).catch(() => setMe({ required: false, authed: true, configured: true }))
  useEffect(() => {
    check()
    const onAuth = () => setMe((m) => (m ? { ...m, authed: false } : m))
    window.addEventListener("crm-auth-required", onAuth)
    return () => window.removeEventListener("crm-auth-required", onAuth)
  }, [])

  const login = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError("")
    try {
      await api("/login", { method: "POST", body: { password } })
      setPassword("")
      await check()
      qc.invalidateQueries()
    } catch (err: any) { setError(err.message) } finally { setBusy(false) }
  }

  if (!me) return <div className="grid h-screen place-items-center"><span className="size-6 animate-spin rounded-full border-2 border-brand-subtler border-t-brand" /></div>
  if (!me.required || me.authed) return <>{children}</>
  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-[#e9f2ff] via-white to-[#f3f0ff] p-4">
      <motion.form onSubmit={login} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-raised">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-[#1d7afc] to-[#0055cc] text-white"><MessageCircle className="size-5" strokeWidth={2.4} /></span>
          <div><div className="text-lg font-bold tracking-tight">WaCRM</div><div className="text-xs text-muted-foreground">Venonto · GreenBuddy leads</div></div>
        </div>
        {!me.configured ? (
          <p className="rounded-md bg-[#fff7d6] p-3 text-[13px] text-[#533f04]">The server has no <code>CRM_PASSWORD</code> set. Add it in your hosting environment variables and redeploy.</p>
        ) : (
          <>
            <label className="mb-1.5 block text-xs font-semibold text-subtle">Password</label>
            <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Team password" />
            {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-2 text-[13px] text-destructive">{error}</motion.p>}
            <Button type="submit" className="mt-4 w-full" disabled={busy || !password}><Lock />{busy ? "Signing in…" : "Sign in"}</Button>
          </>
        )}
      </motion.form>
    </div>
  )
}

export async function logout() {
  await api("/logout", { method: "POST" }).catch(() => {})
  window.location.reload()
}

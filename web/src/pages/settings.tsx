import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { Globe, Link2, RefreshCw, ShieldCheck, Smartphone, UserPlus, Users, X } from "lucide-react"
import { toast } from "sonner"
import { api, useSettings, useSystem } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { CopyField, LiveDot, Lozenge, PageHeader, UserAvatar } from "@/components/crm/bits"

function Box({ icon: Icon, title, children, action }: { icon: any; title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3"><Icon className="size-4 text-brand" /><h2 className="flex-1 font-semibold">{title}</h2>{action}</div>
      <div className="p-4">{children}</div>
    </motion.section>
  )
}
const KV = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-1 items-center gap-1 py-1.5 sm:grid-cols-[170px_1fr] sm:gap-4"><dt className="text-xs font-semibold text-subtle">{k}</dt><dd className="flex min-w-0 items-center gap-2">{children}</dd></div>
)

export default function SettingsPage() {
  const qc = useQueryClient()
  const { data: sys, isLoading, refetch, isFetching } = useSystem()
  const { data: settings } = useSettings()
  const [busy, setBusy] = useState<string | null>(null)
  const [agents, setAgents] = useState<string[]>([])
  const [newAgent, setNewAgent] = useState("")
  useEffect(() => { if (settings) setAgents(settings.agents.filter((a) => a !== "Unassigned")) }, [settings])

  const run = async (key: string, path: string, ok: string) => {
    setBusy(key)
    try { await api(path, { method: "POST" }); toast.success(ok) } catch (e: any) { toast.error(e.message) } finally { setBusy(null); qc.invalidateQueries({ queryKey: ["system"] }) }
  }
  const saveAgents = async (list: string[]) => {
    setAgents(list)
    await api("/settings", { method: "PUT", body: { agents: ["Unassigned", ...list] } })
    qc.invalidateQueries({ queryKey: ["settings"] })
  }

  return (
    <div className="px-6 py-5 lg:px-10">
      <PageHeader crumbs={["Project settings"]} title="Project settings" actions={<Button variant="secondary" onClick={() => refetch()}><RefreshCw className={cn(isFetching && "animate-spin")} />Re-check</Button>} />
      {isLoading || !sys ? <div className="grid gap-6 xl:grid-cols-2"><Skeleton className="h-72" /><Skeleton className="h-72" /></div> : (
        <div className="grid gap-6 xl:grid-cols-2">
          <Box icon={Globe} title="Webhook · ngrok tunnel" action={
            <Lozenge tone={sys.ngrokStatus === "online" ? "green" : sys.ngrokStatus === "error" ? "red" : "yellow"}>{sys.ngrokStatus}</Lozenge>
          }>
            <dl>
              <KV k="Public HTTPS URL"><CopyField value={sys.publicUrl} /></KV>
              <KV k="Callback URL (webhook)"><CopyField value={sys.webhookUrl} /></KV>
              <KV k="Verify token"><CopyField value={sys.verifyToken} /></KV>
              <KV k="Local URL"><CopyField value={sys.localUrl} /></KV>
              <KV k="Meta registration">
                <LiveDot status={sys.webhookRegistered ? "ok" : sys.webhookError ? "err" : "warn"} />
                <span className="min-w-0 text-[13px]">{sys.webhookRegistered ? <>Registered with app <b>{sys.webhookRegistered.appName}</b> · {fmtDateTime(sys.webhookRegistered.at)}</> : sys.webhookError || "Not registered in this session"}</span>
              </KV>
            </dl>
            <AnimatePresence>{sys.ngrokError && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-3 rounded-md bg-[#ffeceb] p-3 text-[13px] text-[#5d1f1a]">{sys.ngrokError}</motion.div>}</AnimatePresence>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={!sys.publicUrl || busy === "reg"} onClick={() => run("reg", "/system/register-webhook", "Webhook registered with Meta")}><Link2 />{busy === "reg" ? "Registering…" : "Register webhook with Meta"}</Button>
              <Button variant="secondary" disabled={busy === "ngrok"} onClick={() => run("ngrok", "/system/ngrok/restart", "ngrok restarted")}><RefreshCw className={cn(busy === "ngrok" && "animate-spin")} />Restart ngrok</Button>
            </div>
            <details className="mt-4 text-[13px] text-subtle">
              <summary className="cursor-pointer font-medium text-foreground">Set it up manually instead</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5">
                <li>Open <a className="text-brand hover:underline" href="https://developers.facebook.com/apps" target="_blank">developers.facebook.com/apps</a> → your app → WhatsApp → Configuration.</li>
                <li>Webhook → Edit → paste the <b>Callback URL</b> and <b>Verify token</b> above → Verify and save.</li>
                <li>Under Webhook fields, subscribe to <code className="rounded bg-muted px-1">messages</code>.</li>
                <li>Free ngrok URLs change on restart — set <code className="rounded bg-muted px-1">NGROK_DOMAIN</code> in <code className="rounded bg-muted px-1">.env</code> to your free static domain to keep it fixed.</li>
              </ol>
            </details>
          </Box>

          <Box icon={Smartphone} title="WhatsApp Cloud API" action={<Lozenge tone={sys.phone ? "green" : "red"}>{sys.phone ? "Connected" : "Error"}</Lozenge>}>
            {sys.phoneError && <div className="mb-3 rounded-md bg-[#ffeceb] p-3 text-[13px] text-[#5d1f1a]">{sys.phoneError}</div>}
            <dl>
              <KV k="Display number"><span className="font-mono">{sys.phone?.display_phone_number || "—"}</span></KV>
              <KV k="Verified name">{sys.phone?.verified_name || "—"}</KV>
              <KV k="Quality rating">{sys.phone ? <Lozenge tone={sys.phone.quality_rating === "GREEN" ? "green" : sys.phone.quality_rating === "YELLOW" ? "yellow" : "red"}>{sys.phone.quality_rating}</Lozenge> : "—"}</KV>
              <KV k="Phone number ID"><CopyField value={sys.phoneId} /></KV>
              <KV k="Business account ID"><CopyField value={sys.wabaId} /></KV>
              <KV k="Graph API version"><span className="font-mono">{sys.graphVersion}</span></KV>
              <KV k="Security"><ShieldCheck className={cn("size-4", sys.hasSecret ? "text-[#1f845a]" : "text-muted-foreground")} /><span className="text-[13px]">{sys.hasSecret ? "Webhook signatures verified with app secret" : "App secret missing — signatures not verified"}</span></KV>
            </dl>
            {sys.phone?.verified_name === "Test Number" && (
              <div className="mt-3 rounded-md bg-[#fff7d6] p-3 text-[13px] text-[#533f04]">This is Meta's <b>test number</b>: it can only message phone numbers added to the recipient list in your app's WhatsApp → API Setup page (max 5).</div>
            )}
          </Box>

          <Box icon={Users} title="Team & assignees">
            <div className="mb-3 flex flex-wrap gap-2">
              <AnimatePresence initial={false}>
                {agents.map((a) => (
                  <motion.span key={a} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="flex items-center gap-2 rounded-full border py-1 pr-1.5 pl-1">
                    <UserAvatar name={a} size={24} tooltip={false} />{a}
                    <button onClick={() => saveAgents(agents.filter((x) => x !== a))} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3.5" /></button>
                  </motion.span>
                ))}
              </AnimatePresence>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); const n = newAgent.trim(); if (n && !agents.includes(n)) saveAgents([...agents, n]); setNewAgent("") }} className="flex gap-2">
              <Input value={newAgent} onChange={(e) => setNewAgent(e.target.value)} placeholder="Teammate name" className="max-w-64" />
              <Button type="submit" variant="secondary"><UserPlus />Add</Button>
            </form>
          </Box>
        </div>
      )}
    </div>
  )
}

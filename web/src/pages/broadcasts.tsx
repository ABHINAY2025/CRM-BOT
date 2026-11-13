import { useEffect, useMemo, useState } from "react"
import { useLocation } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { Megaphone, Send } from "lucide-react"
import { toast } from "sonner"
import { api, templateBody, templateParams, useBroadcasts, useContacts, useTemplates } from "@/lib/api"
import { STAGES, fmtDateTime } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState, Lozenge, PageHeader } from "@/components/crm/bits"

export default function Broadcasts() {
  const loc = useLocation() as { state?: { template?: string; contactIds?: string[] } }
  const qc = useQueryClient()
  const { data: templates = [] } = useTemplates()
  const { data: contacts = [] } = useContacts()
  const { data: history = [] } = useBroadcasts()
  const approved = templates.filter((t) => t.status === "APPROVED")
  const [name, setName] = useState("")
  const [tplId, setTplId] = useState(loc.state?.template || "")
  const [mode, setMode] = useState<"all" | "stage" | "tag" | "selected">(loc.state?.contactIds?.length ? "selected" : "all")
  const [stage, setStage] = useState("new")
  const [tag, setTag] = useState("")
  const [params, setParams] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const selected = loc.state?.contactIds || []
  const tpl = approved.find((t) => t.id === tplId)
  const keys = templateParams(tpl)
  const tags = [...new Set(contacts.flatMap((c) => c.tags || []))]
  useEffect(() => { if (!tag && tags[0]) setTag(tags[0]) }, [tags.length]) // eslint-disable-line

  const audience = useMemo(() => {
    if (mode === "selected") return contacts.filter((c) => selected.includes(c.id))
    if (mode === "stage") return contacts.filter((c) => c.stage === stage)
    if (mode === "tag") return contacts.filter((c) => c.tags?.includes(tag))
    return contacts
  }, [mode, stage, tag, contacts, selected])

  const preview = templateBody(tpl).replace(/\{\{\s*(\w+)\s*\}\}/g, (_m: string, k: string) => (params[k] || `{{${k}}}`).replace(/\{\{name\}\}/g, audience[0]?.name || "Alex"))

  const launch = async () => {
    if (!tpl) return
    if (!confirm(`Send “${tpl.name}” to ${audience.length} contacts?`)) return
    setBusy(true)
    try {
      await api("/broadcasts", { method: "POST", body: {
        name: name || `${tpl.name} · ${new Date().toLocaleDateString()}`, template: tpl.name, language: tpl.language,
        params: keys.map((k) => ({ key: k, value: params[k] || "" })),
        audience: mode === "selected" ? { contactIds: selected } : mode === "stage" ? { stage } : mode === "tag" ? { tag } : {},
      } })
      toast.success("Broadcast started", { description: `Sending to ${audience.length} contacts` })
      qc.invalidateQueries({ queryKey: ["broadcasts"] })
    } catch (e: any) { toast.error(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="px-6 py-5 lg:px-10">
      <PageHeader crumbs={["Broadcasts"]} title="Broadcasts" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="rounded-lg border">
          <div className="border-b px-4 py-3 font-semibold">New broadcast</div>
          <div className="grid gap-4 p-4 md:grid-cols-2">
            <div className="space-y-1.5"><Label className="text-xs text-subtle">Campaign name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Diwali offer" /></div>
            <div className="space-y-1.5"><Label className="text-xs text-subtle">Template <span className="text-destructive">*</span></Label>
              <Select value={tplId} onValueChange={(v) => { setTplId(v); setParams({}) }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Choose approved template" /></SelectTrigger>
                <SelectContent>{approved.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} · {t.language}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs text-subtle">Audience</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as any)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All contacts</SelectItem><SelectItem value="stage">By pipeline stage</SelectItem><SelectItem value="tag">By label</SelectItem>
                  {selected.length > 0 && <SelectItem value="selected">Selected contacts ({selected.length})</SelectItem>}
                </SelectContent>
              </Select>
            </div>
            <AnimatePresence mode="wait">
              {mode === "stage" && (
                <motion.div key="stage" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="space-y-1.5"><Label className="text-xs text-subtle">Stage</Label>
                  <Select value={stage} onValueChange={setStage}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
                </motion.div>
              )}
              {mode === "tag" && (
                <motion.div key="tag" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="space-y-1.5"><Label className="text-xs text-subtle">Label</Label>
                  <Select value={tag} onValueChange={setTag}><SelectTrigger className="w-full"><SelectValue placeholder="No labels yet" /></SelectTrigger><SelectContent>{tags.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select>
                </motion.div>
              )}
            </AnimatePresence>
            {keys.map((k) => (
              <div key={k} className="space-y-1.5"><Label className="text-xs text-subtle">Variable {`{{${k}}}`}</Label>
                <Input value={params[k] || ""} onChange={(e) => setParams({ ...params, [k]: e.target.value })} placeholder="Text, or {{name}} for the contact's name" />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 border-t px-4 py-3">
            <span className="text-sm text-subtle"><b className="text-foreground tabular-nums">{audience.length}</b> recipients</span>
            <motion.div whileTap={{ scale: 0.96 }} className="ml-auto">
              <Button onClick={launch} disabled={!tpl || !audience.length || busy}><Send />{busy ? "Starting…" : "Send broadcast"}</Button>
            </motion.div>
          </div>
        </div>

        <div className="rounded-lg border">
          <div className="border-b px-4 py-3 font-semibold">Preview</div>
          <div className="min-h-48 bg-[#efeae2]/60 p-4">
            {tpl ? (
              <motion.div key={tpl.id} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="max-w-[90%] rounded-lg rounded-tl-sm bg-white p-3 text-[13px] whitespace-pre-wrap shadow-card">{preview}</motion.div>
            ) : <div className="pt-12 text-center text-muted-foreground">Choose a template to preview</div>}
          </div>
        </div>
      </div>

      <h2 className="mt-8 mb-3 text-base font-semibold">History</h2>
      {history.length === 0 ? <div className="rounded-lg border"><EmptyState icon={Megaphone} title="No broadcasts yet">Send an approved template to many contacts at once.</EmptyState></div> : (
        <div className="overflow-auto rounded-lg border">
          <table className="w-full">
            <thead><tr className="border-b-2 text-left text-xs text-subtle">{["Campaign", "Template", "Status", "Progress", "Sent", "Failed", "Created"].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {history.map((b) => (
                <tr key={b.id} className="border-b border-muted hover:bg-sunken" title={b.errors?.slice(0, 5).join("\n")}>
                  <td className="px-3 py-2 font-medium">{b.name}</td>
                  <td className="px-3 py-2 font-mono text-[13px]">{b.template}</td>
                  <td className="px-3 py-2"><Lozenge tone={b.status === "done" ? (b.failed ? "yellow" : "green") : "blue"}>{b.status === "done" ? "Complete" : "Sending"}</Lozenge></td>
                  <td className="px-3 py-2">
                    <div className="flex h-1.5 w-40 overflow-hidden rounded-full bg-muted">
                      <motion.div className="bg-[#22a06b]" animate={{ width: `${(b.sent / b.total) * 100}%` }} />
                      <motion.div className="bg-destructive" animate={{ width: `${(b.failed / b.total) * 100}%` }} />
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{b.sent}/{b.total}</td>
                  <td className="px-3 py-2 tabular-nums">{b.failed ? <span className="font-semibold text-destructive">{b.failed}</span> : 0}</td>
                  <td className="px-3 py-2 text-muted-foreground">{fmtDateTime(b.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

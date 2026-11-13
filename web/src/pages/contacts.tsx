import { useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { ArrowDown, ArrowUp, Download, MessageCircle, Megaphone, Plus, Search, Tag, Trash2, Users, X } from "lucide-react"
import { toast } from "sonner"
import { api, useContacts, useSettings, type Contact } from "@/lib/api"
import { STAGES, displayName, money, timeAgo } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { EmptyState, PageHeader, PriorityIcon, StageLozenge, TypeIcon, UserAvatar } from "@/components/crm/bits"
import { ServiceLozenge, TempChip } from "@/components/crm/lead-panel"
import { useUI } from "@/components/crm/dialogs"

type SortKey = "key" | "name" | "stage" | "priority" | "value" | "last"
const PRIO_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }

export default function Contacts() {
  const [params, setParams] = useSearchParams()
  const { data: contacts, isLoading } = useContacts()
  const { data: settings } = useSettings()
  const qc = useQueryClient()
  const ui = useUI()
  const navigate = useNavigate()
  const [q, setQ] = useState(params.get("q") || "")
  const [stage, setStage] = useState("all")
  const [assignee, setAssignee] = useState("all")
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "last", dir: -1 })
  const [tagText, setTagText] = useState("")
  useEffect(() => setQ(params.get("q") || ""), [params])
  const agents = [...new Set(["Unassigned", ...(settings?.agents || [])])]

  const rows = useMemo(() => {
    let l = contacts || []
    if (q) { const s = q.toLowerCase(); l = l.filter((c) => [c.name, c.phone, c.email, c.company, c.key, c.profileName, ...(c.tags || [])].some((v) => (v || "").toLowerCase().includes(s))) }
    if (stage !== "all") l = l.filter((c) => c.stage === stage)
    if (assignee !== "all") l = l.filter((c) => c.assignee === assignee)
    const val = (c: Contact): any => ({
      key: Number(c.key.split("-")[1]), name: displayName(c).toLowerCase(), stage: STAGES.findIndex((s) => s.id === c.stage),
      priority: PRIO_RANK[c.priority] ?? 2, value: c.value || 0, last: c.lastMessageAt || c.createdAt,
    }[sort.k])
    return [...l].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir)
  }, [contacts, q, stage, assignee, sort])

  const all = rows.length > 0 && rows.every((r) => sel.has(r.id))
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const bulk = async (patch: (c: Contact) => Partial<Contact>, msg: string) => {
    const targets = (contacts || []).filter((c) => sel.has(c.id))
    await Promise.all(targets.map((c) => api(`/contacts/${c.id}`, { method: "PATCH", body: patch(c) })))
    qc.invalidateQueries({ queryKey: ["contacts"] })
    toast.success(`${msg} · ${targets.length} contacts`)
  }
  const bulkDelete = async () => {
    if (!confirm(`Delete ${sel.size} contacts and their conversations?`)) return
    await Promise.all([...sel].map((id) => api(`/contacts/${id}`, { method: "DELETE" })))
    setSel(new Set()); qc.invalidateQueries({ queryKey: ["contacts"] }); toast.success("Contacts deleted")
  }
  const Th = ({ k, children, className }: { k?: SortKey; children?: React.ReactNode; className?: string }) => (
    <th className={cn("sticky top-0 z-10 border-b-2 bg-background px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-subtle", className)}>
      {k ? (
        <button onClick={() => setSort((s) => ({ k, dir: s.k === k ? (-s.dir as 1 | -1) : 1 }))} className="group inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-muted">
          {children}
          {sort.k === k ? (sort.dir === 1 ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />) : <ArrowDown className="size-3.5 opacity-0 group-hover:opacity-40" />}
        </button>
      ) : children}
    </th>
  )

  return (
    <div className="px-6 py-5 lg:px-10">
      <PageHeader crumbs={["Contacts"]} title="Contacts" actions={<>
        <Button variant="secondary" asChild><a href="/api/contacts.csv"><Download />Export CSV</a></Button>
        <Button onClick={() => ui.openCreate("contact")}><Plus />Create contact</Button>
      </>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setParams(e.target.value ? { q: e.target.value } : {}, { replace: true }) }} placeholder="Search contacts"
            className="h-8 w-56 rounded-md border border-input pr-2 pl-8 transition-all outline-none focus:w-64 focus:border-ring focus:ring-2 focus:ring-ring/25" />
        </div>
        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All stages</SelectItem>{STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All assignees</SelectItem>{agents.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">{rows.length} of {contacts?.length || 0}</span>
      </div>

      <AnimatePresence>
        {sel.size > 0 && (
          <motion.div initial={{ opacity: 0, height: 0, marginBottom: 0 }} animate={{ opacity: 1, height: "auto", marginBottom: 12 }} exit={{ opacity: 0, height: 0, marginBottom: 0 }} className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-subtler bg-brand-subtle px-3 py-2">
              <b className="mr-2 font-semibold">{sel.size} selected</b>
              <Select onValueChange={(v) => bulk(() => ({ stage: v }), `Moved to ${STAGES.find((s) => s.id === v)?.name}`)}>
                <SelectTrigger size="sm" className="w-40 bg-background"><SelectValue placeholder="Move to stage…" /></SelectTrigger>
                <SelectContent>{STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select onValueChange={(v) => bulk(() => ({ assignee: v }), `Assigned to ${v}`)}>
                <SelectTrigger size="sm" className="w-36 bg-background"><SelectValue placeholder="Assign to…" /></SelectTrigger>
                <SelectContent>{agents.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
              </Select>
              <Popover>
                <PopoverTrigger asChild><Button size="sm" variant="outline"><Tag />Add label</Button></PopoverTrigger>
                <PopoverContent className="w-60">
                  <form onSubmit={(e) => { e.preventDefault(); const t = tagText.trim().toLowerCase(); if (t) bulk((c) => ({ tags: [...new Set([...(c.tags || []), t])] }), `Label “${t}” added`); setTagText("") }} className="flex gap-2">
                    <Input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="label" autoFocus /><Button type="submit" size="sm">Add</Button>
                  </form>
                </PopoverContent>
              </Popover>
              <Button size="sm" variant="outline" onClick={() => navigate("/broadcasts", { state: { contactIds: [...sel] } })}><Megaphone />Broadcast</Button>
              <Button size="sm" variant="destructive" onClick={bulkDelete}><Trash2 />Delete</Button>
              <Button size="icon-sm" variant="ghost" className="ml-auto" onClick={() => setSel(new Set())}><X /></Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="overflow-auto rounded-lg border">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th className="w-10"><Checkbox checked={all} onCheckedChange={(on) => setSel(on ? new Set(rows.map((r) => r.id)) : new Set())} /></Th>
              <Th k="key">Key</Th><Th k="name">Contact</Th><Th>Phone</Th><Th>Service</Th><Th k="stage">Status</Th><Th>Lead</Th><Th k="priority">Priority</Th>
              <Th>Assignee</Th><Th>Labels</Th><Th k="value" className="text-right">Value</Th><Th k="last">Last activity</Th><Th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={13} className="p-2"><Skeleton className="h-8" /></td></tr>)}
            {!isLoading && rows.length === 0 && <tr><td colSpan={13}><EmptyState icon={Users} title="No contacts found">Contacts are created automatically when someone messages you, or add one with Create.</EmptyState></td></tr>}
            <AnimatePresence initial={false}>
              {rows.map((c, i) => (
                <motion.tr key={c.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: Math.min(i, 15) * 0.015 }}
                  className={cn("group border-b border-muted transition-colors hover:bg-sunken", sel.has(c.id) && "bg-brand-subtle hover:bg-brand-subtle")}>
                  <td className="px-3 py-2"><Checkbox checked={sel.has(c.id)} onCheckedChange={() => toggle(c.id)} /></td>
                  <td className="px-3 py-2 whitespace-nowrap"><span className="flex items-center gap-1.5"><TypeIcon kind="lead" /><button onClick={() => ui.openContact(c.id)} className="font-medium text-brand hover:underline">{c.key}</button></span></td>
                  <td className="px-3 py-2"><button onClick={() => ui.openContact(c.id)} className="flex items-center gap-2 text-left font-medium hover:underline"><UserAvatar name={displayName(c)} size={24} tooltip={false} />{displayName(c)}</button>
                    {c.company && <div className="pl-8 text-xs text-muted-foreground">{c.company}</div>}</td>
                  <td className="px-3 py-2 font-mono text-[13px] whitespace-nowrap">{c.phone}</td>
                  <td className="px-3 py-2">{c.lead?.service ? <ServiceLozenge service={c.lead.service} /> : <span className="text-muted-foreground">—</span>}{(c.lead?.fields.location || c.lead?.fields.rasLocation) && <div className="mt-0.5 max-w-40 truncate text-xs text-muted-foreground">{c.lead.fields.location || c.lead.fields.rasLocation}</div>}</td>
                  <td className="px-3 py-2"><StageLozenge stage={c.stage} /></td>
                  <td className="px-3 py-2">{c.lead?.temperature ? <TempChip temp={c.lead.temperature} /> : <span className="text-muted-foreground">—</span>}{c.lead?.fit && <div className="mt-0.5 text-[11px] text-muted-foreground">{c.lead.fit}</div>}</td>
                  <td className="px-3 py-2"><PriorityIcon priority={c.priority} withLabel /></td>
                  <td className="px-3 py-2 whitespace-nowrap"><span className="flex items-center gap-2"><UserAvatar name={c.assignee} size={22} />{c.assignee}</span></td>
                  <td className="px-3 py-2"><div className="flex flex-wrap gap-1">{(c.tags || []).map((t) => <span key={t} className="rounded-[3px] border bg-muted px-1.5 text-xs text-subtle">{t}</span>)}</div></td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.value ? money(c.value) : <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{timeAgo(c.lastMessageAt || c.createdAt)}</td>
                  <td className="px-3 py-2"><Button size="icon-sm" variant="ghost" className="opacity-0 transition-opacity group-hover:opacity-100" title="Open chat" onClick={() => navigate(`/inbox/${c.id}`)}><MessageCircle /></Button></td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </div>
  )
}

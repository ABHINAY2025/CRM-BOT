import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { FileText, Link2, MessageSquare, Plus, Send, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { api, templateBody, templateParams, useContact, useContacts, useSettings, useTemplates, type Task } from "@/lib/api"
import { PRIORITIES, STAGES, TASK_STATUSES, displayName, fmtDateTime, fmtTime } from "@/lib/format"
import { invalidateTasks, useSendMessage, useUpdateTask } from "@/lib/mutations"
import { cn } from "@/lib/utils"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { ContactDetails, NotesBox } from "./contact-details"
import { LeadPanel } from "./lead-panel"
import { Lozenge, PriorityIcon, TypeIcon, UserAvatar } from "./bits"

type UI = {
  openCreate: (kind?: "contact" | "task", defaults?: Record<string, any>) => void
  openContact: (id: string) => void
  openTask: (t: Task) => void
  openTemplate: (contactId: string, templateName?: string) => void
}
const Ctx = createContext<UI>(null as any)
export const useUI = () => useContext(Ctx)

export function UIProvider({ children }: { children: ReactNode }) {
  const [create, setCreate] = useState<{ kind: "contact" | "task"; defaults?: any } | null>(null)
  const [contactId, setContactId] = useState<string | null>(null)
  const [task, setTask] = useState<Task | null>(null)
  const [tpl, setTpl] = useState<{ contactId: string; name?: string } | null>(null)
  const ui = useMemo<UI>(() => ({
    openCreate: (kind = "contact", defaults) => setCreate({ kind, defaults }),
    openContact: setContactId,
    openTask: setTask,
    openTemplate: (contactId, name) => setTpl({ contactId, name }),
  }), [])
  return (
    <Ctx.Provider value={ui}>
      {children}
      <CreateDialog state={create} onClose={() => setCreate(null)} />
      <ContactDialog id={contactId} onClose={() => setContactId(null)} />
      <TaskDialog task={task} onClose={() => setTask(null)} />
      <TemplateDialog state={tpl} onClose={() => setTpl(null)} />
    </Ctx.Provider>
  )
}

function Field({ label, required, hint, children, className }: { label: string; required?: boolean; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs font-semibold text-subtle">{label}{required && <span className="text-destructive"> *</span>}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function SimpleSelect({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: { id: string; name: ReactNode }[]; placeholder?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>{options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}</SelectContent>
    </Select>
  )
}

/* ------------------------------------------------------------------ Create */
function CreateDialog({ state, onClose }: { state: { kind: "contact" | "task"; defaults?: any } | null; onClose: () => void }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data: settings } = useSettings()
  const { data: contacts = [] } = useContacts()
  const agents = [...new Set(["Unassigned", ...(settings?.agents || [])])]
  const [kind, setKind] = useState<"contact" | "task">("contact")
  const [f, setF] = useState<any>({})
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!state) return
    setKind(state.kind)
    setF({ stage: "new", priority: "medium", assignee: "Unassigned", status: "todo", contactId: "none", ...state.defaults })
  }, [state])
  const set = (k: string) => (v: any) => setF((p: any) => ({ ...p, [k]: v?.target ? v.target.value : v }))

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (kind === "contact") {
        const c = await api("/contacts", { method: "POST", body: { ...f, tags: (f.tagsText || "").split(",").map((t: string) => t.trim().toLowerCase()).filter(Boolean) } })
        qc.invalidateQueries({ queryKey: ["contacts"] }); qc.invalidateQueries({ queryKey: ["stats"] })
        toast.success(`${c.key} created`, { description: displayName(c), action: { label: "Open chat", onClick: () => navigate(`/inbox/${c.id}`) } })
      } else {
        const t = await api("/tasks", { method: "POST", body: { ...f, contactId: f.contactId === "none" ? null : f.contactId } })
        invalidateTasks(qc)
        toast.success(`${t.key} created`, { description: t.title })
      }
      onClose()
    } catch (err: any) { toast.error(err.message) } finally { setBusy(false) }
  }

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Create</DialogTitle>
          <DialogDescription>Required fields are marked with an asterisk <span className="text-destructive">*</span></DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Work type" required>
            <SimpleSelect value={kind} onChange={(v) => setKind(v as any)} options={[
              { id: "contact", name: <span className="flex items-center gap-2"><TypeIcon kind="lead" />Lead / Contact</span> },
              { id: "task", name: <span className="flex items-center gap-2"><TypeIcon kind="task" />Task</span> },
            ]} />
          </Field>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={kind} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="space-y-4">
              {kind === "contact" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="WhatsApp number" required hint="With country code, e.g. 919876543210"><Input required autoFocus value={f.phone || ""} onChange={set("phone")} placeholder="919876543210" /></Field>
                    <Field label="Name"><Input value={f.name || ""} onChange={set("name")} placeholder="Customer name" /></Field>
                    <Field label="Email"><Input type="email" value={f.email || ""} onChange={set("email")} /></Field>
                    <Field label="Company"><Input value={f.company || ""} onChange={set("company")} /></Field>
                    <Field label="Stage"><SimpleSelect value={f.stage} onChange={set("stage")} options={STAGES.map((s) => ({ id: s.id, name: s.name }))} /></Field>
                    <Field label="Priority"><SimpleSelect value={f.priority} onChange={set("priority")} options={PRIORITIES.map((p) => ({ id: p.id, name: <PriorityIcon priority={p.id} withLabel /> }))} /></Field>
                    <Field label="Assignee"><SimpleSelect value={f.assignee} onChange={set("assignee")} options={agents.map((a) => ({ id: a, name: a }))} /></Field>
                    <Field label="Deal value (USD)"><Input type="number" value={f.value || ""} onChange={set("value")} placeholder="0" /></Field>
                  </div>
                  <Field label="Labels" hint="Comma separated"><Input value={f.tagsText || ""} onChange={set("tagsText")} placeholder="vip, demo" /></Field>
                </>
              ) : (
                <>
                  <Field label="Summary" required><Input required autoFocus value={f.title || ""} onChange={set("title")} placeholder="Follow up with customer" /></Field>
                  <Field label="Description"><Textarea value={f.description || ""} onChange={set("description")} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Status"><SimpleSelect value={f.status} onChange={set("status")} options={TASK_STATUSES.map((s) => ({ id: s.id, name: s.name }))} /></Field>
                    <Field label="Priority"><SimpleSelect value={f.priority} onChange={set("priority")} options={PRIORITIES.map((p) => ({ id: p.id, name: <PriorityIcon priority={p.id} withLabel /> }))} /></Field>
                    <Field label="Assignee"><SimpleSelect value={f.assignee} onChange={set("assignee")} options={agents.map((a) => ({ id: a, name: a }))} /></Field>
                    <Field label="Due date"><Input type="date" value={f.dueDate || ""} onChange={set("dueDate")} /></Field>
                  </div>
                  <Field label="Linked contact">
                    <SimpleSelect value={f.contactId} onChange={set("contactId")} options={[{ id: "none", name: "None" }, ...contacts.map((c) => ({ id: c.id, name: `${c.key} · ${displayName(c)}` }))]} />
                  </Field>
                </>
              )}
            </motion.div>
          </AnimatePresence>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ Contact issue view */
function ContactDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data: c } = useContact(id)
  const navigate = useNavigate()
  const ui = useUI()
  const qc = useQueryClient()
  const [title, setTitle] = useState("")
  useEffect(() => setTitle(c?.name || ""), [c?.name])

  const saveTitle = async () => {
    if (!c || title === c.name) return
    await api(`/contacts/${c.id}`, { method: "PATCH", body: { name: title } })
    qc.invalidateQueries({ queryKey: ["contacts"] }); qc.invalidateQueries({ queryKey: ["contact", c.id] })
  }
  const remove = async () => {
    if (!c || !confirm(`Delete ${c.key} and its whole conversation history?`)) return
    await api(`/contacts/${c.id}`, { method: "DELETE" })
    qc.invalidateQueries({ queryKey: ["contacts"] })
    toast.success(`${c.key} deleted`)
    onClose()
  }

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader className="flex-row items-center gap-2 space-y-0">
          <DialogTitle className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
            <TypeIcon kind="lead" /> {c?.key || "…"}
          </DialogTitle>
          <DialogDescription className="sr-only">Contact details</DialogDescription>
          <div className="mr-8 ml-auto flex gap-1">
            <Button variant="ghost" size="icon-sm" title="Delete" onClick={remove}><Trash2 /></Button>
          </div>
        </DialogHeader>
        {!c ? (
          <div className="space-y-3"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-40" /></div>
        ) : (
          <div className="grid gap-8 md:grid-cols-[1fr_320px]">
            <div className="min-w-0">
              <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                placeholder={c.profileName || c.phone} className="-ml-2 h-11 w-full rounded-md border-2 border-transparent px-2 text-2xl font-semibold outline-none hover:bg-muted focus:border-ring focus:bg-background" />
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => { onClose(); navigate(`/inbox/${c.id}`) }}><MessageSquare />Open chat</Button>
                <Button size="sm" variant="secondary" onClick={() => ui.openTemplate(c.id)}><FileText />Send template</Button>
                <Button size="sm" variant="secondary" onClick={() => ui.openCreate("task", { contactId: c.id, title: `Follow up with ${displayName(c)}` })}><Plus />Add task</Button>
              </div>

              <h3 className="mt-6 mb-2 font-semibold">Recent conversation</h3>
              <div className="space-y-1.5 rounded-lg border bg-sunken p-3">
                {!c.messages?.length && <div className="py-4 text-center text-muted-foreground">No messages yet</div>}
                {(c.messages || []).slice(-6).map((m) => (
                  <div key={m.id} className={cn("max-w-[80%] rounded-lg px-3 py-1.5 shadow-card", m.direction === "out" ? "ml-auto bg-brand-subtle" : "bg-background")}>
                    <div className="whitespace-pre-wrap break-words">{m.text}</div>
                    <div className="text-right text-[11px] text-muted-foreground">{fmtTime(m.timestamp)}</div>
                  </div>
                ))}
              </div>

              <h3 className="mt-6 mb-2 font-semibold">Tasks</h3>
              <div className="divide-y rounded-lg border">
                {c.tasks.length === 0 && <div className="px-3 py-3 text-muted-foreground">No linked tasks</div>}
                {c.tasks.map((t) => (
                  <button key={t.id} onClick={() => ui.openTask(t)} className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-sunken">
                    <TypeIcon kind="task" /><span className="text-xs font-semibold text-muted-foreground">{t.key}</span>
                    <span className={cn("flex-1 truncate", t.status === "done" && "text-muted-foreground line-through")}>{t.title}</span>
                    <PriorityIcon priority={t.priority} />
                    <Lozenge tone={TASK_STATUSES.find((s) => s.id === t.status)?.tone}>{TASK_STATUSES.find((s) => s.id === t.status)?.name}</Lozenge>
                  </button>
                ))}
              </div>

              <h3 className="mt-6 mb-2 font-semibold">Activity</h3>
              <Tabs defaultValue="notes">
                <TabsList variant="line"><TabsTrigger value="notes">Notes</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList>
                <TabsContent value="notes" className="pt-3"><NotesBox contact={c} /></TabsContent>
                <TabsContent value="history" className="space-y-2 pt-3">
                  {c.activity.length === 0 && <div className="text-muted-foreground">No history yet</div>}
                  {c.activity.map((a) => <div key={a.id} className="text-sm"><span className="text-muted-foreground">{fmtDateTime(a.at)}</span> · {a.text}</div>)}
                </TabsContent>
              </Tabs>
            </div>
            <div className="space-y-4"><LeadPanel contactId={c.id} lead={c.lead} /><ContactDetails contact={c} /></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ Task */
function TaskDialog({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const update = useUpdateTask()
  const qc = useQueryClient()
  const { data: settings } = useSettings()
  const { data: contacts = [] } = useContacts()
  const ui = useUI()
  const [f, setF] = useState<Task | null>(null)
  useEffect(() => setF(task), [task])
  if (!f) return <Dialog open={false} />
  const agents = [...new Set(["Unassigned", ...(settings?.agents || [])])]
  const patch = (p: Partial<Task>) => { setF({ ...f, ...p }); update.mutate({ id: f.id, patch: p }) }
  const remove = async () => { await api(`/tasks/${f.id}`, { method: "DELETE" }); invalidateTasks(qc); toast.success(`${f.key} deleted`); onClose() }
  const linked = contacts.find((c) => c.id === f.contactId)

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="flex-row items-center gap-2 space-y-0">
          <DialogTitle className="flex items-center gap-2 text-sm font-normal text-muted-foreground"><TypeIcon kind="task" />{f.key}</DialogTitle>
          <DialogDescription className="sr-only">Edit task</DialogDescription>
          <Button className="mr-8 ml-auto" variant="ghost" size="icon-sm" onClick={remove} title="Delete"><Trash2 /></Button>
        </DialogHeader>
        <div className="grid gap-6 md:grid-cols-[1fr_260px]">
          <div className="space-y-4">
            <input defaultValue={f.title} onBlur={(e) => e.target.value !== f.title && patch({ title: e.target.value })}
              className="-ml-2 h-11 w-full rounded-md border-2 border-transparent px-2 text-xl font-semibold outline-none hover:bg-muted focus:border-ring focus:bg-background" />
            <Field label="Description">
              <Textarea defaultValue={f.description} onBlur={(e) => e.target.value !== f.description && patch({ description: e.target.value })} placeholder="Add a description…" className="min-h-28" />
            </Field>
            {linked && (
              <button onClick={() => { onClose(); ui.openContact(linked.id) }} className="flex items-center gap-2 rounded-md border px-3 py-2 text-left transition hover:bg-sunken">
                <Link2 className="size-4 text-muted-foreground" /><TypeIcon kind="lead" /><span className="text-xs font-semibold text-muted-foreground">{linked.key}</span>{displayName(linked)}
              </button>
            )}
          </div>
          <div className="space-y-3">
            <Field label="Status"><SimpleSelect value={f.status} onChange={(v) => patch({ status: v as Task["status"] })} options={TASK_STATUSES.map((s) => ({ id: s.id, name: s.name }))} /></Field>
            <Field label="Priority"><SimpleSelect value={f.priority} onChange={(v) => patch({ priority: v })} options={PRIORITIES.map((p) => ({ id: p.id, name: <PriorityIcon priority={p.id} withLabel /> }))} /></Field>
            <Field label="Assignee"><SimpleSelect value={f.assignee} onChange={(v) => patch({ assignee: v })} options={agents.map((a) => ({ id: a, name: <span className="flex items-center gap-2"><UserAvatar name={a} size={20} tooltip={false} />{a}</span> }))} /></Field>
            <Field label="Due date"><Input type="date" value={f.dueDate || ""} onChange={(e) => patch({ dueDate: e.target.value })} /></Field>
            <Field label="Linked contact">
              <SimpleSelect value={f.contactId || "none"} onChange={(v) => patch({ contactId: v === "none" ? null : v })} options={[{ id: "none", name: "None" }, ...contacts.map((c) => ({ id: c.id, name: `${c.key} · ${displayName(c)}` }))]} />
            </Field>
            <p className="text-xs text-muted-foreground">Created {fmtDateTime(f.createdAt)}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ Template send */
function TemplateDialog({ state, onClose }: { state: { contactId: string; name?: string } | null; onClose: () => void }) {
  const { data: templates, isLoading, error } = useTemplates()
  const { data: contact } = useContact(state?.contactId)
  const send = useSendMessage(state?.contactId)
  const approved = (templates || []).filter((t) => t.status === "APPROVED")
  const [sel, setSel] = useState("")
  const [params, setParams] = useState<Record<string, string>>({})
  useEffect(() => { if (state) { setSel(state.name ? approved.find((t) => t.name === state.name)?.id || "" : ""); setParams({}) } }, [state]) // eslint-disable-line
  const t = approved.find((x) => x.id === sel)
  const keys = templateParams(t)
  const preview = templateBody(t).replace(/\{\{\s*(\w+)\s*\}\}/g, (_m: string, k: string) => params[k] || `{{${k}}}`)

  const submit = () => {
    if (!t) return
    const named = keys.some((k) => isNaN(Number(k)))
    const components = keys.length ? [{ type: "body", parameters: keys.map((k) => ({ type: "text", text: params[k] || "-", ...(named ? { parameter_name: k } : {}) })) }] : undefined
    send.mutate({ template: t.name, language: t.language, components }, { onSuccess: () => { toast.success("Template sent"); onClose() } })
  }

  return (
    <Dialog open={!!state} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send template</DialogTitle>
          <DialogDescription>To {contact ? `${displayName(contact)} (${contact.phone})` : "…"}. Templates can start a conversation outside the 24-hour window.</DialogDescription>
        </DialogHeader>
        {isLoading ? <Skeleton className="h-24" /> : error ? (
          <div className="rounded-md bg-[#ffeceb] p-3 text-sm text-[#5d1f1a]">Could not load templates: {(error as Error).message}</div>
        ) : (
          <div className="space-y-4">
            <Field label="Template" required>
              <SimpleSelect value={sel} onChange={(v) => { setSel(v); setParams({}) }} placeholder="Choose an approved template" options={approved.map((x) => ({ id: x.id, name: `${x.name} · ${x.language}` }))} />
            </Field>
            {keys.map((k) => (
              <Field key={k} label={`Variable {{${k}}}`}>
                <Input value={params[k] || ""} onChange={(e) => setParams({ ...params, [k]: e.target.value })} placeholder={k === "1" && contact ? displayName(contact) : ""} />
              </Field>
            ))}
            <AnimatePresence>
              {t && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg bg-[#e7f0e6] p-3">
                  <div className="max-w-[90%] rounded-lg bg-white px-3 py-2 text-sm whitespace-pre-wrap shadow-card">{preview || <i className="text-muted-foreground">No body text</i>}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!t || send.isPending}><Send />{send.isPending ? "Sending…" : "Send"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

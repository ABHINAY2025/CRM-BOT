import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import { AlertTriangle, Bot, FlaskConical, Pencil, Plus, RotateCcw, Save, Send, Sparkles, Trash2, UserRound, Zap } from "lucide-react"
import { toast } from "sonner"
import { api, useAiInfo, useRules, useSettings, type Rule, type Settings } from "@/lib/api"
import { STAGES } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { EmptyState, Lozenge, PageHeader, StageLozenge } from "@/components/crm/bits"

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function Section({ title, desc, children, action }: { title: string; desc?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border bg-card">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="flex-1"><h2 className="font-semibold">{title}</h2>{desc && <p className="text-xs text-muted-foreground">{desc}</p>}</div>{action}
      </div>
      <div className="p-4">{children}</div>
    </motion.section>
  )
}

function ToggleRow({ title, desc, checked, onChange, children }: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void; children?: React.ReactNode }) {
  return (
    <div className="border-b border-muted py-3 first:pt-0 last:border-0 last:pb-0">
      <div className="flex items-start gap-3">
        <div className="flex-1"><div className="font-medium">{title}</div><div className="text-xs text-muted-foreground">{desc}</div></div>
        <Switch checked={checked} onCheckedChange={onChange} />
      </div>
      <AnimatePresence initial={false}>
        {checked && children && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function RuleDialog({ rule, onClose }: { rule: Partial<Rule> | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [f, setF] = useState<any>({})
  useEffect(() => { if (rule) setF({ match: "contains", ...rule, setStage: rule.setStage || "none", kw: (rule.keywords || []).join(", "), btn: (rule.buttons || []).join(", ") }) }, [rule])
  const save = async () => {
    const body = { name: f.name, match: f.match, reply: f.reply, addTag: f.addTag || "", setStage: f.setStage === "none" ? "" : f.setStage,
      keywords: String(f.kw || "").split(",").map((s) => s.trim()).filter(Boolean), buttons: String(f.btn || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 3) }
    if (!body.keywords.length) return toast.error("Add at least one keyword")
    try {
      await api(rule?.id ? `/rules/${rule.id}` : "/rules", { method: rule?.id ? "PATCH" : "POST", body })
      qc.invalidateQueries({ queryKey: ["rules"] }); toast.success("Rule saved"); onClose()
    } catch (e: any) { toast.error(e.message) }
  }
  return (
    <Dialog open={!!rule} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{rule?.id ? "Edit rule" : "New keyword rule"}</DialogTitle><DialogDescription>When an incoming message matches, the bot replies and can update the lead.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5"><Label className="text-xs text-subtle">Rule name</Label><Input value={f.name || ""} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Pricing question" /></div>
          <div className="grid grid-cols-[140px_1fr] gap-3">
            <div className="space-y-1.5"><Label className="text-xs text-subtle">Match</Label>
              <Select value={f.match} onValueChange={(v) => setF({ ...f, match: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="contains">Contains</SelectItem><SelectItem value="exact">Is exactly</SelectItem><SelectItem value="starts">Starts with</SelectItem></SelectContent></Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs text-subtle">Keywords (comma separated)</Label><Input value={f.kw || ""} onChange={(e) => setF({ ...f, kw: e.target.value })} placeholder="price, cost, quote" /></div>
          </div>
          <div className="space-y-1.5"><Label className="text-xs text-subtle">Bot reply</Label><Textarea value={f.reply || ""} onChange={(e) => setF({ ...f, reply: e.target.value })} className="min-h-24" /></div>
          <div className="space-y-1.5"><Label className="text-xs text-subtle">Reply buttons (optional, max 3, comma separated)</Label><Input value={f.btn || ""} onChange={(e) => setF({ ...f, btn: e.target.value })} placeholder="Talk to sales, See catalog" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs text-subtle">Then move lead to</Label>
              <Select value={f.setStage} onValueChange={(v) => setF({ ...f, setStage: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">Don't change</SelectItem>{STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="space-y-1.5"><Label className="text-xs text-subtle">And add label</Label><Input value={f.addTag || ""} onChange={(e) => setF({ ...f, addTag: e.target.value.toLowerCase() })} placeholder="pricing" /></div>
          </div>
        </div>
        <DialogFooter><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save rule</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function Automations() {
  const qc = useQueryClient()
  const { data: settings } = useSettings()
  const { data: rules = [] } = useRules()
  const [s, setS] = useState<Settings | null>(null)
  const [quick, setQuick] = useState("")
  const [edit, setEdit] = useState<Partial<Rule> | null>(null)
  const [test, setTest] = useState("")
  const [result, setResult] = useState<{ matched: boolean; rule?: Rule } | null>(null)
  useEffect(() => { if (settings) { setS(settings); setQuick((settings.quickReplies || []).join("\n")) } }, [settings])
  const dirty = s && settings && (JSON.stringify(s) !== JSON.stringify(settings) || quick !== (settings.quickReplies || []).join("\n"))

  const save = async () => {
    await api("/settings", { method: "PUT", body: { ...s, quickReplies: quick.split("\n").map((x) => x.trim()).filter(Boolean) } })
    qc.invalidateQueries({ queryKey: ["settings"] }); toast.success("Automation settings saved")
  }
  const patchRule = async (r: Rule, patch: Partial<Rule>) => {
    qc.setQueryData<Rule[]>(["rules"], (l) => l?.map((x) => (x.id === r.id ? { ...x, ...patch } : x)))
    await api(`/rules/${r.id}`, { method: "PATCH", body: patch }); qc.invalidateQueries({ queryKey: ["rules"] })
  }
  const delRule = async (r: Rule) => { await api(`/rules/${r.id}`, { method: "DELETE" }); qc.invalidateQueries({ queryKey: ["rules"] }); toast.success("Rule deleted") }
  const runTest = async () => setResult(await api("/rules/test", { method: "POST", body: { text: test } }))

  if (!s) return null
  return (
    <div className="px-6 py-5 lg:px-10">
      <PageHeader crumbs={["Automation"]} title="Fallback rules" actions={
        <AnimatePresence>{dirty && <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}><Button onClick={save}><Save />Save changes</Button></motion.div>}</AnimatePresence>
      } />
      <div className="mb-6 flex items-center gap-2 rounded-lg bg-brand-subtle p-3 text-[13px] text-[#09326c]"><Sparkles className="size-4 shrink-0" />GreenBuddy (Claude) answers customers. These keyword rules and welcome/away messages are the fallback when GreenBuddy is switched off or unavailable — configure GreenBuddy on the <a href="/bot" className="font-semibold underline">GreenBuddy bot</a> page.</div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <Section title="Keyword rules" desc="First matching enabled rule wins. Runs after welcome / away messages." action={<Button size="sm" onClick={() => setEdit({})}><Plus />Add rule</Button>}>
            {rules.length === 0 ? <EmptyState icon={Zap} title="No rules yet">Create a rule to auto-reply to common questions.</EmptyState> : (
              <div className="-m-4 overflow-auto">
                <table className="w-full">
                  <thead><tr className="border-b-2 text-left text-xs text-subtle">{["On", "Rule", "When message…", "Bot reply", "Then", "Hits", ""].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                  <tbody>
                    <AnimatePresence initial={false}>
                      {rules.map((r) => (
                        <motion.tr key={r.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={cn("group border-b border-muted align-top hover:bg-sunken", !r.enabled && "opacity-60")}>
                          <td className="px-3 py-2.5"><Switch checked={r.enabled} onCheckedChange={(v) => patchRule(r, { enabled: v })} /></td>
                          <td className="px-3 py-2.5 font-medium">{r.name}</td>
                          <td className="px-3 py-2.5"><div className="mb-1 text-xs text-muted-foreground">{r.match === "exact" ? "is exactly" : r.match === "starts" ? "starts with" : "contains"}</div>
                            <div className="flex flex-wrap gap-1">{r.keywords.map((k) => <span key={k} className="rounded-[3px] bg-brand-subtle px-1.5 text-xs font-medium text-brand">{k}</span>)}</div></td>
                          <td className="max-w-64 px-3 py-2.5 text-[13px] text-subtle"><div className="line-clamp-2">{r.reply}</div>{r.buttons?.length ? <div className="mt-1 text-xs text-muted-foreground">+ {r.buttons.length} buttons</div> : null}</td>
                          <td className="space-y-1 px-3 py-2.5">{r.setStage && <StageLozenge stage={r.setStage} />}{r.addTag && <div><Lozenge tone="teal">+{r.addTag}</Lozenge></div>}</td>
                          <td className="px-3 py-2.5 tabular-nums">{r.hits}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <Button size="icon-sm" variant="ghost" onClick={() => setEdit(r)}><Pencil /></Button>
                            <Button size="icon-sm" variant="ghost" onClick={() => delRule(r)}><Trash2 /></Button>
                          </td>
                        </motion.tr>
                      ))}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="Test the bot" desc="Type a customer message to see which rule would fire.">
            <form onSubmit={(e) => { e.preventDefault(); runTest() }} className="flex gap-2">
              <Input value={test} onChange={(e) => { setTest(e.target.value); setResult(null) }} placeholder="e.g. what is the price?" />
              <Button type="submit" variant="secondary"><FlaskConical />Test</Button>
            </form>
            <AnimatePresence mode="wait">
              {result && (
                <motion.div key={String(result.matched) + result.rule?.id} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className={cn("mt-3 rounded-md px-3 py-2.5 text-[13px]", result.matched ? "bg-[#dcfff1] text-[#164b35]" : "bg-muted text-subtle")}>
                  {result.matched ? <><b>Matched “{result.rule!.name}”</b> → {result.rule!.reply}</> : "No rule matches. The message will wait for an agent."}
                </motion.div>
              )}
            </AnimatePresence>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Bot behaviour" desc="Automatic replies sent from your WhatsApp number.">
            <ToggleRow title="Bot enabled" desc="Master switch for all automatic replies" checked={s.botEnabled} onChange={(v) => setS({ ...s, botEnabled: v })} />
            <ToggleRow title="Welcome message" desc="Sent once to brand-new contacts" checked={s.welcomeEnabled} onChange={(v) => setS({ ...s, welcomeEnabled: v })}>
              <Textarea value={s.welcomeMessage} onChange={(e) => setS({ ...s, welcomeMessage: e.target.value })} />
            </ToggleRow>
            <ToggleRow title="Away message" desc="Sent outside business hours (max once per 12h per contact)" checked={s.awayEnabled} onChange={(v) => setS({ ...s, awayEnabled: v })}>
              <Textarea value={s.awayMessage} onChange={(e) => setS({ ...s, awayMessage: e.target.value })} />
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Input type="time" className="w-32" value={s.businessHours.start} onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, start: e.target.value } })} />
                to <Input type="time" className="w-32" value={s.businessHours.end} onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, end: e.target.value } })} />
              </div>
              <div className="mt-2 flex gap-1">
                {DAYS.map((d, i) => {
                  const on = s.businessHours.days.includes(i)
                  return <motion.button whileTap={{ scale: 0.9 }} key={d} onClick={() => setS({ ...s, businessHours: { ...s.businessHours, days: on ? s.businessHours.days.filter((x) => x !== i) : [...s.businessHours.days, i].sort() } })}
                    className={cn("h-8 w-11 rounded-md text-xs font-semibold transition-colors", on ? "bg-brand text-white" : "bg-muted text-subtle hover:bg-[#dcdfe4]")}>{d}</motion.button>
                })}
              </div>
            </ToggleRow>
            <ToggleRow title="Auto mark as read" desc="Show blue ticks to customers as soon as messages arrive" checked={s.autoMarkRead} onChange={(v) => setS({ ...s, autoMarkRead: v })} />
          </Section>
          <Section title="Quick replies" desc="Saved replies for agents in the Inbox (one per line).">
            <Textarea value={quick} onChange={(e) => setQuick(e.target.value)} className="min-h-32" placeholder={"Thanks for reaching out!\nCan you share your order number?"} />
          </Section>
          <div className="flex items-center gap-2 rounded-lg bg-brand-subtle p-3 text-[13px] text-[#09326c]"><Bot className="size-4 shrink-0" />Pause the bot for a single customer from the Bot replies toggle in their details panel.</div>
        </div>
      </div>
      <RuleDialog rule={edit} onClose={() => setEdit(null)} />
    </div>
  )
}

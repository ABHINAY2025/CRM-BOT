import { useEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "motion/react"
import {
  ArrowRight, Bot, Brain, CalendarCheck, CheckCircle2, CircleDashed, Cog, Flame, GitBranch, Inbox, ListChecks, MessageCircle, Plus, RotateCcw, Save, Send,
  ShieldCheck, Sparkles, Trash2, Webhook,
} from "lucide-react"
import { toast } from "sonner"
import { api, useAiInfo, useBotSettings, useBotSpec, useSettings, type BotSettings, type BotSpec, type Faq, type Lead } from "@/lib/api"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Lozenge, PageHeader } from "@/components/crm/bits"
import { ServiceLozenge, TempChip } from "@/components/crm/lead-panel"

/* ------------------------------------------------------------------ Architecture */
const PIPELINE = [
  { icon: MessageCircle, title: "WhatsApp", text: "Customer messages, taps a button or shares a map pin", tone: "#22a06b" },
  { icon: Webhook, title: "Webhook", text: "Meta → ngrok tunnel → /webhook, de-duplicated", tone: "#1d7afc" },
  { icon: Inbox, title: "Lead record", text: "One record per customer — created at the name, updated every answer", tone: "#6e5dc6" },
  { icon: Brain, title: "GreenBuddy · Claude", text: "Spec prompt + lead state → reply, options, extracted fields", tone: "#e06c00" },
  { icon: Cog, title: "Rules engine", text: "Status, tags, priority, RAS fit, tasks, handover — deterministic", tone: "#c9372c" },
  { icon: Send, title: "Reply + CRM", text: "Buttons / list on WhatsApp · tasks, hot alerts & handover note in the CRM", tone: "#206a83" },
]

function Pipeline() {
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {PIPELINE.map((p, i) => (
        <motion.div key={p.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }} className="relative">
          <div className="lift h-full rounded-lg border bg-card p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-md text-white" style={{ background: p.tone }}><p.icon className="size-4" /></span>
              <span className="text-xs font-bold text-muted-foreground">{i + 1}</span>
            </div>
            <div className="font-semibold">{p.title}</div>
            <div className="mt-0.5 text-xs leading-4 text-muted-foreground">{p.text}</div>
          </div>
          {i < PIPELINE.length - 1 && (
            <motion.div className="absolute top-1/2 -right-3 z-10 hidden -translate-y-1/2 text-muted-foreground xl:block" animate={{ x: [0, 3, 0] }} transition={{ repeat: Infinity, duration: 1.6, delay: i * 0.2 }}>
              <ArrowRight className="size-4" />
            </motion.div>
          )}
        </motion.div>
      ))}
    </div>
  )
}

function Journey({ spec, id, accent, extra }: { spec: BotSpec; id: string; accent: string; extra?: React.ReactNode }) {
  const j = spec.journeys[id]
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 rounded-t-lg border-b px-3 py-2" style={{ background: `${accent}14` }}>
        <span className="size-2 rounded-full" style={{ background: accent }} /><span className="text-[13px] font-semibold">{j.label}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">{j.required.length} fields</span>
      </div>
      <ol className="space-y-0.5 px-3 py-2">
        {j.required.map((k, i) => (
          <li key={k} className="flex items-start gap-2 text-[13px]" title={spec.fields[k]?.ask}>
            <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-bold text-subtle">{i + 1}</span>
            <span>{spec.fields[k]?.label}{spec.fields[k]?.options && <span className="text-muted-foreground"> · {spec.fields[k]!.options!.length} options</span>}</span>
          </li>
        ))}
      </ol>
      {extra && <div className="border-t px-3 py-2 text-xs text-muted-foreground">{extra}</div>}
    </div>
  )
}

function Architecture({ spec, b }: { spec: BotSpec; b?: BotSettings }) {
  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-1 font-semibold">How a message flows</h2>
        <p className="mb-3 text-[13px] text-muted-foreground">Claude handles the conversation and understanding (informal English, Telugu/Hindi in English letters, several answers in one message). Anything the spec defines exactly — scoring, tags, statuses, tasks — is done by code, so it is consistent and auditable.</p>
        <Pipeline />
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Customer journeys</h2>
        <div className="mb-3 rounded-lg border bg-sunken p-3">
          <div className="mb-2 text-xs font-semibold text-subtle">1 · Greeting & service menu (everyone) → 2 · Name (phone already known on WhatsApp)</div>
          <div className="flex flex-wrap gap-1.5">{spec.services.map((s) => <ServiceLozenge key={s.id} service={s.id} />)}</div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Journey spec={spec} id="terrace" accent="#22a06b" extra={<>Summary → <b>Site visit</b> (₹{b?.siteVisitFee ?? 500} fee consent → pin → shared) · Call back · Past projects · Exploring</>} />
          <div className="space-y-3">
            <Journey spec={spec} id="hydro_home" accent="#1d9aaa" extra="Same next steps & site visit flow as terrace" />
            <Journey spec={spec} id="hydro_commercial" accent="#206a83" extra={<>Priority <b>Hot / Warm / Nurture</b> · Hot → instant alert · next: project team call</>} />
          </div>
          <Journey spec={spec} id="ras" accent="#1d7afc" extra={<>Signals → tags · <b>Fit</b> Strong / Needs guidance / Not ready → Hot / Warm / Cold · next: <b>Expert call</b> (time → language → pin → shared)</>} />
          <div className="space-y-3">
            <Journey spec={spec} id="hydro_training" accent="#6e5dc6" extra="Training Enquiry task" />
            <Journey spec={spec} id="hydro_visit" accent="#6e5dc6" extra="Farm Visit Request task — never confirm a date" />
            <Journey spec={spec} id="generic" accent="#8590a2" extra="Microgreens · Polyhouse · Something else → call back" />
            <Journey spec={spec} id="support" accent="#943d73" extra="Support Request task + team notified" />
          </div>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex items-center gap-2 font-semibold"><GitBranch className="size-4 text-brand" />Lead status</div>
          <div className="flex flex-wrap items-center gap-1 text-xs">
            {spec.statuses.slice(0, 5).map((s, i) => <span key={s.id} className="flex items-center gap-1"><Lozenge tone={s.tone}>{s.name}</Lozenge>{i < 4 && <ArrowRight className="size-3 text-muted-foreground" />}</span>)}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Started when the name is captured · Qualified when every journey field is known · Visit / call requested once shared with the team · Handed to sales for call-backs, project team, subsidy. Sales sets Won / Lost.</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex items-center gap-2 font-semibold"><Flame className="size-4 text-[#c9372c]" />Priority rules</div>
          <ul className="space-y-1 text-xs">
            <li><TempChip temp="Hot" /> Hydro: funds ready + within 3 months + own/joint decision · RAS: Strong fit</li>
            <li><TempChip temp="Warm" /> Arranging funds or 3–6 months · RAS: needs guidance</li>
            <li><TempChip temp="Nurture" /> No budget or just researching</li>
            <li><TempChip temp="Cold" /> RAS: no land and no waste-water outlet, or only exploring</li>
          </ul>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-[#1f845a]" />Guardrails</div>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            <li>Answers only from the approved list; anything else → team task</li>
            <li>Never: prices, ROI, yields, subsidy %, "booked", dates, grow bags</li>
            <li>Fee only after "Book a site visit"; tags & fit never shown to customers</li>
            <li>After-hours notice once a day, then qualification continues</li>
          </ul>
        </div>
      </section>

      <section className="rounded-lg border bg-card p-3">
        <div className="mb-2 font-semibold">Tags</div>
        <div className="grid gap-3 md:grid-cols-3">
          {(["shared", "hydroponics", "ras"] as const).map((g) => (
            <div key={g}><div className="mb-1 text-xs font-semibold text-subtle capitalize">{g === "shared" ? "All services" : g === "ras" ? "RAS only" : "Hydroponics"}</div>
              <div className="flex flex-wrap gap-1">{spec.tags[g].map((t) => <span key={t} className="rounded-[3px] bg-[#e9f2ff] px-1.5 text-[11px] leading-[18px] font-semibold text-[#0055cc]">{t}</span>)}</div></div>
          ))}
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ Simulator */
type SimMsg = { from: "customer" | "bot"; text: string; options?: string[] }
type SimResult = { reply: string; options: string[]; lead: Lead; missing: string[]; effects: { tasks: { type: string; note: string }[]; handover: boolean; hot: boolean }; handover: string | null }

function Simulator({ spec }: { spec: BotSpec }) {
  const [session, setSession] = useState(() => Math.random().toString(36).slice(2))
  const [msgs, setMsgs] = useState<SimMsg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [state, setState] = useState<SimResult | null>(null)
  const [tasks, setTasks] = useState<string[]>([])
  const [afterHours, setAfterHours] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" }) }, [msgs.length, busy])

  const send = async (text: string) => {
    if (!text.trim() || busy) return
    setMsgs((m) => [...m, { from: "customer", text }]); setInput(""); setBusy(true)
    try {
      const r = await api<SimResult>("/bot/simulate", { method: "POST", body: { session, text, afterHours } })
      setMsgs((m) => [...m, { from: "bot", text: r.reply, options: r.options }])
      setState(r)
      if (r.effects.tasks.length) setTasks((t) => [...t, ...r.effects.tasks.map((x) => x.type)])
      if (r.effects.hot) toast("🔥 Hot lead detected", { description: "Sales would be alerted right away" })
      if (r.effects.handover) toast.success("🤝 Handover note posted to sales")
    } catch (e: any) { toast.error(e.message); setMsgs((m) => m.slice(0, -1)) } finally { setBusy(false) }
  }
  const reset = async () => { await api("/bot/simulate/reset", { method: "POST", body: { session } }).catch(() => {}); setSession(Math.random().toString(36).slice(2)); setMsgs([]); setState(null); setTasks([]) }
  const lead = state?.lead
  const journey = lead ? spec.journeys[lead.journey] : null
  const lastOptions = [...msgs].reverse().find((m) => m.from === "bot")?.options || []
  const samples = ["Hi", "Hi, I'm Ravi. I have a 600 sqft terrace in Kukatpally, want to grow vegetables.", "I want to start a hydroponic farm near Shamshabad", "Hi, I'm Anil. I own 2 acres near Nalgonda with a borewell, and paddy fields all around. I want to start tilapia with my own money, around 20 tons a year.", "naa terrace 500 sqft undi, vegetables pettali"]

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <div className="flex h-[640px] flex-col overflow-hidden rounded-2xl border-8 border-[#172b4d] bg-[#efeae2] shadow-raised">
        <div className="flex items-center gap-2 bg-[#075e54] px-3 py-2.5 text-white">
          <span className="grid size-8 place-items-center rounded-full bg-white/20"><Sparkles className="size-4" /></span>
          <div className="flex-1"><div className="text-sm font-semibold">GreenBuddy · Venonto</div><div className="text-[11px] opacity-80">{busy ? "typing…" : "test chat — nothing is sent on WhatsApp"}</div></div>
          <button onClick={reset} title="Restart" className="rounded-full p-1.5 hover:bg-white/15"><RotateCcw className="size-4" /></button>
        </div>
        <div ref={ref} className="scrollbar-thin flex flex-1 flex-col gap-1.5 overflow-y-auto p-3">
          {msgs.length === 0 && (
            <div className="m-auto w-full space-y-1.5">
              <p className="mb-2 text-center text-xs text-muted-foreground">Try a customer message:</p>
              {samples.map((s) => <button key={s} onClick={() => send(s)} className="block w-full rounded-lg bg-white/80 px-3 py-2 text-left text-xs shadow-card transition hover:bg-white">{s}</button>)}
            </div>
          )}
          <AnimatePresence initial={false}>
            {msgs.map((m, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} className={cn("max-w-[85%]", m.from === "customer" ? "self-end" : "self-start")}>
                <div className={cn("rounded-lg px-2.5 py-1.5 text-[13px] whitespace-pre-wrap shadow-card", m.from === "customer" ? "rounded-tr-sm bg-[#d9fdd3]" : "rounded-tl-sm bg-white")}>{m.text.replace(/\*(.+?)\*/g, "$1")}</div>
                {m.options && m.options.length > 0 && <div className="mt-1 space-y-1">{m.options.map((o) => <div key={o} className="rounded-lg bg-white px-2.5 py-1 text-center text-[12px] font-medium text-[#027eb5] shadow-card">{o}</div>)}</div>}
              </motion.div>
            ))}
          </AnimatePresence>
          {busy && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="self-start rounded-lg bg-white px-3 py-2 text-xs text-muted-foreground shadow-card">typing…</motion.div>}
        </div>
        {lastOptions.length > 0 && !busy && (
          <div className="flex flex-wrap gap-1 border-t border-black/5 bg-white/60 p-2">
            {lastOptions.map((o) => <button key={o} onClick={() => send(o)} className="rounded-full border border-[#027eb5]/30 bg-white px-2.5 py-1 text-[12px] text-[#027eb5] transition hover:bg-[#e9f2ff]">{o}</button>)}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="flex gap-2 bg-[#f0f2f5] p-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type as the customer…" className="bg-white" />
          <Button type="submit" size="icon" disabled={busy || !input.trim()}><Send /></Button>
        </form>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
          <span className="font-semibold">Live lead record</span>
          {lead ? <><ServiceLozenge service={lead.service} /><Lozenge tone={spec.statuses.find((s) => s.id === lead.status)?.tone}>{spec.statuses.find((s) => s.id === lead.status)?.name}</Lozenge><TempChip temp={lead.temperature} />{lead.fit && <Lozenge tone="purple">Fit: {lead.fit}</Lozenge>}</> : <span className="text-[13px] text-muted-foreground">starts with the first message</span>}
          <label className="ml-auto flex items-center gap-2 text-xs text-subtle"><Switch checked={afterHours} onCheckedChange={setAfterHours} />Pretend after hours</label>
        </div>
        {!lead ? <div className="grid h-80 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">Send a message to see GreenBuddy fill the lead record.</div> : (
          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-lg border bg-card p-3">
              <div className="mb-2 text-xs font-semibold text-subtle">{journey?.label} · fields</div>
              {(journey?.required || []).map((k) => (
                <motion.div layout key={k} className="flex items-center gap-2 py-1 text-[13px]">
                  {lead.fields[k] ? <CheckCircle2 className="size-3.5 shrink-0 text-[#22a06b]" /> : <CircleDashed className="size-3.5 shrink-0 text-[#e2b203]" />}
                  <span className="w-32 shrink-0 text-xs font-semibold text-subtle">{spec.fields[k]?.label}</span>
                  <AnimatePresence mode="wait"><motion.span key={lead.fields[k] || "-"} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className={cn(!lead.fields[k] && "text-muted-foreground")}>{lead.fields[k] || "missing"}</motion.span></AnimatePresence>
                </motion.div>
              ))}
              {Object.entries(lead.fields).filter(([k, v]) => v && !journey?.required.includes(k)).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 py-1 text-[13px]"><span className="size-3.5" /><span className="w-32 shrink-0 text-xs font-semibold text-subtle">{spec.fields[k]?.label || k}</span>{v}</div>
              ))}
              {lead.mapPin && <div className="mt-1 text-xs text-brand">📍 Map pin shared</div>}
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border bg-card p-3">
                <div className="mb-1.5 text-xs font-semibold text-subtle">Tags</div>
                <div className="flex flex-wrap gap-1">{lead.tags.length ? lead.tags.map((t) => <motion.span key={t} initial={{ scale: 0.7 }} animate={{ scale: 1 }} className="rounded-[3px] bg-[#e9f2ff] px-1.5 text-[11px] leading-[18px] font-semibold text-[#0055cc]">{t}</motion.span>) : <span className="text-xs text-muted-foreground">none yet</span>}</div>
                <div className="mt-3 mb-1.5 text-xs font-semibold text-subtle">Next step</div><div className="text-[13px]">{lead.nextStep || "—"}</div>
                <div className="mt-3 mb-1.5 text-xs font-semibold text-subtle">Tasks that would be created</div>
                <div className="flex flex-wrap gap-1">{tasks.length ? tasks.map((t, i) => <Lozenge key={i} tone="purple"><ListChecks className="mr-0.5 size-3" />{t}</Lozenge>) : <span className="text-xs text-muted-foreground">none yet</span>}</div>
              </div>
              {state?.handover && <motion.pre initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="scrollbar-thin max-h-72 overflow-auto rounded-lg border border-[#c6edfb] bg-[#e7f9ff] p-3 text-[11.5px] whitespace-pre-wrap text-[#164b5b]">{state.handover}</motion.pre>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Approved answers */
function Answers({ b }: { b: BotSettings }) {
  const qc = useQueryClient()
  const [faq, setFaq] = useState<Faq[]>(b.faq)
  const [filter, setFilter] = useState("all-services")
  useEffect(() => setFaq(b.faq), [b.faq])
  const dirty = JSON.stringify(faq) !== JSON.stringify(b.faq)
  const save = async () => { await api("/bot/settings", { method: "PUT", body: { faq } }); qc.invalidateQueries({ queryKey: ["botsettings"] }); toast.success("Approved answers saved — GreenBuddy uses them on the next message") }
  const shown = faq.map((f, i) => ({ f, i })).filter(({ f }) => filter === "all-services" || f.service === filter)
  const set = (i: number, patch: Partial<Faq>) => setFaq(faq.map((f, j) => (j === i ? { ...f, ...patch } : f)))
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-auto max-w-2xl text-[13px] text-muted-foreground">GreenBuddy answers <b>only</b> from this list; anything else goes to the team as a task. Text in brackets is an instruction for the bot, not said to the customer.</p>
        <Select value={filter} onValueChange={setFilter}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all-services">All</SelectItem><SelectItem value="all">General</SelectItem><SelectItem value="terrace">Terrace</SelectItem><SelectItem value="hydroponics">Hydroponics</SelectItem><SelectItem value="ras">RAS</SelectItem></SelectContent></Select>
        <Button variant="secondary" onClick={() => setFaq([...faq, { service: filter === "all-services" ? "all" : filter, q: "", a: "" }])}><Plus />Add answer</Button>
        <AnimatePresence>{dirty && <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}><Button onClick={save}><Save />Save</Button></motion.div>}</AnimatePresence>
      </div>
      <div className="divide-y rounded-lg border">
        {shown.map(({ f, i }) => (
          <motion.div layout key={i} className="grid gap-2 p-3 md:grid-cols-[130px_1fr_1.6fr_auto]">
            <Select value={f.service} onValueChange={(v) => set(i, { service: v })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">General</SelectItem><SelectItem value="terrace">Terrace</SelectItem><SelectItem value="hydroponics">Hydroponics</SelectItem><SelectItem value="ras">RAS</SelectItem></SelectContent></Select>
            <Input value={f.q} onChange={(e) => set(i, { q: e.target.value })} placeholder="Customer asks…" />
            <Textarea value={f.a} onChange={(e) => set(i, { a: e.target.value })} placeholder="GreenBuddy says…" className="min-h-9" />
            <Button variant="ghost" size="icon" onClick={() => setFaq(faq.filter((_, j) => j !== i))}><Trash2 /></Button>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Settings */
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
function BotSettingsTab({ b }: { b: BotSettings }) {
  const qc = useQueryClient()
  const { data: settings } = useSettings()
  const [f, setF] = useState(b)
  const [g, setG] = useState({ aiEnabled: true, aiPersona: "", aiFallbackMessage: "", agents: [] as string[], quick: "" })
  const [newAgent, setNewAgent] = useState("")
  useEffect(() => setF(b), [b])
  useEffect(() => {
    if (settings) setG({
      aiEnabled: settings.aiEnabled, aiPersona: settings.aiPersona || "", aiFallbackMessage: (settings as any).aiFallbackMessage || "",
      agents: (settings.agents || []).filter((a) => a !== "Unassigned"), quick: (settings.quickReplies || []).join("\n"),
    })
  }, [settings])
  const save = async () => {
    await api("/bot/settings", { method: "PUT", body: { ...f, faq: undefined } })
    await api("/settings", { method: "PUT", body: {
      aiEnabled: g.aiEnabled, aiPersona: g.aiPersona, aiFallbackMessage: g.aiFallbackMessage,
      agents: ["Unassigned", ...g.agents], quickReplies: g.quick.split("\n").map((x) => x.trim()).filter(Boolean),
    } })
    qc.invalidateQueries({ queryKey: ["botsettings"] }); qc.invalidateQueries({ queryKey: ["settings"] })
    toast.success("Settings saved")
  }
  const addAgent = () => { const n = newAgent.trim(); if (n && !g.agents.includes(n)) setG({ ...g, agents: [...g.agents, n] }); setNewAgent("") }
  const F = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => <div className="space-y-1.5"><Label className="text-xs text-subtle">{label}</Label>{children}{hint && <p className="text-xs text-muted-foreground">{hint}</p>}</div>
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="flex-1"><div className="font-semibold">GreenBuddy answers customers</div><div className="text-xs text-muted-foreground">Turn off to answer every chat yourself from the Inbox.</div></div>
          <Switch checked={g.aiEnabled} onCheckedChange={(v) => setG({ ...g, aiEnabled: v })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <F label="Assistant name"><Input value={f.botName} onChange={(e) => setF({ ...f, botName: e.target.value })} /></F>
          <F label="Company name"><Input value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></F>
          <F label="Reply language"><Input value={f.replyLanguage} onChange={(e) => setF({ ...f, replyLanguage: e.target.value })} /></F>
          <F label="Site visit city"><Input value={f.siteVisitCity} onChange={(e) => setF({ ...f, siteVisitCity: e.target.value })} /></F>
          <F label="Site visit fee (₹)"><Input type="number" value={f.siteVisitFee} onChange={(e) => setF({ ...f, siteVisitFee: Number(e.target.value) })} /></F>
        </div>
        <F label="Working hours (IST)" hint="Outside these hours GreenBuddy tells customers when your team will reply, then keeps helping.">
          <div className="flex items-center gap-2"><Input type="time" className="w-32" value={f.workStart} onChange={(e) => setF({ ...f, workStart: e.target.value })} />to<Input type="time" className="w-32" value={f.workEnd} onChange={(e) => setF({ ...f, workEnd: e.target.value })} /></div>
          <div className="mt-2 flex gap-1">{DAYS.map((d, i) => { const on = f.workDays.includes(i); return <motion.button whileTap={{ scale: 0.9 }} key={d} onClick={() => setF({ ...f, workDays: on ? f.workDays.filter((x) => x !== i) : [...f.workDays, i].sort() })} className={cn("h-8 w-11 rounded-md text-xs font-semibold", on ? "bg-brand text-white" : "bg-muted text-subtle")}>{d}</motion.button> })}</div>
        </F>
        <F label="Special instructions for GreenBuddy" hint="Optional. Plain words, e.g. offers to mention or topics to avoid."><Textarea value={g.aiPersona} onChange={(e) => setG({ ...g, aiPersona: e.target.value })} className="min-h-24" placeholder="e.g. Mention our Diwali offer only if the customer asks about discounts." /></F>
        <F label="Message if the assistant is unavailable"><Input value={g.aiFallbackMessage} onChange={(e) => setG({ ...g, aiFallbackMessage: e.target.value })} /></F>
      </div>
      <div className="space-y-4 rounded-lg border bg-card p-4">
        <F label="Team members" hint="People you can assign leads and tasks to.">
          <div className="flex flex-wrap gap-2">
            <AnimatePresence initial={false}>
              {g.agents.map((a) => (
                <motion.span key={a} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} className="flex items-center gap-1.5 rounded-full border py-1 pr-1.5 pl-3 text-[13px]">
                  {a}<button onClick={() => setG({ ...g, agents: g.agents.filter((x) => x !== a) })} className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"><Trash2 className="size-3.5" /></button>
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); addAgent() }} className="mt-2 flex gap-2"><Input value={newAgent} onChange={(e) => setNewAgent(e.target.value)} placeholder="Teammate name" className="max-w-64" /><Button type="submit" variant="secondary"><Plus />Add</Button></form>
        </F>
        <F label="Quick replies" hint="Saved answers your team can insert in the Inbox — one per line."><Textarea value={g.quick} onChange={(e) => setG({ ...g, quick: e.target.value })} className="min-h-36" placeholder={"Thanks for reaching out!\nOur team will call you within 1 working day."} /></F>
        <Button onClick={save}><Save />Save settings</Button>
      </div>
    </div>
  )
}

export default function BotPage() {
  const { data: spec } = useBotSpec()
  const { data: b } = useBotSettings()
  return (
    <div className="px-6 py-5 lg:px-10">
      <PageHeader crumbs={["GreenBuddy"]} title={<span className="flex items-center gap-2"><Bot className="size-6 text-[#1f845a]" />GreenBuddy</span>} actions={<span className="text-[13px] text-muted-foreground">Your WhatsApp assistant</span>} />
      {!spec || !b ? <Skeleton className="h-96" /> : (
        <Tabs defaultValue="test">
          <TabsList variant="line" className="mb-4"><TabsTrigger value="test">Test chat</TabsTrigger><TabsTrigger value="answers">Approved answers</TabsTrigger><TabsTrigger value="settings">Settings</TabsTrigger></TabsList>
          <TabsContent value="test"><Simulator spec={spec} /></TabsContent>
          <TabsContent value="answers"><Answers b={b} /></TabsContent>
          <TabsContent value="settings"><BotSettingsTab b={b} /></TabsContent>
        </Tabs>
      )}
    </div>
  )
}

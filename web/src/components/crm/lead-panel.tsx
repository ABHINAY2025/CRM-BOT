import { motion } from "motion/react"
import { CheckCircle2, CircleDashed, Flame, MapPin, Sprout } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api, useBotSpec, type Lead } from "@/lib/api"
import { SERVICE_SHORT, SERVICE_TONE, TEMP_TONE, fmtDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Lozenge } from "./bits"
import { InlineInput } from "./contact-details"

const RISK_TAGS = new Set(["No Land", "Discharge Risk", "Power Risk", "Market Unverified", "Small Budget", "Salinity Check"])

export function ServiceLozenge({ service }: { service?: string | null }) {
  if (!service) return <Lozenge tone="gray">No service yet</Lozenge>
  return <Lozenge tone={SERVICE_TONE[service] || "gray"}>{SERVICE_SHORT[service] || service}</Lozenge>
}

export function TempChip({ temp, size = "sm" }: { temp?: string | null; size?: "sm" | "xs" }) {
  if (!temp) return null
  return (
    <Lozenge tone={TEMP_TONE[temp] || "gray"} className={cn("gap-0.5", size === "xs" && "h-4 px-0.5 text-[10px]")}>
      {temp === "Hot" && <Flame className="size-3" />}{temp}
    </Lozenge>
  )
}

/** The lead record GreenBuddy builds, as the sales team sees it */
export function LeadPanel({ contactId, lead }: { contactId: string; lead?: Lead }) {
  const { data: spec } = useBotSpec()
  const qc = useQueryClient()
  if (!lead) {
    return (
      <div className="rounded-lg border border-dashed p-3 text-[13px] text-muted-foreground">
        <Sprout className="mb-1 size-4 text-[#1f845a]" />No bot lead record yet. GreenBuddy starts one when this customer messages.
      </div>
    )
  }
  const journey = spec?.journeys[lead.journey]
  const required = journey?.required || []
  const extraKeys = Object.keys(lead.fields).filter((k) => !required.includes(k) && lead.fields[k])
  const done = required.filter((k) => lead.fields[k]).length
  const pct = required.length ? Math.round((done / required.length) * 100) : 0
  const save = async (key: string, value: string) => {
    try {
      await api(`/contacts/${contactId}`, { method: "PATCH", body: { leadFields: { [key]: value } } })
      qc.invalidateQueries({ queryKey: ["contact", contactId] }); qc.invalidateQueries({ queryKey: ["contacts"] })
      toast.success("Lead record updated")
    } catch (e: any) { toast.error(e.message) }
  }
  const Row = ({ k, req }: { k: string; req?: boolean }) => (
    <div className="grid min-h-8 grid-cols-[18px_104px_1fr] items-center gap-1.5">
      {lead.fields[k] ? <CheckCircle2 className="size-3.5 text-[#22a06b]" /> : req ? <CircleDashed className="size-3.5 text-[#e2b203]" /> : <span />}
      <span className="truncate text-xs font-semibold text-subtle" title={spec?.fields[k]?.ask}>{spec?.fields[k]?.label || k}</span>
      <InlineInput value={lead.fields[k] || ""} placeholder={req ? "Missing" : "—"} onSave={(v) => save(k, v)} />
    </div>
  )

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border">
      <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2.5">
        <Sprout className="size-4 text-[#1f845a]" />
        <span className="font-semibold">Lead record</span>
        <span className="ml-auto flex flex-wrap gap-1"><ServiceLozenge service={lead.service} /><TempChip temp={lead.temperature} /></span>
      </div>
      <div className="space-y-3 px-3 py-2.5">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs"><span className="text-muted-foreground">{journey?.label || "Service menu"}</span><span className="font-semibold tabular-nums text-subtle">{done}/{required.length} answered</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><motion.div className="h-full rounded-full bg-[#22a06b]" initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} /></div>
        </div>
        {lead.fit && (
          <div className="flex items-center gap-2 rounded-md bg-sunken px-2.5 py-1.5 text-xs"><span className="font-semibold text-subtle">RAS fit</span>
            <Lozenge tone={lead.fit === "Strong" ? "green" : lead.fit === "Not ready yet" ? "gray" : "yellow"}>{lead.fit}</Lozenge>
            <span className="ml-auto text-muted-foreground">team only</span></div>
        )}
        <div className="-mx-1">
          {required.map((k) => <Row key={k} k={k} req />)}
          {extraKeys.map((k) => <Row key={k} k={k} />)}
        </div>
        {lead.mapPin && (
          <a href={`https://maps.google.com/?q=${lead.mapPin.lat},${lead.mapPin.lng}`} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-[13px] text-brand hover:underline">
            <MapPin className="size-3.5" />{lead.mapPin.name || lead.mapPin.address || "Map pin"} — open in Google Maps
          </a>
        )}
        {lead.nextStep && <div className="text-[13px]"><span className="text-xs font-semibold text-subtle">Next step </span>{lead.nextStep}{(lead.confirmed?.siteVisit || lead.confirmed?.expertCall) && <Lozenge tone="green" className="ml-1.5">Shared with team</Lozenge>}</div>}
        {lead.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {lead.tags.map((t) => <span key={t} className={cn("rounded-[3px] px-1.5 text-[11px] leading-[18px] font-semibold", RISK_TAGS.has(t) ? "bg-[#ffeceb] text-[#ae2e24]" : "bg-[#e9f2ff] text-[#0055cc]")}>{t}</span>)}
          </div>
        )}
        <div className="space-y-0.5 text-[11px] text-muted-foreground">
          <div>First message {fmtDateTime(lead.firstMessageAt)}{lead.lastReplyAt && ` · last reply ${fmtDateTime(lead.lastReplyAt)}`}</div>
          {lead.handoverAt && <div className="font-medium text-[#206a83]">🤝 Handed to sales {fmtDateTime(lead.handoverAt)} (see notes)</div>}
        </div>
      </div>
    </motion.div>
  )
}

export const STAGES = [
  { id: "new", name: "New enquiry", tone: "gray" },
  { id: "started", name: "Started", tone: "blue" },
  { id: "qualified", name: "Qualified", tone: "purple" },
  { id: "visit_requested", name: "Visit / call requested", tone: "yellow" },
  { id: "handed", name: "Handed to sales", tone: "teal" },
  { id: "won", name: "Won", tone: "green" },
  { id: "lost", name: "Lost", tone: "red" },
] as const

export const SERVICE_TONE: Record<string, string> = { terrace: "green", hydroponics: "teal", ras: "blue", microgreens: "green", polyhouse: "yellow", support: "purple", other: "gray" }
export const SERVICE_SHORT: Record<string, string> = { terrace: "Terrace", hydroponics: "Hydroponics", ras: "RAS", microgreens: "Microgreens", polyhouse: "Polyhouse", support: "Support", other: "Other" }
export const TEMP_TONE: Record<string, string> = { Hot: "red", Warm: "yellow", Nurture: "blue", Cold: "gray" }

export const TASK_STATUSES = [
  { id: "todo", name: "To Do", tone: "gray" },
  { id: "inprogress", name: "In Progress", tone: "blue" },
  { id: "done", name: "Done", tone: "green" },
] as const

export const PRIORITIES = [
  { id: "urgent", name: "Highest" },
  { id: "high", name: "High" },
  { id: "medium", name: "Medium" },
  { id: "low", name: "Low" },
] as const

export type Tone = "gray" | "blue" | "green" | "yellow" | "red" | "purple" | "teal"
export const TONE: Record<Tone, string> = {
  gray: "bg-[#dcdfe4] text-[#44546f]",
  blue: "bg-[#cce0ff] text-[#0055cc]",
  green: "bg-[#baf3db] text-[#216e4e]",
  yellow: "bg-[#f8e6a0] text-[#7f5f01]",
  red: "bg-[#ffd5d2] text-[#ae2e24]",
  purple: "bg-[#dfd8fd] text-[#5e4db2]",
  teal: "bg-[#c6edfb] text-[#206a83]",
}

export const stageOf = (id: string) => STAGES.find((s) => s.id === id) || STAGES[0]

export function timeAgo(iso?: string | null) {
  if (!iso) return ""
  const d = new Date(iso)
  const s = (Date.now() - d.getTime()) / 1000
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 172800) return "Yesterday"
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}
export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
export const money = (n: number) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0)
export const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: "compact" }).format(n || 0)

const AVATAR_COLORS = ["#0c66e4", "#6e5dc6", "#1f845a", "#c25100", "#ae2e24", "#206a83", "#943d73", "#5b7f24"]
export function avatarColor(seed = "") {
  let h = 0
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}
export function initials(name = "") {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return "#"
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase()
}
export const displayName = (c?: { name?: string; profileName?: string; phone?: string } | null) => (c && (c.name || c.profileName || c.phone)) || "Unknown"

export function windowLeft(lastInboundAt?: string | null) {
  if (!lastInboundAt) return null
  const ms = 24 * 3600e3 - (Date.now() - new Date(lastInboundAt).getTime())
  if (ms <= 0) return null
  const h = Math.floor(ms / 3600e3)
  return h >= 1 ? `${h}h left` : `${Math.max(1, Math.floor(ms / 60e3))}m left`
}

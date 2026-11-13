import { Component, type ReactNode } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"

/** Keeps one broken panel from blanking the whole CRM. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error("[ui] page crashed:", error) }
  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="m-8 max-w-xl rounded-lg border border-[#ffd5d2] bg-[#fff8f7] p-5">
        <div className="mb-1 flex items-center gap-2 font-semibold text-[#ae2e24]"><AlertTriangle className="size-4" />This page hit an error</div>
        <p className="mb-3 text-[13px] text-subtle">The rest of the CRM still works. Details for the developer:</p>
        <pre className="mb-3 overflow-auto rounded bg-white p-2 text-xs text-[#5d1f1a]">{this.state.error.message}</pre>
        <button onClick={() => this.setState({ error: null })} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover">
          <RotateCcw className="size-4" />Try again
        </button>
      </div>
    )
  }
}

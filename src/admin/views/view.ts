// The shared view contract. Each section is a View: an async render() that
// returns HTML, plus an optional mount() to wire interactions (drilldowns,
// toggles, actions) after the HTML is in the DOM. rerender() lets a view
// re-request its own data (e.g. after a control action) without a full reload.

import type { AdminSession, RangeDays } from '../config'

export interface ViewCtx {
  session: AdminSession
  range: RangeDays
  now: number
}

export interface View {
  id: string
  label: string
  icon: string
  render(ctx: ViewCtx): Promise<string>
  mount?(root: HTMLElement, ctx: ViewCtx, rerender: () => void): void
}

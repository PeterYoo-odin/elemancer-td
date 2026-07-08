// UNIFIED SETTINGS SCREEN — one place for audio, accessibility, difficulty/assist,
// controls (input remap) and privacy (opt-in analytics). Built in the house style:
// a class that owns a DOM subtree, injects scoped CSS once, and uses event
// delegation. Every change persists via appSettings.set() and, for accessibility,
// re-applies to <html> live via applyAccessibility().

import { appSettings, DEFAULT_KEYBINDS, type ColorblindMode, type AssistMode, type AudioSensitivity, type BindableAction } from './settings'
import { applyAccessibility, ELEMENT_GLYPH, ALL_ELEMENTS } from './a11y'
import { elementIcon } from './icons'
import { music } from './music'
import { playUiTick, refreshSfxVolume, refreshMasterVolume, refreshVoVolume } from './sfx'
import { heroVo } from './vo'
import { analytics } from '../game/analytics'

export interface SettingsPanelOpts {
  onReplayIntro?: () => void
  onClose?: () => void
}

const AUDIO_SENS_LABELS: Record<AudioSensitivity, string> = { full: 'Full', reduced: 'Reduced' }

const CB_LABELS: Record<ColorblindMode, string> = {
  off: 'Off', deuter: 'Deuter', protan: 'Protan', trit: 'Tritan',
}
const CB_DESC: Record<ColorblindMode, string> = {
  off: 'Standard element colours.',
  deuter: 'Deuteranopia-safe (red-green). Okabe-Ito palette.',
  protan: 'Protanopia-safe (red-green). Okabe-Ito palette.',
  trit: 'Tritanopia-safe (blue-yellow).',
}
const ASSIST_LABELS: Record<AssistMode, string> = { off: 'Normal', relaxed: 'Relaxed', cozy: 'Cozy' }
const ASSIST_DESC: Record<AssistMode, string> = {
  off: 'The intended challenge — no help.',
  relaxed: '+5 starting lives, +20% start gold. A gentler ride; rates stay fair.',
  cozy: '+12 starting lives, +50% start gold. For a stress-free playthrough.',
}
const KEY_LABELS: Record<BindableAction, string> = {
  startWave: 'Start / early wave', tower1: 'Select tower 1', tower2: 'Select tower 2',
  tower3: 'Select tower 3', tower4: 'Select tower 4', tower5: 'Select tower 5',
  cancel: 'Cancel / deselect', toggleSpeed: 'Toggle speed', pause: 'Pause / back',
}

/** Human-friendly label for a KeyboardEvent.code. */
export function codeLabel(code: string): string {
  if (code === 'Space') return 'Space'
  if (code === 'Escape') return 'Esc'
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6)
  if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] ?? code
  return code
}

let cssInjected = false

export class SettingsPanel {
  private root: HTMLDivElement
  private listening: BindableAction | null = null
  private keyHandler = (e: KeyboardEvent) => this.onCaptureKey(e)

  constructor(private opts: SettingsPanelOpts = {}) {
    if (!cssInjected) {
      cssInjected = true
      const style = document.createElement('style')
      style.id = 'settings-css'
      style.textContent = CSS
      document.head.appendChild(style)
    }
    this.root = document.createElement('div')
    this.root.className = 'settings-overlay'
    this.root.innerHTML = `<div class="settings-card" role="dialog" aria-label="Settings">
      <div class="settings-title">SETTINGS</div>
      <div class="settings-scroll">${this.body()}</div>
      <div class="settings-foot">
        ${this.opts.onReplayIntro ? '<button class="settings-btn" data-act="replay">↺ Replay intro</button>' : ''}
        <button class="settings-btn primary" data-act="close">DONE</button>
      </div>
    </div>`
    this.root.addEventListener('click', (e) => this.onClick(e))
    this.root.addEventListener('input', (e) => this.onInput(e))
    document.body.appendChild(this.root)
  }

  private body(): string {
    const s = appSettings.data
    return `
      ${section('Audio', `
        ${sliderRow('Master volume', 'masterVol', Math.round(s.masterVol * 100))}
        ${toggleRow('Sound effects', 'sound', s.sound)}
        ${sliderRow('SFX volume', 'sfxVol', Math.round(s.sfxVol * 100))}
        ${toggleRow('Music', 'music', s.music)}
        ${sliderRow('Music volume', 'musicVol', Math.round(s.musicVol * 100))}
        ${toggleRow('Hero voices', 'vo', s.vo)}
        ${sliderRow('Voice volume', 'voVol', Math.round(s.voVol * 100))}
        ${segRow('Audio sensitivity', 'audioSens', (['full', 'reduced'] as AudioSensitivity[]).map((m) => ({ v: m, label: AUDIO_SENS_LABELS[m], on: s.audioSensitivity === m })))}
        <div class="settings-sub">Reduced softens harsh transients and combat ducking — the reduce-motion setting for ears.</div>
        <div class="settings-note">Music: “Sneaky Adventure” &amp; “Heroic Age” — Kevin MacLeod (incompetech.com), CC BY 4.0. Adaptive bed &amp; hero voices synthesized in-engine.</div>
      `)}
      ${section('Accessibility — colour vision', `
        <div class="settings-note">Element identity uses a distinct <b>shape</b> plus colour, so it never depends on colour alone.</div>
        ${segRow('Colourblind palette', 'cb', (['off', 'deuter', 'protan', 'trit'] as ColorblindMode[]).map((m) => ({ v: m, label: CB_LABELS[m], on: s.colorblind === m })))}
        <div class="settings-sub" data-cbdesc>${CB_DESC[s.colorblind]}</div>
        ${toggleRow('Element shape glyphs', 'elementGlyphs', s.elementGlyphs)}
        <div class="settings-palette" data-palette>${this.palettePreview()}</div>
      `)}
      ${section('Accessibility — display', `
        ${toggleRow('High contrast', 'highContrast', s.highContrast)}
        ${toggleRow('Reduce motion', 'reduceMotion', s.reduceMotion)}
        ${hapticsSupported() ? toggleRow('Vibration', 'haptics', s.haptics) : ''}
        ${sliderRow('Text size', 'textScale', Math.round(s.textScale * 100), 80, 150)}
      `)}
      ${section('Difficulty', `
        ${segRow('Assist mode', 'assist', (['off', 'relaxed', 'cozy'] as AssistMode[]).map((m) => ({ v: m, label: ASSIST_LABELS[m], on: s.assist === m })))}
        <div class="settings-sub" data-assistdesc>${ASSIST_DESC[s.assist]}</div>
      `)}
      ${section('Controls — keyboard', `
        <div class="settings-note">Click a key to rebind it. The game is fully keyboard-operable.</div>
        <div data-binds>${this.bindRows()}</div>
        <button class="settings-btn small" data-act="resetBinds">Reset keys to default</button>
      `)}
      ${section('Privacy — anonymous analytics', `
        <div class="settings-note">Opt in to share <b>anonymous, aggregate</b> gameplay stats (no account, no personal data) — it helps us balance the game. Stored on this device; you can turn it off any time.</div>
        ${toggleRow('Share anonymous analytics', 'analytics', analytics.enabled())}
        <div class="settings-snapshot" data-snapshot>${this.snapshotRows()}</div>
      `)}
    `
  }

  private palettePreview(): string {
    return ALL_ELEMENTS.map((el) => {
      const glyph = appSettings.data.elementGlyphs ? `<span class="el-glyph">${ELEMENT_GLYPH[el]}</span>` : ''
      return `<span class="settings-chip">${elementIcon(el, { size: 16 })}${glyph}<span>${el}</span></span>`
    }).join('')
  }

  private bindRows(): string {
    const b = appSettings.data.keybinds
    return (Object.keys(DEFAULT_KEYBINDS) as BindableAction[]).map((a) => `
      <div class="settings-row">
        <span>${KEY_LABELS[a]}</span>
        <button class="settings-key ${this.listening === a ? 'listening' : ''}" data-bind="${a}">${this.listening === a ? 'Press a key…' : codeLabel(b[a])}</button>
      </div>`).join('')
  }

  private snapshotRows(): string {
    if (!analytics.enabled()) return '<div class="settings-sub">Analytics off — nothing is collected.</div>'
    const s = analytics.snapshot()
    const row = (label: string, v: string | number) => `<div class="settings-srow"><span>${label}</span><b>${v}</b></div>`
    return [
      row('Sessions', s.sessions),
      row('Battles started', s.battlesStarted),
      row('Win rate', `${Math.round(Number(s.winRate) * 100)}%`),
      row('Avg wave reached', s.avgWaveReached),
      row('First-wow time', Number(s.firstWowS) >= 0 ? `${s.firstWowS}s` : '—'),
      row('Biggest drop-off', String(s.biggestDropOffLevel)),
      row('Deadliest level', String(s.deadliestLevel)),
    ].join('')
  }

  // ---- events -------------------------------------------------------------
  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement
    if (target === this.root) { this.close(); return }
    const act = target.closest<HTMLElement>('[data-act]')?.dataset.act
    if (act === 'close') { this.close(); return }
    if (act === 'replay') { this.close(); this.opts.onReplayIntro?.(); return }
    if (act === 'resetBinds') { appSettings.set({ keybinds: { ...DEFAULT_KEYBINDS } }); this.stopListening(); this.refreshBinds(); playUiTick(); return }

    const toggle = target.closest<HTMLElement>('[data-toggle]')
    if (toggle) { this.onToggle(toggle.dataset.toggle ?? '', toggle); return }

    const seg = target.closest<HTMLElement>('[data-seg]')
    if (seg) { this.onSeg(seg.dataset.seg ?? '', seg.dataset.val ?? '', seg); return }

    const bind = target.closest<HTMLElement>('[data-bind]')
    if (bind) { this.onBindClick(bind.dataset.bind as BindableAction); return }
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement
    const slider = el.dataset.slider
    if (!slider) return
    const v = Number(el.value)
    if (slider === 'masterVol') { appSettings.set({ masterVol: v / 100 }); refreshMasterVolume() }
    else if (slider === 'sfxVol') { appSettings.set({ sfxVol: v / 100 }); refreshSfxVolume() }
    else if (slider === 'musicVol') { appSettings.set({ musicVol: v / 100 }); music.refresh(80) }
    else if (slider === 'voVol') { appSettings.set({ voVol: v / 100 }); refreshVoVolume() }
    else if (slider === 'textScale') { appSettings.set({ textScale: v / 100 }); applyAccessibility() }
  }

  private onToggle(key: string, el: HTMLElement): void {
    playUiTick()
    if (key === 'analytics') {
      const next = !analytics.enabled()
      analytics.setConsent(next)
      el.classList.toggle('on', next)
      this.refreshSnapshot()
      return
    }
    if (key === 'sound' || key === 'music' || key === 'vo' || key === 'reduceMotion' || key === 'elementGlyphs' || key === 'highContrast' || key === 'haptics') {
      const next = !appSettings.data[key]
      appSettings.set({ [key]: next })
      el.classList.toggle('on', next)
      if (key === 'music') music.refresh(300)
      if (key === 'vo' && next) heroVo(undefined, 'deploy') // preview the voice on enable
      if (key === 'reduceMotion' || key === 'highContrast' || key === 'elementGlyphs') applyAccessibility()
      if (key === 'elementGlyphs') this.refreshPalette()
    }
  }

  private onSeg(group: string, val: string, el: HTMLElement): void {
    playUiTick()
    const sibs = el.parentElement?.querySelectorAll('[data-seg]') ?? []
    sibs.forEach((s) => s.classList.toggle('on', s === el))
    if (group === 'cb') {
      appSettings.set({ colorblind: val as ColorblindMode })
      applyAccessibility()
      this.refreshPalette()
      const d = this.root.querySelector('[data-cbdesc]'); if (d) d.textContent = CB_DESC[val as ColorblindMode]
    } else if (group === 'assist') {
      appSettings.set({ assist: val as AssistMode })
      const d = this.root.querySelector('[data-assistdesc]'); if (d) d.textContent = ASSIST_DESC[val as AssistMode]
    } else if (group === 'audioSens') {
      appSettings.set({ audioSensitivity: val as AudioSensitivity })
    }
  }

  private onBindClick(action: BindableAction): void {
    playUiTick()
    if (this.listening === action) { this.stopListening(); this.refreshBinds(); return }
    this.listening = action
    window.addEventListener('keydown', this.keyHandler, { capture: true })
    this.refreshBinds()
  }

  private onCaptureKey(e: KeyboardEvent): void {
    if (!this.listening) return
    e.preventDefault()
    e.stopPropagation()
    const code = e.code
    const binds = { ...appSettings.data.keybinds }
    // if this code is already bound to another action, clear that one (no dupes)
    for (const k of Object.keys(binds) as BindableAction[]) if (binds[k] === code && k !== this.listening) binds[k] = ''
    binds[this.listening] = code
    appSettings.set({ keybinds: binds })
    this.stopListening()
    this.refreshBinds()
  }

  private stopListening(): void {
    if (this.listening) window.removeEventListener('keydown', this.keyHandler, { capture: true } as EventListenerOptions)
    this.listening = null
  }

  private refreshBinds(): void {
    const host = this.root.querySelector('[data-binds]'); if (host) host.innerHTML = this.bindRows()
  }
  private refreshPalette(): void {
    const host = this.root.querySelector('[data-palette]'); if (host) host.innerHTML = this.palettePreview()
  }
  private refreshSnapshot(): void {
    const host = this.root.querySelector('[data-snapshot]'); if (host) host.innerHTML = this.snapshotRows()
  }

  private close(): void {
    this.stopListening()
    playUiTick()
    this.root.classList.add('hide')
    window.setTimeout(() => { this.root.remove(); this.opts.onClose?.() }, appSettings.reducedMotion() ? 0 : 200)
  }

  destroy(): void { this.stopListening(); this.root.remove() }
}

// ---- template helpers -------------------------------------------------------
function section(title: string, inner: string): string {
  return `<section class="settings-sec"><h3>${title}</h3>${inner}</section>`
}
function toggleRow(label: string, key: string, on: boolean): string {
  return `<div class="settings-row"><span>${label}</span><div class="settings-switch ${on ? 'on' : ''}" data-toggle="${key}" role="switch" aria-checked="${on}" tabindex="0"></div></div>`
}
// Only surface the Vibration toggle where it can actually do something: a real
// vibrate API behind a touch (coarse) pointer. Desktop never sees a dead switch.
function hapticsSupported(): boolean {
  const hasApi = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  return hasApi && coarse
}
function sliderRow(label: string, key: string, value: number, min = 0, max = 100): string {
  return `<div class="settings-row"><span>${label}</span><input class="settings-slider" type="range" min="${min}" max="${max}" value="${value}" data-slider="${key}" aria-label="${label}" /></div>`
}
function segRow(label: string, group: string, opts: Array<{ v: string; label: string; on: boolean }>): string {
  const btns = opts.map((o) => `<button class="settings-seg ${o.on ? 'on' : ''}" data-seg="${group}" data-val="${o.v}">${o.label}</button>`).join('')
  return `<div class="settings-row col"><span>${label}</span><div class="settings-segwrap">${btns}</div></div>`
}

const CSS = `
.settings-overlay { position: fixed; inset: 0; z-index: 6000; display: flex; align-items: center; justify-content: center;
  background: rgba(6,4,16,.72); backdrop-filter: blur(4px); opacity: 1; transition: opacity .2s ease; padding: 12px; }
.settings-overlay.hide { opacity: 0; }
.settings-card { width: min(520px, 96vw); max-height: 92vh; display: flex; flex-direction: column;
  background: linear-gradient(180deg, #241a44, #1a1436); border: 1px solid rgba(255,255,255,.14);
  border-radius: 18px; box-shadow: 0 24px 60px rgba(0,0,0,.55); color: #fff; overflow: hidden;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.settings-title { font-weight: 800; letter-spacing: .12em; font-size: 18px; text-align: center; padding: 16px 16px 10px; }
.settings-scroll { overflow-y: auto; padding: 0 16px 8px; }
.settings-sec { margin: 8px 0 14px; }
.settings-sec h3 { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: #b9a9ff; margin: 6px 0 8px; }
.settings-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 0; min-height: 34px; }
.settings-row.col { flex-direction: column; align-items: stretch; }
.settings-row.col > span { margin-bottom: 6px; }
.settings-note { font-size: 12px; color: #cdbff5; line-height: 1.4; margin: 2px 0 8px; }
.settings-sub { font-size: 11.5px; color: #9d90c6; margin: -2px 0 6px; min-height: 15px; }
.settings-switch { width: 46px; height: 26px; border-radius: 14px; background: #3a2f5e; position: relative; cursor: pointer; flex: 0 0 auto; transition: background .15s; }
.settings-switch::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left .15s; }
.settings-switch.on { background: #46e08a; }
.settings-switch.on::after { left: 23px; }
.settings-slider { flex: 0 0 150px; accent-color: #b06bff; }
.settings-segwrap { display: flex; gap: 6px; flex-wrap: wrap; }
.settings-seg { flex: 1 1 auto; min-width: 62px; padding: 8px 6px; border-radius: 10px; border: 1px solid rgba(255,255,255,.16);
  background: #2f2258; color: #d9cffb; font-size: 12.5px; font-weight: 700; cursor: pointer; }
.settings-seg.on { background: #b06bff; color: #fff; border-color: #cd9bff; }
.settings-palette { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.settings-chip { display: inline-flex; align-items: center; gap: 4px; padding: 5px 9px; border-radius: 999px;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); font-size: 12px; }
.settings-chip .el-glyph { font-size: 13px; }
.settings-key { padding: 6px 12px; min-width: 64px; border-radius: 9px; border: 1px solid rgba(255,255,255,.18);
  background: #2f2258; color: #fff; font-weight: 700; font-size: 12.5px; cursor: pointer; }
.settings-key.listening { background: #ffd54a; color: #241a44; border-color: #ffd54a; }
.settings-snapshot { margin-top: 6px; display: grid; gap: 3px; }
.settings-srow { display: flex; justify-content: space-between; font-size: 12px; color: #cdbff5; }
.settings-srow b { color: #fff; }
.settings-foot { display: flex; gap: 10px; padding: 12px 16px; border-top: 1px solid rgba(255,255,255,.1); }
.settings-btn { flex: 1; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,.16);
  background: #2f2258; color: #fff; font-weight: 700; cursor: pointer; font-size: 13px; }
.settings-btn.small { flex: 0 0 auto; font-size: 12px; padding: 8px 12px; margin-top: 6px; }
.settings-btn.primary { background: #b06bff; border-color: #cd9bff; }
@media (prefers-reduced-motion: reduce) { .settings-overlay, .settings-switch, .settings-switch::after { transition: none; } }
`

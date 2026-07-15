// QA JUICE PANEL — the device-tuning overlay. Mounted ONLY under the QA gate
// (?qa=1 / dev), from BattleScene, so production loads never see or pay for it.
//
// Five live knobs (hitstop · shake · haptics · floater cap · bloom base) write
// straight onto qa.juice, which the juice call sites consult behind qa.enabled.
// PRINT dumps the chosen values as JSON to console + clipboard so a phone
// tuning session ends with concrete numbers to commit as the new defaults.

import { qa } from '../game/qa'

let root: HTMLDivElement | null = null

interface Knob {
  key: 'hitstopMul' | 'shakeMul' | 'hapticMul' | 'floatCap' | 'bloomBase'
  label: string
  min: number
  max: number
  step: number
}

const KNOBS: Knob[] = [
  { key: 'hitstopMul', label: 'HITSTOP ×', min: 0, max: 3, step: 0.05 },
  { key: 'shakeMul', label: 'SHAKE ×', min: 0, max: 3, step: 0.05 },
  { key: 'hapticMul', label: 'HAPTIC ×', min: 0, max: 3, step: 0.1 },
  { key: 'floatCap', label: 'FLOAT CAP (0=ship)', min: 0, max: 22, step: 1 },
  { key: 'bloomBase', label: 'BLOOM BASE', min: 0, max: 1.2, step: 0.01 },
]

export function mountQaJuicePanel(): void {
  if (!qa.enabled || root) return
  root = document.createElement('div')
  root.style.cssText =
    'position:fixed;left:8px;bottom:120px;z-index:9000;width:180px;padding:8px 10px;border-radius:10px;' +
    'background:rgba(10,7,22,.88);border:1px solid rgba(255,255,255,.25);color:#efe9ff;' +
    'font:600 10px monospace;display:flex;flex-direction:column;gap:5px;user-select:none;'

  const head = document.createElement('div')
  head.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-weight:800;letter-spacing:.08em;'
  head.innerHTML = '<span>JUICE KNOBS</span>'
  const fold = document.createElement('button')
  fold.textContent = '–'
  fold.style.cssText = 'background:none;border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:5px;width:18px;cursor:pointer;font:inherit;'
  head.appendChild(fold)
  root.appendChild(head)

  const body = document.createElement('div')
  body.style.cssText = 'display:flex;flex-direction:column;gap:5px;'
  root.appendChild(body)
  fold.onclick = () => { body.hidden = !body.hidden; fold.textContent = body.hidden ? '+' : '–' }

  for (const k of KNOBS) {
    const row = document.createElement('label')
    row.style.cssText = 'display:flex;flex-direction:column;gap:1px;'
    const cap = document.createElement('span')
    const val = () => (qa.juice[k.key] as number)
    const paint = () => { cap.textContent = `${k.label}: ${k.step >= 1 ? val() : val().toFixed(2)}` }
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(k.min)
    input.max = String(k.max)
    input.step = String(k.step)
    input.value = String(val())
    input.style.cssText = 'width:100%;accent-color:#ffd76a;'
    input.oninput = () => { (qa.juice[k.key] as number) = Number(input.value); paint() }
    paint()
    row.append(cap, input)
    body.appendChild(row)
  }

  const print = document.createElement('button')
  print.textContent = 'PRINT VALUES'
  print.style.cssText =
    'margin-top:2px;padding:5px;border-radius:6px;border:1px solid rgba(255,255,255,.3);cursor:pointer;' +
    'background:rgba(255,215,106,.18);color:#ffd76a;font:800 10px monospace;letter-spacing:.08em;'
  print.onclick = () => {
    const json = JSON.stringify(qa.juice)
    console.log('[juice-knobs]', json)
    try { void navigator.clipboard?.writeText(json) } catch { /* clipboard optional */ }
    print.textContent = 'PRINTED ✓'
    window.setTimeout(() => { if (print.isConnected) print.textContent = 'PRINT VALUES' }, 1200)
  }
  body.appendChild(print)

  document.body.appendChild(root)
}

export function unmountQaJuicePanel(): void {
  root?.remove()
  root = null
}

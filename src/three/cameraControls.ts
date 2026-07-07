// CameraControls — the battle-camera gesture layer. Translates raw pointer and
// wheel input on the 3D canvas into orbit-rig moves (pan / zoom / rotate) and
// clean TAPS, and never touches game state itself.
//
//   touch:  1-finger drag = pan · pinch = zoom · 2-finger twist = rotate ·
//           2-finger vertical drag = tilt
//   mouse:  left-drag = pan · wheel = zoom · right- (or ctrl/alt+left-) drag =
//           rotate/tilt
//
// A press only counts as a TAP if it never travels past TAP_SLOP and no second
// finger lands — so drag-to-pan can never misfire a build/select, and a clean
// single tap always lands (the earlier input-reliability fix is preserved).

export interface OrbitRig {
  orbitBy(dYaw: number, dPitch: number): void
  panBy(dxPx: number, dyPx: number): void
  zoomBy(factor: number): void
}

interface PointerRec {
  x: number
  y: number
  startX: number
  startY: number
  button: number
  isMouse: boolean
}

const TAP_SLOP = 9 // px of travel before a press becomes a drag
const ORBIT_SPEED = 0.0056 // rad per px (mouse rotate-drag)
const PINCH_TILT = 0.004 // rad per px of two-finger vertical travel

export class CameraControls {
  private pointers = new Map<number, PointerRec>()
  private mode: 'none' | 'tap' | 'pan' | 'orbit' | 'pinch' = 'none'
  private rotateHeld = false
  private pinchDist = 0
  private pinchAngle = 0
  private pinchY = 0
  private detachFns: Array<() => void> = []

  constructor(
    private canvas: HTMLCanvasElement,
    private rig: OrbitRig,
    private cb: { onTap(x: number, y: number): void; onHover(x: number, y: number): void },
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions,
    ) => {
      canvas.addEventListener(type, fn, opts)
      this.detachFns.push(() => canvas.removeEventListener(type, fn, opts))
    }
    on('pointerdown', (e) => this.down(e))
    on('pointermove', (e) => this.move(e))
    on('pointerup', (e) => this.up(e))
    on('pointercancel', (e) => this.drop(e))
    on('wheel', (e) => this.wheel(e), { passive: false })
    on('contextmenu', (e) => e.preventDefault())
  }

  private down(e: PointerEvent): void {
    try { this.canvas.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    this.pointers.set(e.pointerId, {
      x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY,
      button: e.button, isMouse: e.pointerType === 'mouse',
    })
    if (this.pointers.size === 2) {
      this.mode = 'pinch' // second finger lands → the press is a gesture, not a tap
      const [a, b] = [...this.pointers.values()]
      this.pinchDist = Math.hypot(b.x - a.x, b.y - a.y)
      this.pinchAngle = Math.atan2(b.y - a.y, b.x - a.x)
      this.pinchY = (a.y + b.y) / 2
    } else if (this.pointers.size === 1) {
      this.rotateHeld = e.button === 2 || e.button === 1 || ((e.ctrlKey || e.altKey) && e.pointerType === 'mouse')
      this.mode = 'tap'
    } else {
      this.mode = 'none' // 3+ fingers: stand down until they lift
    }
  }

  private move(e: PointerEvent): void {
    const rec = this.pointers.get(e.pointerId)
    if (!rec) {
      if (this.pointers.size === 0) this.cb.onHover(e.clientX, e.clientY)
      return
    }
    const px = rec.x
    const py = rec.y
    rec.x = e.clientX
    rec.y = e.clientY

    if (this.mode === 'pinch') {
      if (this.pointers.size !== 2) return
      const [a, b] = [...this.pointers.values()]
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const midY = (a.y + b.y) / 2
      if (this.pinchDist > 4 && dist > 4) this.rig.zoomBy(this.pinchDist / dist)
      let dAng = ang - this.pinchAngle
      if (dAng > Math.PI) dAng -= Math.PI * 2
      if (dAng < -Math.PI) dAng += Math.PI * 2
      this.rig.orbitBy(dAng, (midY - this.pinchY) * PINCH_TILT)
      this.pinchDist = dist
      this.pinchAngle = ang
      this.pinchY = midY
      return
    }

    if (this.mode === 'tap') {
      if (Math.hypot(rec.x - rec.startX, rec.y - rec.startY) <= TAP_SLOP) {
        this.cb.onHover(e.clientX, e.clientY) // still a tap candidate — keep the ghost live
        return
      }
      this.mode = this.rotateHeld ? 'orbit' : 'pan'
    }

    const dx = rec.x - px
    const dy = rec.y - py
    if (this.mode === 'pan') {
      this.rig.panBy(dx, dy)
      this.cb.onHover(e.clientX, e.clientY) // hover ring tracks the world sliding past
    } else if (this.mode === 'orbit') {
      this.rig.orbitBy(-dx * ORBIT_SPEED, dy * ORBIT_SPEED)
    }
  }

  private up(e: PointerEvent): void {
    const rec = this.pointers.get(e.pointerId)
    this.pointers.delete(e.pointerId)
    // clean tap: primary button (or any touch/pen), never after a drag or pinch
    if (rec && this.mode === 'tap' && (rec.button === 0 || !rec.isMouse)) {
      this.cb.onTap(rec.startX, rec.startY)
    }
    this.settle()
  }

  private drop(e: PointerEvent): void {
    this.pointers.delete(e.pointerId)
    this.settle()
  }

  // A finger lifted mid-gesture: the survivor continues as a plain pan (never a
  // tap — its press was already spent on the gesture).
  private settle(): void {
    this.mode = this.pointers.size === 1 ? 'pan' : 'none'
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault() // ctrl+wheel would otherwise zoom the whole page
    const k = e.ctrlKey ? 0.0045 : 0.0016 // trackpad pinches report as ctrl+wheel
    this.rig.zoomBy(Math.exp(e.deltaY * k))
  }

  dispose(): void {
    for (const fn of this.detachFns) fn()
    this.detachFns = []
    this.pointers.clear()
  }
}

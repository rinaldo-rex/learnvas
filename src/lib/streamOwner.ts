/** A generation belongs to one mounted canvas, even when node IDs are reused. */
export class StreamOwner {
  private live = true
  private canvasAlive: () => boolean
  constructor(canvasAlive: () => boolean) { this.canvasAlive = canvasAlive }
  accepts() { return this.live && this.canvasAlive() }
  invalidate() { this.live = false }
}

import { afterAll, beforeAll } from 'vitest'

/** jsdom não implementa o ciclo nativo do dialog usado pelo navegador e pelo app. */
export function instalarDialogoDeTeste() {
  const prototype = HTMLDialogElement.prototype
  const anteriores = Object.fromEntries(['showModal', 'close'].map(nome => [nome, Object.getOwnPropertyDescriptor(prototype, nome)]))
  beforeAll(() => Object.defineProperties(prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false } },
  }))
  afterAll(() => {
    for (const [nome, descriptor] of Object.entries(anteriores)) {
      if (descriptor) Object.defineProperty(prototype, nome, descriptor)
      else Reflect.deleteProperty(prototype, nome)
    }
  })
}

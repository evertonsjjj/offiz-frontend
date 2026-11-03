import { expect, it } from 'vitest'
import { protegerHtmlPrevia, temRecursosExternosHtml } from './previaHtml'

it.each(['<img src="https://example.invalid/x">', '<!doctype html SYSTEM "x>y"><img src="https://example.invalid/x">'])('insere a proteção antes dos recursos em HTML incompleto ou doctype legado', html => {
  const doc = new DOMParser().parseFromString(protegerHtmlPrevia(html), 'text/html')
  expect(doc.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy')
  expect(doc.head.firstElementChild?.getAttribute('content')).toContain("base-uri 'none'")
  expect(doc.head.firstElementChild?.getAttribute('content')).toContain("form-action 'none'")
})

it('comentários antes do doctype mantêm o modo padrão sem retrocesso de regex', () => {
  const html = '<!-- comentário -->'.repeat(2000) + '<!DOCTYPE html><h1>Trabalho</h1>'
  const doc = new DOMParser().parseFromString(protegerHtmlPrevia(html), 'text/html')
  expect(doc.compatMode).toBe('CSS1Compat')
  expect(doc.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy')
})

it('não avisa de recurso externo em uma imagem embutida e detecta importação de fonte', () => {
  expect(temRecursosExternosHtml('<img src="data:image/png;base64,teste">')).toBe(false)
  expect(temRecursosExternosHtml('<style>@import "https://example.invalid/font.css";</style>')).toBe(true)
})

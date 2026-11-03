import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setTokens } from '../../lib/api'
import { SetupSabatina } from './SetupSabatina'

const avisos = vi.hoisted(() => ({ sucesso: vi.fn(), falha: vi.fn() }))
vi.mock('../Toasts', () => ({ useToasts: () => avisos }))

type Envio = { path: string; method: string; authorization: string | null; nome: string | null }
let envios: Envio[]
let concluirPrimeiro: (response: Response) => void
let recusarPrimeiro: (error: Error) => void

function recebido(nome: string) {
  return new Response(JSON.stringify({ nome }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  localStorage.clear()
  sessionStorage.clear()
  setTokens('synthetic-old-access', 'synthetic-old-refresh')
  envios = []
  // Exercita o transporte autenticado verdadeiro. Nenhum pedido sai pela rede.
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    const headers = new Headers(init.headers)
    const nome = init.body instanceof FormData ? (init.body.get('arquivo') as File)?.name ?? null : null
    envios.push({ path: new URL(url, 'http://synthetic.invalid').pathname, method: init.method ?? 'GET', authorization: headers.get('Authorization'), nome })
    if (init.method !== 'POST' || !String(url).includes('/predios/1/juris/arquivos')) throw new Error('Pedido sintético inesperado')
    if (envios.length === 1) return new Promise<Response>((resolve, reject) => { concluirPrimeiro = resolve; recusarPrimeiro = reject })
    return Promise.resolve(recebido('segundo.txt'))
  }))
})

afterEach(() => {
  vi.clearAllTimers()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function setup(orgId: number) {
  return <SetupSabatina key={orgId} orgId={orgId} slug="juris" canonAtual="" aoConcluir={vi.fn()} aoFechar={vi.fn()} />
}

async function iniciar() {
  const tela = render(setup(1))
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Escolher arquivos da empresa'), {
      target: { files: [new File(['one'], 'primeiro.txt'), new File(['two'], 'segundo.txt')] },
    })
  })
  expect(envios).toEqual([{ path: '/api/v1/predios/1/juris/arquivos', method: 'POST', authorization: 'Bearer synthetic-old-access', nome: 'primeiro.txt' }])
  return tela
}

it.each(['empresa', 'sessão e empresa', 'sessão antes da remontagem', 'saída da tela', 'saída com falha de rede'])('interrompe os próximos arquivos após %s sem repetir o envio em trânsito', async mudanca => {
  const tela = await iniciar()
  if (mudanca.startsWith('sessão')) setTokens('synthetic-new-access', 'synthetic-new-refresh')
  if (mudanca === 'empresa' || mudanca === 'sessão e empresa') tela.rerender(setup(2))
  if (mudanca.startsWith('saída')) tela.unmount()
  await act(async () => {
    if (mudanca === 'saída com falha de rede') recusarPrimeiro(new TypeError('synthetic connection failure'))
    else concluirPrimeiro(recebido('primeiro.txt'))
  })
  expect(envios).toHaveLength(1)
  expect(avisos.falha).not.toHaveBeenCalled()
})

it('no mesmo contexto envia os dois arquivos exatamente uma vez com a sessão original', async () => {
  await iniciar()
  await act(async () => concluirPrimeiro(recebido('primeiro.txt')))
  expect(envios.map(envio => envio.nome)).toEqual(['primeiro.txt', 'segundo.txt'])
  expect(envios.every(envio => envio.authorization === 'Bearer synthetic-old-access')).toBe(true)
  expect(screen.getByLabelText('Escolher arquivos da empresa')).toBeEnabled()
  expect(avisos.falha).not.toHaveBeenCalled()
})

it('falha confirmada de um arquivo no mesmo contexto conserva a continuação do lote', async () => {
  await iniciar()
  await act(async () => concluirPrimeiro(new Response(JSON.stringify({ detail: 'Arquivo sintético recusado' }), { status: 422 })))
  expect(envios.map(envio => envio.nome)).toEqual(['primeiro.txt', 'segundo.txt'])
  expect(avisos.falha).toHaveBeenCalledExactlyOnceWith('Arquivo sintético recusado')
  expect(screen.getByLabelText('Escolher arquivos da empresa')).toBeEnabled()
})

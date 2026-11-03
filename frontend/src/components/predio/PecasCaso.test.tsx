import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { instalarDialogoDeTeste } from '../../test/dialog'
import { PecasCaso } from './PecasCaso'
import type { OffizMotorBridge } from '../../lib/motor-bridge'

const contexto = vi.hoisted(() => ({ sessao: 'conta-a', sucesso: vi.fn(), falha: vi.fn(), empacotar: vi.fn() }))
vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), getSessionIdentity: () => contexto.sessao, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => contexto }))
vi.mock('docx', () => ({ Document: class {}, Paragraph: class {}, TextRun: class {}, HeadingLevel: {}, AlignmentType: {}, Packer: { toBlob: contexto.empacotar } }))
instalarDialogoDeTeste()
const peca = { id: 81, caso_id: 7, tipo: 'inicial', titulo: 'Petição da empresa', versao: 2, status: 'gerada', criado_em: '2026-10-09T12:00:00Z', conteudo: 'Conteúdo original exclusivo', comentarios: [] }
const versao = { versao: 1, conteudo: 'Versão anterior', criado_em: '2026-10-08T12:00:00Z' }
const resposta = (url: string) => url.endsWith('/versoes') ? { versoes: [versao] } : url.endsWith('/pecas-tipos') ? { tipos: [{ id: 'inicial', nome: 'Inicial', categoria: 'Iniciais' }] } : url.includes('/biblioteca') ? { itens: [] } : url.endsWith('/pecas/81') ? peca : url.endsWith('/pecas') ? { pecas: [peca] } : { area_direito: 'civil' }
beforeEach(() => {
  vi.clearAllMocks(); contexto.sessao = 'conta-a'
  vi.mocked(api.get).mockImplementation(async url => resposta(url) as never)
  vi.mocked(api.post).mockImplementation(async url => url.endsWith('preview-tokens') ? { tokens_estimados: 100, custo_estimado_brl: 0.01, tier: 'normal' } : {})
  vi.mocked(api.put).mockResolvedValue({ ...peca, versao: 3 }); vi.mocked(api.del).mockResolvedValue(undefined)
  vi.spyOn(window, 'confirm').mockReturnValue(false)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete window.offizMotor; window.getSelection()?.removeAllRanges() })
async function abrirPeca() {
  fireEvent.click(await screen.findByRole('button', { name: /Petição da empresa/ }))
  return within(await screen.findByRole('dialog', { name: 'Peça: Petição da empresa' }))
}

it('excluir peça confirma o alvo e irreversibilidade e cancela só a confirmação com Escape', async () => {
  render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  const modal = await abrirPeca(); const origem = modal.getByRole('button', { name: 'Excluir' }); origem.focus(); fireEvent.click(origem)
  const confirmacao = screen.getByRole('dialog', { name: 'Excluir peça' })
  expect(confirmacao).toHaveTextContent('Petição da empresa'); expect(confirmacao).toHaveTextContent('não pode ser desfeita')
  fireEvent.keyDown(within(confirmacao).getByRole('button', { name: 'Cancelar' }), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Excluir peça' })).not.toBeInTheDocument())
  expect(screen.getByRole('dialog', { name: 'Peça: Petição da empresa' })).toBeInTheDocument(); expect(origem).toHaveFocus(); expect(api.del).not.toHaveBeenCalled()
})

it('excluir peça usa somente seu id e falha conserva conteúdo e botão para repetir', async () => {
  vi.mocked(api.del).mockRejectedValueOnce(new Error('Sem conexão'))
  render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click((await abrirPeca()).getByRole('button', { name: 'Excluir' }))
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Excluir peça' })).getByRole('button', { name: 'Excluir peça' }))
  await waitFor(() => expect(api.del).toHaveBeenCalledExactlyOnceWith('/predios/3/juris/pecas/81'))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Não foi possível excluir a peça.'))
  expect(screen.getByText(peca.conteudo)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Excluir' })).toBeEnabled()
})

it('restaurar confirma a versão e cancelamento conserva histórico e modal da peça', async () => {
  render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click((await abrirPeca()).getByRole('button', { name: 'Histórico' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Restaurar' }))
  const confirmacao = screen.getByRole('dialog', { name: 'Restaurar versão' })
  expect(confirmacao).toHaveTextContent('versão 1'); expect(confirmacao).toHaveTextContent('versão atual fica guardada')
  fireEvent.keyDown(within(confirmacao).getByRole('button', { name: 'Cancelar' }), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Restaurar versão' })).not.toBeInTheDocument())
  expect(screen.getByRole('dialog', { name: 'Histórico de versões' })).toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Peça: Petição da empresa' })).toBeInTheDocument(); expect(api.post).not.toHaveBeenCalled()
})

it('restaurar envia a versão escolhida uma única vez', async () => {
  render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click((await abrirPeca()).getByRole('button', { name: 'Histórico' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Restaurar' }))
  const confirmar = within(screen.getByRole('dialog', { name: 'Restaurar versão' })).getByRole('button', { name: 'Restaurar versão' })
  fireEvent.click(confirmar); fireEvent.click(confirmar)
  await waitFor(() => expect(api.post).toHaveBeenCalledExactlyOnceWith('/predios/3/juris/pecas/81/versoes/1/restaurar'))
})

it('falha inicial da lista explica e permite recarregar sem vazio falso', async () => {
  let falhar = true
  vi.mocked(api.get).mockImplementation(async url => { if (url.endsWith('/casos/7/pecas') && falhar) throw new Error('Sem conexão'); return resposta(url) as never })
  render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar as peças do caso.')
  expect(screen.queryByText(/Nenhuma peça gerada ainda/)).not.toBeInTheDocument()
  falhar = false; fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByRole('button', { name: /Petição da empresa/ })).toBeInTheDocument()
})

it('lista atrasada não substitui as peças do caso escolhido depois', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/casos/7/pecas') ? new Promise(resolve => { resolver = resolve }) as never : url.endsWith('/casos/8/pecas') ? { pecas: [{ ...peca, id: 82, caso_id: 8, titulo: 'Peça do caso atual' }] } as never : resposta(url) as never)
  const view = render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  view.rerender(<PecasCaso orgId={3} slug="juris" casoId={8} />)
  await screen.findByRole('button', { name: /Peça do caso atual/ })
  await act(async () => resolver({ pecas: [peca] }))
  expect(screen.queryByRole('button', { name: /Petição da empresa/ })).not.toBeInTheDocument()
})

it('abertura atrasada não mostra a peça em outro caso', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/pecas/81') ? new Promise(resolve => { resolver = resolve }) as never : resposta(url) as never)
  const view = render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click(await screen.findByRole('button', { name: /Petição da empresa/ }))
  view.rerender(<PecasCaso orgId={3} slug="juris" casoId={8} />)
  await act(async () => resolver(peca))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('falha do histórico tem retry e conserva o conteúdo da peça', async () => {
  let falhar = true
  vi.mocked(api.get).mockImplementation(async url => { if (url.endsWith('/versoes') && falhar) throw new Error('Sem conexão'); return resposta(url) as never })
  render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click((await abrirPeca()).getByRole('button', { name: 'Histórico' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o histórico.')
  falhar = false; fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByRole('button', { name: 'Restaurar' })).toBeInTheDocument()
  expect(screen.getByText(peca.conteudo)).toBeInTheDocument()
})

it('edição manual com falha conserva o texto digitado e não registra versão nem sucesso', async () => {
  vi.mocked(api.put).mockRejectedValueOnce(new Error('Sem conexão'))
  render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click((await abrirPeca()).getByRole('button', { name: 'Editar' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Conteúdo da peça em edição' }), { target: { value: 'Minha revisão exata' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar edição' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalledWith('Não foi possível salvar a edição.'))
  expect(screen.getByDisplayValue('Minha revisão exata')).toBeInTheDocument(); expect(contexto.sucesso).not.toHaveBeenCalled()
})

it('edição atrasada de modal fechado não mostra toast nem altera o caso atual', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.put).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click((await abrirPeca()).getByRole('button', { name: 'Editar' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Conteúdo da peça em edição' }), { target: { value: 'Minha revisão' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar edição' }))
  view.rerender(<PecasCaso orgId={4} slug="juris" casoId={8} />)
  await act(async () => resolver({ ...peca, conteudo: 'Resposta da peça anterior', versao: 3 }))
  expect(contexto.sucesso).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('Escape em refazer fecha somente a caixa interna e não chama geração', async () => {
  render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click((await abrirPeca()).getByRole('button', { name: 'Refazer com IA' }))
  fireEvent.keyDown(screen.getByRole('dialog', { name: 'Refazer peça com IA' }), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Refazer peça com IA' })).not.toBeInTheDocument())
  expect(screen.getByRole('dialog', { name: 'Peça: Petição da empresa' })).toBeInTheDocument(); expect(api.post).not.toHaveBeenCalled()
})

it('falha do catálogo de tipos permite retry sem afirmar que não existe tipo disponível', async () => {
  let falhar = true
  vi.mocked(api.get).mockImplementation(async url => { if (url.endsWith('/pecas-tipos') && falhar) throw new Error('Sem conexão'); return resposta(url) as never })
  render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click(screen.getByRole('button', { name: 'Gerar peça' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar os tipos de peça.')
  expect(screen.queryByRole('option', { name: 'Nenhum tipo disponível' })).not.toBeInTheDocument()
  falhar = false; fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByRole('option', { name: 'Inicial' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('falha parcial da biblioteca é visível, mantém referência disponível e retry conserva instruções', async () => {
  let falhar = true
  vi.mocked(api.get).mockImplementation(async url => {
    if (url.endsWith('/biblioteca?tipo=modelo')) { if (falhar) throw new Error('Sem conexão'); return { itens: [{ id: 101, titulo: 'Modelo do cliente', tipo_peca: 'inicial' }] } as never }
    if (url.endsWith('/biblioteca?tipo=doutrina')) return { itens: [{ id: 102, titulo: 'Doutrina disponível' }] } as never
    return resposta(url) as never
  })
  render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click(screen.getByRole('button', { name: 'Gerar peça' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar parte das referências')
  expect(screen.getByRole('checkbox', { name: 'Doutrina disponível' })).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Instruções (opcional)' }), { target: { value: 'Preserve o pedido do cliente' } })
  falhar = false; fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(await screen.findByRole('option', { name: 'Modelo do cliente' })).toBeInTheDocument()
  expect(screen.getByDisplayValue('Preserve o pedido do cliente')).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('feedback atrasado não aparece como avaliação do outro caso', async () => {
  let resolver!: (value: unknown) => void
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click((await abrirPeca()).getByRole('button', { name: 'Avaliar peça como boa' }))
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
  view.rerender(<PecasCaso orgId={4} slug="juris" casoId={8} />)
  await act(async () => resolver({}))
  expect(contexto.sucesso).not.toHaveBeenCalled(); expect(screen.queryByText('avaliada — obrigado!')).not.toBeInTheDocument()
})

it('aceitação atrasada de comentário não informa ajuste nem substitui outra peça', async () => {
  let resolver!: (value: unknown) => void
  const comentario = { id: 91, trecho: 'Trecho original', instrucao: 'Meu ajuste', proposta_atual: 'Nova proposta', status: 'pendente' }
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/pecas/81') ? { ...peca, comentarios: [comentario] } as never : resposta(url) as never)
  vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const view = render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click((await abrirPeca()).getByRole('button', { name: 'Aceitar' }))
  view.rerender(<PecasCaso orgId={4} slug="juris" casoId={8} />)
  await act(async () => resolver({ peca: { ...peca, versao: 3 }, comentario: { ...comentario, status: 'aceito' } }))
  expect(contexto.sucesso).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('exportação docx atrasada não abre download depois de mudar o contexto', async () => {
  let resolver!: (value: Blob) => void
  contexto.empacotar.mockImplementationOnce(() => new Promise(resolve => { resolver = resolve }))
  const criarUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:teste-local')
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const view = render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click((await abrirPeca()).getByRole('button', { name: '.docx' }))
  await waitFor(() => expect(contexto.empacotar).toHaveBeenCalledTimes(1))
  view.rerender(<PecasCaso orgId={4} slug="juris" casoId={8} />)
  await act(async () => resolver(new Blob(['Conteúdo de teste'])))
  expect(criarUrl).not.toHaveBeenCalled()
})

it('recusa de saldo conserva pedido, referências e modo premium sem mudar o payload contratado', async () => {
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/biblioteca?tipo=modelo') ? { itens: [{ id: 101, titulo: 'Modelo do cliente', tipo_peca: 'inicial' }] } as never : url.endsWith('/biblioteca?tipo=doutrina') ? { itens: [{ id: 102, titulo: 'Doutrina disponível' }] } as never : resposta(url) as never)
  vi.mocked(api.post).mockImplementation(async url => { if (url.endsWith('/casos/7/pecas')) throw new Error('Sem saldo'); return {} })
  render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click(screen.getByRole('button', { name: 'Gerar peça' }))
  await screen.findByRole('option', { name: 'Modelo do cliente' })
  fireEvent.change(screen.getByRole('combobox', { name: 'Modelo de referência (opcional)' }), { target: { value: '101' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Doutrina disponível' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Usar o modelo mais forte (mais lento e mais caro)' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Área do direito' }), { target: { value: 'trabalhista' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Instruções (opcional)' }), { target: { value: '  Meu pedido de revisão  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Gerar peça' }))
  await waitFor(() => expect(contexto.falha).toHaveBeenCalled())
  expect(api.post).toHaveBeenCalledWith('/predios/3/juris/casos/7/pecas', { tipo: 'inicial', instrucoes: 'Meu pedido de revisão', premium: true, area_direito: 'trabalhista', modelo_id: 101, doutrina_ids: [102] })
  expect(screen.getByRole('textbox', { name: 'Instruções (opcional)' })).toHaveValue('  Meu pedido de revisão  ')
  expect(screen.getByRole('combobox', { name: 'Modelo de referência (opcional)' })).toHaveValue('101')
  expect(screen.getByRole('checkbox', { name: 'Doutrina disponível' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Usar o modelo mais forte (mais lento e mais caro)' })).toBeChecked()
  expect(contexto.sucesso).not.toHaveBeenCalled()
})

it.each(['gerar', 'refazer', 'comentar', 'regenerar'] as const)('%s usa o motor desta janela e falha sem repetir pela API', async acao => {
  window.offizMotor = { chatDeviceId: 'dispositivo-local-do-teste' } as OffizMotorBridge
  const comentario = { id: 91, trecho: peca.conteudo, instrucao: 'Meu ajuste', proposta_atual: 'Nova proposta', status: 'pendente' }
  vi.mocked(api.get).mockImplementation(async url => url.endsWith('/pecas/81') ? { ...peca, comentarios: [comentario] } as never : resposta(url) as never)
  const rota = acao === 'gerar' ? '/predios/3/juris/casos/7/pecas' : acao === 'refazer' ? '/predios/3/juris/pecas/81/refazer' : acao === 'comentar' ? '/predios/3/juris/pecas/81/comentarios' : '/predios/3/juris/comentarios/91/regenerar'
  vi.mocked(api.post).mockImplementation(async url => {
    if (url === rota) throw new Error('Motor local indisponível')
    return {}
  })
  render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  if (acao === 'gerar') {
    fireEvent.click(screen.getByRole('button', { name: 'Gerar peça' }))
    await screen.findByRole('option', { name: 'Inicial' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Instruções (opcional)' }), { target: { value: 'Preserve meus fatos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gerar peça' }))
  } else {
    const modal = await abrirPeca()
    if (acao === 'refazer') {
      fireEvent.click(modal.getByRole('button', { name: 'Refazer com IA' }))
      fireEvent.click(screen.getByRole('button', { name: 'Refazer peça' }))
    } else if (acao === 'regenerar') {
      fireEvent.click(modal.getByRole('button', { name: 'Regenerar' }))
      fireEvent.click(screen.getByRole('button', { name: 'Gerar nova proposta' }))
    } else {
      const range = document.createRange()
      range.selectNodeContents(document.querySelector('.pecas-conteudo')!)
      range.getBoundingClientRect = () => ({ top: 80, left: 80, width: 200 } as DOMRect)
      const selecao = window.getSelection()!
      selecao.removeAllRanges(); selecao.addRange(range)
      fireEvent(document, new Event('selectionchange'))
      fireEvent.click(await screen.findByRole('button', { name: 'Pedir ajuste à IA' }))
      fireEvent.change(screen.getByPlaceholderText(/deixe mais formal/), { target: { value: 'Melhore a clareza sem alterar os fatos' } })
      fireEvent.click(screen.getByRole('button', { name: 'Gerar proposta' }))
    }
  }
  await waitFor(() => expect(contexto.falha).toHaveBeenCalled())
  const chamadas = vi.mocked(api.post).mock.calls.filter(([url]) => url === rota)
  expect(chamadas).toHaveLength(1)
  expect(chamadas[0][1]).toEqual(expect.objectContaining({ motor_local: 'dispositivo-local-do-teste' }))
  expect(contexto.sucesso).not.toHaveBeenCalled()
  expect(api.put).not.toHaveBeenCalled()
})

it('preview de assinatura explica a conexão, sem tarifa de API ou promoção falsa de modelo', async () => {
  vi.mocked(api.post).mockResolvedValue({ tokens_estimados: 1200, tier: 'normal', custo_estimado_brl: null, modo_execucao: 'cli', modalidade: 'assinatura' })
  render(<PecasCaso orgId={3} slug="juris" casoId={7} />)
  fireEvent.click(screen.getByRole('button', { name: 'Gerar peça' }))
  expect(await screen.findByText(/assinatura · sem cobrança de API/)).toBeVisible()
  expect(screen.getByRole('note')).toHaveTextContent('modelo selecionados no aplicativo')
  expect(screen.queryByRole('checkbox', { name: /modelo mais forte/ })).not.toBeInTheDocument()
  expect(screen.queryByText(/R\$/)).not.toBeInTheDocument()
})

import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { MARCADOR_SABATINA, SetupSabatina } from './SetupSabatina'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn(), postForm: vi.fn() } }))
vi.mock('../Toasts', () => ({ useToasts: () => ({ sucesso: vi.fn(), falha: vi.fn() }) }))
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.mocked(api.get).mockResolvedValue({ conteudo: '' }); vi.mocked(api.post).mockResolvedValue({}) })
afterEach(() => vi.useRealTimers())
const aguardar = () => act(async () => { await vi.advanceTimersByTimeAsync(1400) })
const montar = (canon: string) => render(<SetupSabatina orgId={1} slug="juris" canonAtual={canon} aoConcluir={vi.fn()} aoFechar={vi.fn()} />)

it.each(['cânon inalterado', 'resposta nova inalterada', 'resposta nova editada'])('continuar depois de Corrigir preserva a procedência: %s', async caso => {
  const continuar = vi.fn()
  const texto = 'Sou psicóloga.'
  const canon = `${caso === 'cânon inalterado' ? '## O que a empresa faz\nSou psicóloga.\n\n' : ''}## Quem é o cliente\nAdultos.\n`
  render(<SetupSabatina orgId={1} slug="juris" canonAtual={canon} aoConcluir={vi.fn()} aoFechar={vi.fn()} aoConversar={continuar} />)
  await aguardar()
  if (caso !== 'cânon inalterado') {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: texto } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
    await aguardar()
  }
  fireEvent.click(screen.getByRole('button', { name: texto }))
  await aguardar()
  expect(screen.getByRole('textbox')).toHaveValue(texto)
  if (caso === 'resposta nova editada') fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Sou psicóloga clínica.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Prefiro começar pelo meu pedido' }))
  const esperado = caso === 'cânon inalterado' ? undefined : { textos: [caso === 'resposta nova editada' ? 'Sou psicóloga clínica.' : texto] }
  expect(continuar).toHaveBeenCalledWith(esperado)
  expect(api.post).not.toHaveBeenCalled()
})

it('leva só o texto informado nesta sessão e a digitação pendente para continuar no chat', async () => {
  const continuar = vi.fn()
  render(<SetupSabatina orgId={1} slug="juris" canonAtual={'## Quem é o cliente\n- Adultos.\n'} aoConcluir={vi.fn()} aoFechar={vi.fn()} aoConversar={continuar} />)
  await aguardar()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Sou psicóloga e faço consultas online.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await aguardar()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Quero divulgar as consultas.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Prefiro começar pelo meu pedido' }))
  expect(continuar).toHaveBeenCalledWith({ textos: ['Sou psicóloga e faço consultas online.', 'Quero divulgar as consultas.'] })
  expect(api.post).not.toHaveBeenCalled()
})

it('continua com o resumo editado e selecionado, sem ressuscitar texto corrigido ou retirado', async () => {
  const continuar = vi.fn()
  render(<SetupSabatina orgId={1} slug="juris" canonAtual={'## Quem é o cliente\n- Adultos.\n'} aoConcluir={vi.fn()} aoFechar={vi.fn()} aoConversar={continuar} />)
  await aguardar()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Sou psicóloga.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await aguardar()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Consultas online.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await aguardar()
  for (let i = 0; i < 4; i++) { fireEvent.click(screen.getByRole('button', { name: 'Não sei / deixar para depois' })); await aguardar() }
  fireEvent.change(screen.getByRole('textbox', { name: 'Texto de O que a empresa faz' }), { target: { value: 'Sou psicóloga clínica.' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Produto ou serviço principal' }))
  fireEvent.click(screen.getByRole('button', { name: 'Continuar conversando' }))
  expect(continuar).toHaveBeenCalledWith({ textos: ['Sou psicóloga clínica.'] })
  expect(api.post).not.toHaveBeenCalled()
})

it('usa resposta existente e pergunta somente a próxima lacuna', async () => {
  montar('## O que a empresa faz\n- Sou psicóloga.\n\n## Quem é o cliente\n- Adultos.\n')
  await aguardar()
  expect(screen.getByRole('textbox', { name: 'Qual serviço, produto ou trabalho é prioridade hoje?' })).toBeInTheDocument()
  expect(screen.queryByText('Pra começar: o que a sua empresa faz?')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Sou psicóloga.' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('marcador antigo sozinho não vira perfil conhecido nem resposta a pergunta', async () => {
  montar(MARCADOR_SABATINA)
  await aguardar()
  expect(screen.getByRole('textbox', { name: 'Pra começar: o que a sua empresa faz?' })).toBeInTheDocument()
  expect(api.post).not.toHaveBeenCalled()
})

it('não sei ou pode escolher não viram fatos e completar o roteiro não grava automaticamente', async () => {
  montar('')
  await aguardar()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Sou psicóloga.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await aguardar()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Não sei' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await aguardar()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Pode escolher' } })
  fireEvent.click(screen.getByRole('button', { name: 'Enviar' }))
  await aguardar()
  for (let i = 0; i < 4; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Não sei / deixar para depois' }))
    await aguardar()
  }
  expect(screen.getByRole('region', { name: 'Confira o perfil' })).toBeInTheDocument()
  expect(screen.getAllByRole('textbox')).toHaveLength(1)
  expect(screen.getByRole('textbox')).toHaveValue('Sou psicóloga.')
  expect(api.post).not.toHaveBeenCalled()
})

it('oferece um seletor de arquivos nomeado e alcançável pelo teclado sem tornar a entrevista obrigatória', async () => {
  montar('')
  await aguardar()
  const campo = screen.getByLabelText('Escolher arquivos da empresa')
  expect(campo).toHaveAttribute('type', 'file')
  expect(campo).not.toHaveAttribute('hidden')
  campo.focus()
  expect(campo).toHaveFocus()
  expect(screen.getByRole('button', { name: 'Não sei / deixar para depois' })).toBeEnabled()
  expect(api.post).not.toHaveBeenCalled()
})

it('preserva o foco no seletor quando a primeira pergunta chega depois', async () => {
  montar('')
  const campo = screen.getByLabelText('Escolher arquivos da empresa')
  campo.focus()
  await aguardar()
  expect(screen.getByRole('textbox', { name: 'Pra começar: o que a sua empresa faz?' })).toBeEnabled()
  expect(campo).toHaveFocus()
  expect(api.postForm).not.toHaveBeenCalled()
})

it('preserva o controle externo escolhido antes de a pergunta chegar', async () => {
  render(<><button type="button">Outra seção</button><SetupSabatina orgId={1} slug="juris" canonAtual="" aoConcluir={vi.fn()} aoFechar={vi.fn()} /></>)
  const externo = screen.getByRole('button', { name: 'Outra seção' })
  externo.focus()
  await aguardar()
  expect(externo).toHaveFocus()
})

it.each(['arquivos', 'fora'])('não move o foco após clique rápido em %s que mantém o body ativo', async alvo => {
  render(<><div data-testid="fora">Outra parte da tela</div><SetupSabatina orgId={1} slug="juris" canonAtual="" aoConcluir={vi.fn()} aoFechar={vi.fn()} /></>)
  const lugar = alvo === 'arquivos' ? screen.getByText('Arraste aqui — ou clique para escolher') : screen.getByTestId('fora')
  expect(document.body).toHaveFocus()
  fireEvent.pointerDown(lugar)
  fireEvent.click(lugar)
  expect(document.body).toHaveFocus()
  await aguardar()
  expect(document.body).toHaveFocus()
  expect(api.post).not.toHaveBeenCalled()
  expect(api.postForm).not.toHaveBeenCalled()
})

it('oferece foco inicial no campo quando a pessoa ainda não escolheu outro controle', async () => {
  montar('')
  await aguardar()
  expect(screen.getByRole('textbox')).toHaveFocus()
})

it.each(['teclado', 'botão'])('devolve o foco ao campo após uma resposta por %s', async maneira => {
  montar('')
  await aguardar()
  const campo = screen.getByRole('textbox')
  fireEvent.change(campo, { target: { value: 'Sou psicóloga.' } })
  if (maneira === 'teclado') fireEvent.keyDown(campo, { key: 'Enter' })
  else {
    const botao = screen.getByRole('button', { name: 'Enviar' })
    botao.focus()
    fireEvent.pointerDown(botao)
    fireEvent.click(botao)
  }
  await aguardar()
  expect(screen.getByRole('textbox', { name: 'Qual serviço, produto ou trabalho é prioridade hoje?' })).toHaveFocus()
  expect(api.post).not.toHaveBeenCalled()
})

it('a resposta pendente não retira o foco de outra ação escolhida depois de enviar', async () => {
  render(<><button type="button">Outra seção</button><SetupSabatina orgId={1} slug="juris" canonAtual="" aoConcluir={vi.fn()} aoFechar={vi.fn()} /></>)
  await aguardar()
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Sou psicóloga.' } })
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
  const externo = screen.getByRole('button', { name: 'Outra seção' })
  fireEvent.pointerDown(externo)
  externo.focus()
  await aguardar()
  expect(externo).toHaveFocus()
})

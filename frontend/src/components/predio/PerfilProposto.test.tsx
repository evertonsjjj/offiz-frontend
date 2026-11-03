import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { ApiError, api } from '../../lib/api'
import { PerfilProposto } from './PerfilProposto'
import type { SugestaoCanon } from '../../lib/types'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn() } }))
const proposta: SugestaoCanon = { tipo: 'canon', resumo: 'Seu perfil para os próximos trabalhos.', secoes: [
  { secao: 'Tom de voz', conteudo: 'Acolhedor e leve.' }, { secao: 'Público', conteudo: 'Adultos de Curitiba.' },
] }
const base = '# Perfil\n\n## Tom de voz\nFormal.\n\n## Regra anterior\nNão expor pacientes.\n'
const url = '/orgs/7/predio/conhecimento/canon'
beforeEach(() => { vi.resetAllMocks(); vi.mocked(api.get).mockResolvedValue({ conteudo: base }) })

it('compara com o perfil atual e só confirma o texto editado e as seções selecionadas', async () => {
  const confirmar = vi.fn().mockResolvedValue(undefined)
  render(<PerfilProposto proposta={proposta} canonUrl={url} podeSalvar salvando={false} aoConfirmar={confirmar} aoContinuar={vi.fn()} />)
  expect(confirmar).not.toHaveBeenCalled()
  expect(await screen.findByText('Formal.')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Texto de Tom de voz' }), { target: { value: 'Direto e acolhedor, sem frases prontas.' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Público' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar e guardar' }))
  await waitFor(() => expect(confirmar).toHaveBeenCalledExactlyOnceWith({ base, secoes: [{ secao: 'Tom de voz', conteudo: 'Direto e acolhedor, sem frases prontas.' }], concluir: false }))
})

it('conflito exige nova comparação, mantém correções e não repete a gravação sozinho', async () => {
  const confirmar = vi.fn().mockRejectedValueOnce(new ApiError(409, 'O perfil foi atualizado.')).mockResolvedValue(undefined)
  render(<PerfilProposto proposta={proposta} canonUrl={url} podeSalvar salvando={false} aoConfirmar={confirmar} aoContinuar={vi.fn()} />)
  await screen.findByText('Formal.')
  fireEvent.change(screen.getByRole('textbox', { name: 'Texto de Tom de voz' }), { target: { value: 'Meu texto corrigido.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar e guardar' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('button', { name: 'Confirmar e guardar' })).toBeDisabled()
  const novaBase = base.replace('Formal.', 'Descontraído.')
  vi.mocked(api.get).mockResolvedValueOnce({ conteudo: novaBase })
  fireEvent.click(screen.getByRole('button', { name: 'Reabrir comparação' }))
  await screen.findByText('Descontraído.')
  expect(screen.getByRole('textbox', { name: 'Texto de Tom de voz' })).toHaveValue('Meu texto corrigido.')
  expect(confirmar).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar e guardar' }))
  await waitFor(() => expect(confirmar).toHaveBeenLastCalledWith(expect.objectContaining({ base: novaBase })))
})

it('falha na leitura não permite sobrescrever perfil e uma leitura cancelada não substitui a atual', async () => {
  let terminar!: (value: { conteudo: string }) => void
  vi.mocked(api.get).mockReturnValueOnce(new Promise(resolve => { terminar = resolve }))
  const confirmar = vi.fn()
  const { rerender } = render(<PerfilProposto key="7" proposta={proposta} canonUrl={url} podeSalvar salvando={false} aoConfirmar={confirmar} aoContinuar={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Confirmar e guardar' })).toBeDisabled()
  vi.mocked(api.get).mockRejectedValueOnce(new Error('offline'))
  rerender(<PerfilProposto key="8" proposta={proposta} canonUrl="/orgs/8/predio/conhecimento/canon" podeSalvar salvando={false} aoConfirmar={confirmar} aoContinuar={vi.fn()} />)
  await screen.findByRole('alert')
  await act(async () => terminar({ conteudo: '## Tom de voz\nOutra empresa.' }))
  expect(screen.queryByText('Outra empresa.')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Confirmar e guardar' })).toBeDisabled()
  expect(confirmar).not.toHaveBeenCalled()
})

it('membro vê o resumo mas não recebe ação de escrita nem consulta indevida', () => {
  render(<PerfilProposto proposta={proposta} canonUrl={url} podeSalvar={false} salvando={false} aoConfirmar={vi.fn()} aoContinuar={vi.fn()} />)
  expect(screen.getByRole('textbox', { name: 'Texto de Tom de voz' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Confirmar e guardar' })).toBeDisabled()
  expect(api.get).not.toHaveBeenCalled()
})

it('encerrar a preparação requer escolha expressa e não aceita seção vazia', async () => {
  const confirmar = vi.fn().mockResolvedValue(undefined)
  render(<PerfilProposto proposta={proposta} canonUrl={url} podeSalvar salvando={false} aoConfirmar={confirmar} aoContinuar={vi.fn()} />)
  await screen.findByText('Formal.')
  fireEvent.change(screen.getByRole('textbox', { name: 'Texto de Público' }), { target: { value: '   ' } })
  expect(screen.getByRole('button', { name: 'Confirmar e guardar' })).toBeDisabled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Público' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Já revisei o perfil e quero encerrar esta preparação.' }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar e guardar' }))
  await waitFor(() => expect(confirmar).toHaveBeenCalledWith(expect.objectContaining({ concluir: true })))
  expect(within(screen.getByRole('region', { name: 'Confira o perfil' })).getAllByRole('textbox')).toHaveLength(2)
})

it.each([true, false])('releitura da proposta conserva a origem das seções visíveis, somente correções: %s', async continuarSomenteCorrecoes => {
  const continuar = vi.fn(), confirmar = vi.fn()
  const props = { canonUrl: url, podeSalvar: true, salvando: false, aoConfirmar: confirmar, aoContinuar: continuar, continuarSomenteCorrecoes }
  const view = render(<PerfilProposto proposta={proposta} {...props} />)
  await screen.findByText('Formal.')
  fireEvent.change(screen.getByRole('textbox', { name: 'Texto de Tom de voz' }), { target: { value: 'Meu tom corrigido.' } })
  view.rerender(<PerfilProposto proposta={{ ...proposta, secoes: [{ secao: 'Público', conteudo: 'Uma proposta nova recebida durante a revisão.' }] }} {...props} />)
  expect(screen.getByRole('textbox', { name: 'Texto de Tom de voz' })).toHaveValue('Meu tom corrigido.')
  expect(screen.getByRole('textbox', { name: 'Texto de Público' })).toHaveValue('Adultos de Curitiba.')
  fireEvent.click(screen.getByRole('button', { name: 'Continuar conversando' }))
  expect(continuar).toHaveBeenCalledExactlyOnceWith(continuarSomenteCorrecoes
    ? [{ secao: 'Tom de voz', conteudo: 'Meu tom corrigido.' }]
    : [{ secao: 'Tom de voz', conteudo: 'Meu tom corrigido.' }, { secao: 'Público', conteudo: 'Adultos de Curitiba.' }])
  expect(confirmar).not.toHaveBeenCalled()
})

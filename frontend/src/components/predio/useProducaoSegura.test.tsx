import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StrictMode, type PropsWithChildren } from 'react'
import { webcrypto } from 'node:crypto'
import { api, API_V1, ApiError, clearTokens, setTokens } from '../../lib/api'
import { hashCorpoProducao, useProducaoSegura } from './useProducaoSegura'

vi.mock('../../lib/api', async original => ({ ...await original<typeof import('../../lib/api')>(), api: { get: vi.fn(), post: vi.fn() } }))
const body = { pedido: 'Uma arte para o jogo de amanhã', dados: { Data: '10/10' }, office_slug: 'conteudo' }
const uuid = () => { const chamadas = vi.mocked(api.post).mock.calls; return (chamadas[chamadas.length - 1][1] as { request_id: string }).request_id }
const confirmado = (request_id: string, id = 91) => ({ id, request_id, office_slug: 'conteudo', replayed: false })
const registros = () => Object.keys(localStorage).filter(k => k.startsWith('offiz:producao:'))
const consultas = () => vi.mocked(api.get).mock.calls.filter(([path]) => path !== '/auth/me')
const consulta = (resultado: unknown, falha = false) => vi.mocked(api.get).mockImplementation(async path => {
  if (path === '/auth/me') return { id: 7 }
  if (falha) throw resultado
  return resultado
})
const montar = async (salvar = vi.fn()) => {
  const tela = renderHook(() => useProducaoSegura('/orgs/1', '["conteudo",3]', 'conteudo', salvar))
  await waitFor(() => expect(tela.result.current.estado).toBe('pronto'))
  return { salvar, ...tela }
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto)
  vi.resetAllMocks(); localStorage.clear(); sessionStorage.clear(); setTokens('fixture-access', 'fixture-refresh')
  vi.mocked(api.get).mockImplementation(async path => { if (path === '/auth/me') return { id: 7 }; throw new Error(`Consulta inesperada: ${path}`) })
})
afterEach(() => { vi.unstubAllGlobals() })

it('dois cliques no mesmo instante enviam uma única intenção, antes do React atualizar o botão', async () => {
  let concluir!: (v: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(r => { concluir = r }))
  const { result, salvar } = await montar()
  await act(async () => { void result.current.enviar(body); void result.current.enviar(body) })
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  expect(result.current.podeEditar).toBe(false)
  expect(salvar).not.toHaveBeenCalled()
  await act(async () => concluir(confirmado(uuid())))
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91)
  expect(registros()).toHaveLength(0)
  await act(async () => { await result.current.enviar(body) })
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('a operação de ajuste envia e recupera pela mesma rota com ID específico', async () => {
  const salvar = vi.fn()
  const rota = '/orgs/1/biblioteca/35/ajustes'
  const { result } = renderHook(() => useProducaoSegura('/orgs/1', 'ajuste35-92', 'conteudo', salvar, {
    rota, extrairId: r => r && typeof r === 'object' && 'job_id' in r ? r.job_id : null,
  }))
  await waitFor(() => expect(result.current.estado).toBe('pronto'))
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  await act(async () => { await result.current.enviar({ entrega_id: 92, texto: 'Clareie o fundo.' }) })
  const requestId = uuid()
  expect(api.post).toHaveBeenCalledWith(rota, { entrega_id: 92, texto: 'Clareie o fundo.', request_id: requestId })
  consulta({ job_id: 91, request_id: requestId, office_slug: 'conteudo', replayed: true })
  await act(async () => { await result.current.conferir() })
  expect(consultas()).toEqual([[`${rota}/${requestId}`]])
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91)
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('o extrator de ajuste não aceita um ID genérico como confirmação dessa operação', async () => {
  const salvar = vi.fn()
  const { result } = renderHook(() => useProducaoSegura('/orgs/1', 'ajuste35-92', 'conteudo', salvar, {
    rota: '/orgs/1/biblioteca/35/ajustes', extrairId: r => r && typeof r === 'object' && 'job_id' in r ? r.job_id : null,
  }))
  await waitFor(() => expect(result.current.estado).toBe('pronto'))
  vi.mocked(api.post).mockImplementation(async (_path, v) => confirmado((v as { request_id: string }).request_id))
  await act(async () => { await result.current.enviar(body) })
  expect(result.current.estado).toBe('incerto')
  expect(salvar).not.toHaveBeenCalled()
  expect(registros()).toHaveLength(1)
})

it('rotas de operação diferentes não herdam o recibo de outro envio mesmo com alvo igual', async () => {
  const salvar = vi.fn()
  const montarRota = (rota: string) => renderHook(() => useProducaoSegura('/orgs/1', 'mesmo-alvo', 'conteudo', salvar, {
    rota, extrairId: r => r && typeof r === 'object' && 'job_id' in r ? r.job_id : null,
  }))
  const primeira = montarRota('/orgs/1/biblioteca/35/ajustes')
  await waitFor(() => expect(primeira.result.current.estado).toBe('pronto'))
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  await act(async () => { await primeira.result.current.enviar(body) })
  const requestId = uuid()
  primeira.unmount()
  const outra = montarRota('/orgs/1/biblioteca/36/ajustes')
  await waitFor(() => expect(outra.result.current.estado).toBe('pronto'))
  expect(outra.result.current.temEnvioPendente).toBe(false)
  outra.unmount()
  const recuperada = montarRota('/orgs/1/biblioteca/35/ajustes')
  await waitFor(() => expect(recuperada.result.current.temEnvioPendente).toBe(true))
  consulta({ job_id: 91, request_id: requestId, office_slug: 'conteudo', replayed: true })
  await act(async () => { await recuperada.result.current.conferir() })
  expect(consultas()).toEqual([[`/orgs/1/biblioteca/35/ajustes/${requestId}`]])
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91)
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('recupera a resposta perdida por GET, sem repetir a criação do trabalho', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Conexão interrompida'))
  const { result, salvar } = await montar()
  await act(async () => { await result.current.enviar(body) })
  const id = uuid()
  expect(result.current.temEnvioPendente).toBe(true)
  consulta({ ...confirmado(id), replayed: true })
  await act(async () => { await result.current.conferir() })
  expect(consultas()).toEqual([[`/orgs/1/producao/${id}`]])
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91)
})

it('fechar e reabrir conserva só o identificador e exige consulta antes de reenviar', async () => {
  let concluir!: (v: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(r => { concluir = r }))
  const primeira = await montar()
  await act(async () => { void primeira.result.current.enviar(body) })
  const id = uuid()
  primeira.result.current.sair()
  primeira.unmount()
  await act(async () => concluir(confirmado(id)))
  expect(primeira.salvar).not.toHaveBeenCalled()
  const registro = localStorage.getItem(registros()[0])!
  expect(JSON.parse(registro)).toEqual({ versao: 1, request_id: id, criado_em: expect.any(String) })
  expect(registro).not.toContain('amanhã')
  expect(registros()[0]).toContain(API_V1)
  const salvar = vi.fn()
  const segunda = renderHook(() => useProducaoSegura('/orgs/1', '["conteudo",3]', 'conteudo', salvar))
  await waitFor(() => expect(segunda.result.current.temEnvioPendente).toBe(true))
  consulta({ ...confirmado(id), replayed: true })
  await act(async () => { await segunda.result.current.conferir() })
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91)
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('404 na consulta conserva o UUID mesmo quando a nova tentativa demora a chegar', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(500, 'Falha depois do commit'))
  const { result, salvar } = await montar()
  await act(async () => { await result.current.enviar(body) })
  const id = uuid()
  consulta(new ApiError(404, 'Ainda não encontrado'), true)
  await act(async () => { await result.current.conferir() })
  expect(result.current.estado).toBe('repetir')
  expect(api.post).toHaveBeenCalledTimes(1)
  vi.mocked(api.post).mockResolvedValue({ ...confirmado(id), replayed: true })
  await act(async () => { await result.current.enviar(body) })
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual({ ...body, request_id: id })
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91)
})

it('um pedido excluído não é recriado no retry; só uma ação explícita prepara outra intenção', async () => {
  vi.mocked(api.post).mockRejectedValueOnce(new ApiError(0, 'Conexão'))
  const { result, salvar } = await montar()
  await act(async () => { await result.current.enviar(body) })
  const anterior = uuid()
  consulta(new ApiError(410, 'Pedido removido'), true)
  await act(async () => { await result.current.conferir(); await result.current.enviar(body) })
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(salvar).not.toHaveBeenCalled()
  await act(async () => result.current.prepararNovo())
  vi.mocked(api.post).mockImplementation(async (_path, v) => confirmado((v as { request_id: string }).request_id, 92))
  await act(async () => { await result.current.enviar(body) })
  expect(uuid()).not.toBe(anterior)
  expect(salvar).toHaveBeenCalledExactlyOnceWith(92)
})

it.each([
  { id: 91 },
  { id: 91, office_slug: 'juridico', replayed: false },
  { id: 0, office_slug: 'conteudo', replayed: false },
  { id: 91, office_slug: 'conteudo', replayed: 'false' },
])('resposta incompleta ou de outra equipe não confirma nem remove a intenção: %j', async parcial => {
  vi.mocked(api.post).mockImplementation(async (_p, v) => ({ request_id: (v as { request_id: string }).request_id, ...parcial }))
  const { result, salvar } = await montar()
  await act(async () => { await result.current.enviar(body) })
  expect(result.current.estado).toBe('incerto')
  expect(salvar).not.toHaveBeenCalled()
  expect(registros()).toHaveLength(1)
})

it('uma resposta de outra empresa ou sessão não navega nem elimina o UUID anterior', async () => {
  let concluir!: (v: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(r => { concluir = r }))
  const salvar = vi.fn()
  const { result, rerender } = renderHook(({ base }) => useProducaoSegura(base, 'alvo', 'conteudo', salvar), { initialProps: { base: '/orgs/1' } })
  await waitFor(() => expect(result.current.estado).toBe('pronto'))
  await act(async () => { void result.current.enviar(body) })
  const id = uuid()
  rerender({ base: '/orgs/2' })
  clearTokens(); setTokens('outra-conta', 'outro-refresh')
  rerender({ base: '/orgs/2' })
  await act(async () => concluir(confirmado(id)))
  expect(salvar).not.toHaveBeenCalled()
  expect(registros()).toHaveLength(1)
  await waitFor(() => expect(result.current.estado).toBe('pronto'))
})

it('duas telas prontas com pedidos diferentes mantêm intenções independentes no mesmo alvo', async () => {
  const concluir: ((v: unknown) => void)[] = []
  vi.mocked(api.post).mockImplementation(() => new Promise(r => { concluir.push(r) }))
  const primeira = await montar()
  const segunda = await montar()
  await act(async () => { void primeira.result.current.enviar(body) })
  const id1 = uuid()
  await act(async () => { void segunda.result.current.enviar({ ...body, pedido: 'Um vídeo para agradecer à torcida' }) })
  const id2 = uuid()
  expect(api.post).toHaveBeenCalledTimes(2)
  expect(id2).not.toBe(id1)
  expect(consultas()).toHaveLength(0)
  expect(registros()).toHaveLength(2)
  await act(async () => concluir[0](confirmado(id1)))
  expect(primeira.salvar).toHaveBeenCalledExactlyOnceWith(91)
  expect(segunda.salvar).not.toHaveBeenCalled()
  expect(registros()).toHaveLength(1)
  await act(async () => concluir[1](confirmado(id2, 92)))
  expect(segunda.salvar).toHaveBeenCalledExactlyOnceWith(92)
  expect(registros()).toHaveLength(0)
})

it('se não consegue guardar a intenção, não inicia um envio impossível de recuperar', async () => {
  const { result } = await montar()
  const bloquear = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Bloqueado') })
  await act(async () => { await result.current.enviar(body) })
  expect(api.post).not.toHaveBeenCalled()
  expect(result.current.podeEditar).toBe(true)
  expect(result.current.erro).toContain('Não foi possível preparar')
  bloquear.mockRestore()
})

it.each(['novo login', 'fechar o app'])('recupera o UUID com autor confirmado após %s, sem repetir POST nem guardar texto', async evento => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta interrompida'))
  const antes = await montar()
  await act(async () => { await antes.result.current.enviar(body) })
  const id = uuid()
  antes.unmount()
  sessionStorage.clear()
  if (evento === 'novo login') { clearTokens(); setTokens('mesma-pessoa-novo-login', 'novo-refresh') }
  const salvar = vi.fn()
  const depois = renderHook(() => useProducaoSegura('/orgs/1', '["conteudo",3]', 'conteudo', salvar))
  await waitFor(() => expect(depois.result.current.temEnvioPendente).toBe(true))
  if (evento === 'novo login') expect(vi.mocked(api.get).mock.calls.filter(([path]) => path === '/auth/me')).toHaveLength(2)
  consulta({ ...confirmado(id), replayed: true })
  await act(async () => { await depois.result.current.conferir() })
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91)
  expect(registros()).toHaveLength(0)
})

it('confirma o autor no servidor sem usar o cache otimista e coalesce a consulta por sessão', async () => {
  localStorage.setItem('offiz_usuario', JSON.stringify({ id: 99, email: 'antigo@example.invalid' }))
  let identificar!: (v: unknown) => void
  vi.mocked(api.get).mockImplementation(() => new Promise(r => { identificar = r }))
  const a = renderHook(() => useProducaoSegura('/orgs/1', 'alvo', 'conteudo', vi.fn()))
  const b = renderHook(() => useProducaoSegura('/orgs/1', 'outro-alvo', 'conteudo', vi.fn()))
  expect(a.result.current.identificando).toBe(true)
  expect(a.result.current.podeEditar).toBe(false)
  expect(a.result.current.ocupado).toBe(true)
  await act(async () => { await a.result.current.enviar(body) })
  expect(api.post).not.toHaveBeenCalled()
  expect(registros()).toHaveLength(0)
  expect(api.get).toHaveBeenCalledExactlyOnceWith('/auth/me')
  await act(async () => identificar({ id: 7 }))
  await waitFor(() => expect(a.result.current.podeEditar).toBe(true))
  expect(b.result.current.podeEditar).toBe(true)
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Conexão'))
  await act(async () => { await a.result.current.enviar(body) })
  expect(registros()[0]).toContain(':7:')
  expect(registros()[0]).not.toContain(':99:')
})

it.each([new ApiError(503, 'Indisponível'), { id: 0 }, { id: '7' }, null])('autor não confirmado bloqueia POST com aviso e retry: %j', async resposta => {
  vi.mocked(api.get).mockImplementation(async () => { if (resposta instanceof Error) throw resposta; return resposta })
  const tela = renderHook(() => useProducaoSegura('/orgs/1', 'alvo', 'conteudo', vi.fn()))
  await waitFor(() => expect(tela.result.current.precisaVerificarConta).toBe(true))
  expect(tela.result.current.erro).toContain('verificar a conta')
  expect(tela.result.current.podeEditar).toBe(false)
  await act(async () => { await tela.result.current.enviar(body); await tela.result.current.conferir() })
  expect(api.post).not.toHaveBeenCalled()
  expect(registros()).toHaveLength(0)
  vi.mocked(api.get).mockResolvedValue({ id: 7 })
  await act(async () => { await tela.result.current.verificarConta() })
  expect(tela.result.current.podeEditar).toBe(true)
})

it('outro autor não descobre o UUID anterior; voltar ao autor confirmado recupera', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta interrompida'))
  const antes = await montar()
  await act(async () => { await antes.result.current.enviar(body) })
  const id = uuid()
  antes.unmount(); clearTokens(); setTokens('pessoa8', 'refresh8')
  vi.mocked(api.get).mockResolvedValue({ id: 8 })
  const outro = await montar()
  expect(outro.result.current.temEnvioPendente).toBe(false)
  expect(consultas()).toHaveLength(0)
  outro.unmount(); clearTokens(); setTokens('pessoa7-volta', 'refresh7-volta')
  vi.mocked(api.get).mockImplementation(async path => path === '/auth/me' ? { id: 7 } : confirmado(id))
  const voltou = renderHook(() => useProducaoSegura('/orgs/1', '["conteudo",3]', 'conteudo', vi.fn()))
  await waitFor(() => expect(voltou.result.current.temEnvioPendente).toBe(true))
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('identificação antiga de outra conta não habilita o formulário atual nem navega', async () => {
  let concluir!: (v: unknown) => void
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(r => { concluir = r })).mockResolvedValue({ id: 8 })
  const salvar = vi.fn()
  const tela = renderHook(() => useProducaoSegura('/orgs/1', 'alvo', 'conteudo', salvar))
  clearTokens(); setTokens('pessoa8', 'refresh8'); tela.rerender()
  await waitFor(() => expect(tela.result.current.podeEditar).toBe(true))
  await act(async () => concluir({ id: 7 }))
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta interrompida'))
  await act(async () => { await tela.result.current.enviar(body) })
  expect(registros()[0]).toContain(':8:')
  expect(salvar).not.toHaveBeenCalled()
})

it('falha de identificação não abandona o UUID persistente e o retry recupera sem POST', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta interrompida'))
  const antes = await montar()
  await act(async () => { await antes.result.current.enviar(body) })
  const id = uuid()
  antes.unmount(); clearTokens(); setTokens('mesma-pessoa-novo-login', 'refresh')
  vi.mocked(api.get).mockRejectedValue(new ApiError(503, 'Consulta da conta indisponível'))
  const salvar = vi.fn()
  const depois = renderHook(() => useProducaoSegura('/orgs/1', '["conteudo",3]', 'conteudo', salvar))
  await waitFor(() => expect(depois.result.current.precisaVerificarConta).toBe(true))
  await act(async () => { await depois.result.current.enviar(body) })
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(JSON.parse(localStorage.getItem(registros()[0])!)).toEqual({ versao: 1, request_id: id, criado_em: expect.any(String) })
  consulta({ ...confirmado(id), replayed: true })
  await act(async () => { await depois.result.current.verificarConta() })
  expect(depois.result.current.temEnvioPendente).toBe(true)
  await act(async () => { await depois.result.current.conferir() })
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91)
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('voltar ao mesmo alvo não reaplica resposta antiga; a consulta atual recupera uma vez', async () => {
  let concluir!: (v: unknown) => void
  vi.mocked(api.post).mockImplementation(() => new Promise(r => { concluir = r }))
  const salvar = vi.fn()
  const tela = renderHook(({ alvo }) => useProducaoSegura('/orgs/1', alvo, 'conteudo', salvar), { initialProps: { alvo: 'projeto1' } })
  await waitFor(() => expect(tela.result.current.podeEditar).toBe(true))
  await act(async () => { void tela.result.current.enviar(body) })
  const id = uuid()
  tela.rerender({ alvo: 'projeto2' })
  await waitFor(() => expect(tela.result.current.podeEditar).toBe(true))
  tela.rerender({ alvo: 'projeto1' })
  await waitFor(() => expect(tela.result.current.temEnvioPendente).toBe(true))
  await act(async () => concluir(confirmado(id)))
  expect(salvar).not.toHaveBeenCalled()
  expect(registros()).toHaveLength(1)
  expect(tela.result.current.temEnvioPendente).toBe(true)
  consulta({ ...confirmado(id), replayed: true })
  await act(async () => { await tela.result.current.conferir() })
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91)
  expect(api.post).toHaveBeenCalledTimes(1)
})

it('409 de corpo diferente exige conferir a intenção original, sem liberar outra criação', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(409, 'Este envio já foi recebido com outro pedido'))
  const { result, salvar } = await montar()
  await act(async () => { await result.current.enviar(body) })
  const id = uuid()
  expect(result.current.estado).toBe('incerto')
  expect(result.current.podeEditar).toBe(false)
  consulta({ ...confirmado(id), replayed: true })
  await act(async () => { await result.current.conferir() })
  expect(api.post).toHaveBeenCalledTimes(1)
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91)
})

it('reabrir com dois recibos exige escolha explícita e confirma apenas o escolhido', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  const primeira = await montar()
  const segunda = await montar()
  await act(async () => { await primeira.result.current.enviar(body) })
  const id1 = uuid()
  await act(async () => { await segunda.result.current.enviar({ ...body, pedido: 'Um vídeo para a torcida' }) })
  const id2 = uuid()
  primeira.unmount(); segunda.unmount()
  const salvar = vi.fn()
  const abriu = renderHook(() => useProducaoSegura('/orgs/1', '["conteudo",3]', 'conteudo', salvar))
  await waitFor(() => expect(abriu.result.current.precisaEscolherEnvio).toBe(true))
  expect(abriu.result.current.enviosPendentes.map(r => r.requestId)).toEqual(expect.arrayContaining([id1, id2]))
  expect(abriu.result.current.podeEditar).toBe(false)
  await act(async () => { await abriu.result.current.conferir(); await abriu.result.current.enviar(body) })
  expect(consultas()).toHaveLength(0)
  expect(api.post).toHaveBeenCalledTimes(2)
  act(() => abriu.result.current.selecionarEnvio(id2))
  consulta({ ...confirmado(id2, 92), replayed: true })
  await act(async () => { await abriu.result.current.conferir() })
  expect(salvar).toHaveBeenCalledExactlyOnceWith(92)
  expect(consultas()).toEqual([[`/orgs/1/producao/${id2}`]])
  expect(JSON.parse(localStorage.getItem(registros()[0])!).request_id).toBe(id1)
})

it('preparar outro pedido é uma escolha explícita que preserva o recibo anterior', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  const primeira = await montar()
  await act(async () => { await primeira.result.current.enviar(body) })
  const id1 = uuid()
  primeira.unmount()
  const abriu = renderHook(() => useProducaoSegura('/orgs/1', '["conteudo",3]', 'conteudo', vi.fn()))
  await waitFor(() => expect(abriu.result.current.temEnvioPendente).toBe(true))
  act(() => abriu.result.current.prepararOutro())
  expect(abriu.result.current.podeEditar).toBe(true)
  expect(registros()).toHaveLength(1)
  await act(async () => { await abriu.result.current.enviar({ ...body, pedido: 'Pedido independente' }) })
  expect(uuid()).not.toBe(id1)
  expect(registros()).toHaveLength(2)
  expect(consultas()).toHaveLength(0)
})

it('remover recibo de intenção excluída não descarta a outra pendência do alvo', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  const primeira = await montar(); const segunda = await montar()
  await act(async () => { await primeira.result.current.enviar(body); await segunda.result.current.enviar({ ...body, pedido: 'Outro pedido' }) })
  const id2 = uuid()
  consulta(new ApiError(410, 'Removido'), true)
  await act(async () => { await segunda.result.current.conferir() })
  act(() => segunda.result.current.prepararNovo())
  expect(registros()).toHaveLength(1)
  expect(JSON.parse(localStorage.getItem(registros()[0])!).request_id).not.toBe(id2)
  expect(primeira.result.current.temEnvioPendente).toBe(true)
})

it('uma escolha removida em outra aba atualiza a lista sem selecionar silenciosamente outro envio', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'Resposta perdida'))
  const a = await montar(); const b = await montar()
  await act(async () => { await a.result.current.enviar(body); await b.result.current.enviar({ ...body, pedido: 'Outro pedido' }) })
  const id2 = uuid()
  a.unmount(); b.unmount()
  const tela = renderHook(() => useProducaoSegura('/orgs/1', '["conteudo",3]', 'conteudo', vi.fn()))
  await waitFor(() => expect(tela.result.current.precisaEscolherEnvio).toBe(true))
  const chave2 = registros().find(k => JSON.parse(localStorage.getItem(k)!).request_id === id2)!
  localStorage.removeItem(chave2)
  act(() => tela.result.current.selecionarEnvio(id2))
  expect(tela.result.current.erro).toContain('lista de envios mudou')
  expect(tela.result.current.precisaEscolherEnvio).toBe(true)
  expect(tela.result.current.enviosPendentes).toHaveLength(1)
  expect(consultas()).toHaveLength(0)
})

it('recupera recibo legado sem horário, sem exigir migração nem reenviar', async () => {
  const id = '33333333-3333-4333-8333-333333333333'
  localStorage.setItem(`offiz:producao:${API_V1}:7:/orgs/1:["conteudo",3]`, JSON.stringify({ versao: 1, request_id: id }))
  const salvar = vi.fn()
  const tela = renderHook(() => useProducaoSegura('/orgs/1', '["conteudo",3]', 'conteudo', salvar))
  await waitFor(() => expect(tela.result.current.temEnvioPendente).toBe(true))
  consulta({ ...confirmado(id), replayed: true })
  await act(async () => { await tela.result.current.conferir() })
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91)
  expect(api.post).not.toHaveBeenCalled()
  expect(registros()).toHaveLength(0)
})

const idAntigo = '11111111-1111-4111-8111-111111111111'
const rotaAjuste = '/orgs/1/biblioteca/35/ajustes'
const alvoAjuste = '["ajuste","conteudo",35,92]'
function reciboAnterior(alvo: string, id = idAntigo, namespace = `offiz:producao:${API_V1}:7:/orgs/1:`, rota = rotaAjuste, semSufixo = false) {
  const chave = `${namespace}${alvo}:operacao:${rota}${semSufixo ? '' : `:intencao:${id}`}`
  localStorage.setItem(chave, JSON.stringify({ versao: 1, request_id: id }))
  return chave
}
function opcoesAjuste() {
  return { rota: rotaAjuste, extrairId: (r: unknown) => r && typeof r === 'object' && 'job_id' in r ? r.job_id : null,
    alvoAnteriorCompativel: (alvo: string) => ['["ajuste","conteudo",35,92,17]', '["ajuste","conteudo",35,92,null]'].includes(alvo) }
}

it('descobre recibo anterior sem mover a chave e recupera o UUID por GET no novo alvo estável', async () => {
  const chave = reciboAnterior('["ajuste","conteudo",35,92,17]', idAntigo, undefined, undefined, true)
  const salvar = vi.fn()
  const tela = renderHook(() => useProducaoSegura('/orgs/1', alvoAjuste, 'conteudo', salvar, opcoesAjuste()))
  await waitFor(() => expect(tela.result.current.temEnvioPendente).toBe(true))
  expect(registros()).toEqual([chave])
  expect(consultas()).toHaveLength(0)
  consulta({ job_id: 91, request_id: idAntigo, office_slug: 'conteudo', replayed: true })
  await act(async () => { await tela.result.current.conferir() })
  expect(consultas()).toEqual([[`${rotaAjuste}/${idAntigo}`]])
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91)
  expect(registros()).toHaveLength(0)
  expect(api.post).not.toHaveBeenCalled()
})

it('compatibilidade de alvo não amplia namespace de API, autor, empresa ou operação', async () => {
  const alvos = '["ajuste","conteudo",35,92,17]'
  const chaves = [
    reciboAnterior(alvos, idAntigo, `offiz:producao:${API_V1}:8:/orgs/1:`),
    reciboAnterior(alvos, idAntigo, `offiz:producao:${API_V1}/outra:7:/orgs/1:`),
    reciboAnterior(alvos, idAntigo, `offiz:producao:${API_V1}:7:/orgs/2:`),
    reciboAnterior(alvos, idAntigo, undefined, '/orgs/1/biblioteca/36/ajustes'),
  ]
  const tela = renderHook(() => useProducaoSegura('/orgs/1', alvoAjuste, 'conteudo', vi.fn(), { ...opcoesAjuste(), alvoAnteriorCompativel: () => true }))
  await waitFor(() => expect(tela.result.current.podeEditar).toBe(true))
  expect(tela.result.current.enviosPendentes).toHaveLength(0)
  expect(registros()).toEqual(chaves)
  expect(consultas()).toHaveLength(0)
  expect(api.post).not.toHaveBeenCalled()
})

it('recibos canônico e antigos mantêm escolha explícita, inclusive se outra aba remove a escolha', async () => {
  const segundoId = '22222222-2222-4222-8222-222222222222'
  const chaveAntiga = reciboAnterior('["ajuste","conteudo",35,92,17]')
  const chaveNova = reciboAnterior(alvoAjuste, segundoId)
  const tela = renderHook(() => useProducaoSegura('/orgs/1', alvoAjuste, 'conteudo', vi.fn(), opcoesAjuste()))
  await waitFor(() => expect(tela.result.current.precisaEscolherEnvio).toBe(true))
  expect(tela.result.current.enviosPendentes.map(r => r.requestId)).toEqual(expect.arrayContaining([idAntigo, segundoId]))
  await act(async () => { await tela.result.current.conferir(); await tela.result.current.enviar(body) })
  expect(consultas()).toHaveLength(0)
  expect(api.post).not.toHaveBeenCalled()
  localStorage.removeItem(chaveNova)
  act(() => tela.result.current.selecionarEnvio(segundoId))
  expect(tela.result.current.precisaEscolherEnvio).toBe(true)
  expect(tela.result.current.erro).toContain('lista de envios mudou')
  expect(localStorage.getItem(chaveAntiga)).toContain(idAntigo)
  act(() => tela.result.current.selecionarEnvio(idAntigo))
  expect(tela.result.current.temEnvioPendente).toBe(true)
  expect(consultas()).toHaveLength(0)
})

it('consulta de recibo antigo iniciada antes de mudar autor não confirma nem descarta a intenção', async () => {
  const chave = reciboAnterior('["ajuste","conteudo",35,92,17]')
  let concluir!: (v: unknown) => void
  const salvar = vi.fn()
  const tela = renderHook(() => useProducaoSegura('/orgs/1', alvoAjuste, 'conteudo', salvar, opcoesAjuste()))
  await waitFor(() => expect(tela.result.current.temEnvioPendente).toBe(true))
  vi.mocked(api.get).mockImplementation(path => path === '/auth/me' ? Promise.resolve({ id: 8 }) : new Promise(resolve => { concluir = resolve }))
  await act(async () => { void tela.result.current.conferir() })
  clearTokens(); setTokens('outro-autor-ajuste', 'refresh-outro-autor'); tela.rerender()
  await waitFor(() => expect(tela.result.current.podeEditar).toBe(true))
  expect(tela.result.current.enviosPendentes).toHaveLength(0)
  await act(async () => concluir({ job_id: 91, request_id: idAntigo, office_slug: 'conteudo', replayed: true }))
  expect(salvar).not.toHaveBeenCalled()
  expect(localStorage.getItem(chave)).toContain(idAntigo)
  expect(api.post).not.toHaveBeenCalled()
})

const rotaJobs = '/predios/1/conteudo/jobs'
const opcoesJobs = { rota: rotaJobs, rotaConsulta: `${rotaJobs}/por-intencao`, vincularCorpo: true }
async function montarJobs(salvar = vi.fn()) {
  const tela = renderHook(() => useProducaoSegura('/predios/1/conteudo', '["estudio-direto"]', 'conteudo', salvar, opcoesJobs))
  await waitFor(() => expect(tela.result.current.podeEditar).toBe(true))
  return { ...tela, salvar }
}
const corpoJobs = { prompt: 'Pedido sintético privado', anexos: [{ nome: 'foto.jpg', dados: { cor: 'azul' } }] }

it('jobs perde ACK, recupera pela rota de intenção e guarda apenas UUID, data e SHA-256', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'ACK perdido'))
  const tela = await montarJobs()
  await act(async () => { await tela.result.current.enviar(corpoJobs) })
  const id = uuid(), hash = await hashCorpoProducao(corpoJobs)
  const key = registros()[0], salvo = JSON.parse(localStorage.getItem(key)!)
  expect(salvo).toEqual({ versao: 1, request_id: id, criado_em: expect.any(String), corpo_sha256: hash })
  expect(key + JSON.stringify(salvo)).not.toContain('sintético'); expect(key + JSON.stringify(salvo)).not.toContain('foto.jpg')
  consulta({ ...confirmado(id), replayed: true })
  await act(async () => { await tela.result.current.conferir() })
  expect(consultas()).toEqual([[`${rotaJobs}/por-intencao/${id}`]])
  expect(tela.salvar).toHaveBeenCalledExactlyOnceWith(91, { corpoSha256: hash })
  expect(api.post).toHaveBeenCalledOnce(); expect(registros()).toHaveLength(0)
})

it('reload não envia nem consulta automaticamente; depois de 404 só o JSON original conserva a UUID', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'ACK perdido'))
  const primeira = await montarJobs()
  await act(async () => { await primeira.result.current.enviar(corpoJobs) })
  const id = uuid(), raw = localStorage.getItem(registros()[0])
  primeira.unmount()
  const segunda = renderHook(() => useProducaoSegura('/predios/1/conteudo', '["estudio-direto"]', 'conteudo', vi.fn(), opcoesJobs))
  await waitFor(() => expect(segunda.result.current.temEnvioPendente).toBe(true))
  expect(api.post).toHaveBeenCalledOnce(); expect(consultas()).toHaveLength(0)
  consulta(new ApiError(404, 'Não encontrado'), true)
  await act(async () => { await segunda.result.current.conferir(); await segunda.result.current.enviar({ prompt: 'Outro corpo' }) })
  expect(segunda.result.current.erro).toContain('outro pedido'); expect(api.post).toHaveBeenCalledOnce()
  expect(localStorage.getItem(registros()[0])).toBe(raw)
  await act(async () => { await segunda.result.current.enviar(corpoJobs) })
  expect(api.post).toHaveBeenCalledTimes(2); expect(uuid()).toBe(id)
})

it('canônico ordena objetos, conserva arrays e ignora request_id que será sobrescrito', async () => {
  const a = { prompt: 'Teste', partes: [{ a: 1, b: 2 }, 'fim'], request_id: 'não efetivo', omitido: undefined }
  const b = { partes: [{ b: 2, a: 1 }, 'fim'], prompt: 'Teste', request_id: 'outro' }
  expect(await hashCorpoProducao(a)).toBe(await hashCorpoProducao(b))
  expect(await hashCorpoProducao({ ...b, partes: ['fim', { a: 1, b: 2 }] })).not.toBe(await hashCorpoProducao(a))
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'ACK perdido'))
  const tela = await montarJobs()
  await act(async () => { await tela.result.current.enviar(a) })
  const id = uuid()
  consulta(new ApiError(404, 'Não encontrado'), true)
  await act(async () => { await tela.result.current.conferir(); await tela.result.current.enviar(b) })
  expect(api.post).toHaveBeenCalledTimes(2); expect(uuid()).toBe(id)
  expect(vi.mocked(api.post).mock.calls[1][1]).toEqual({ prompt: 'Teste', partes: [{ a: 1, b: 2 }, 'fim'], request_id: id })
})

it('cópia profunda anterior ao await envia os mesmos bytes digeridos, com latch síncrono', async () => {
  let resolver!: (hash: ArrayBuffer) => void
  const digest = vi.fn(() => new Promise<ArrayBuffer>(r => { resolver = r }))
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: { digest } })
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'ACK perdido'))
  const tela = await montarJobs(), body = { prompt: 'Original', anexo: { nome: 'original.jpg' } }
  act(() => { void tela.result.current.enviar(body); void tela.result.current.enviar(body) })
  body.prompt = 'Mutado'; body.anexo.nome = 'mutado.jpg'
  expect(digest).toHaveBeenCalledOnce(); expect(api.post).not.toHaveBeenCalled()
  const bytes = digest.mock.calls[0] as unknown as [string, Uint8Array]
  expect(new TextDecoder().decode(bytes[1])).toBe('{"anexo":{"nome":"original.jpg"},"prompt":"Original"}')
  const hash = await webcrypto.subtle.digest('SHA-256', new Uint8Array(bytes[1]).buffer)
  await act(async () => resolver(hash))
  expect(api.post).toHaveBeenCalledOnce()
  expect(vi.mocked(api.post).mock.calls[0][1]).toEqual({ prompt: 'Original', anexo: { nome: 'original.jpg' }, request_id: expect.any(String) })
})

it.each(['logout', 'conta', 'contexto', 'desmontagem'] as const)('digest aguardando %s não persiste recibo nem inicia POST antigo', async mudanca => {
  let resolver!: (hash: ArrayBuffer) => void
  vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: { digest: () => new Promise<ArrayBuffer>(r => { resolver = r }) } })
  const salvar = vi.fn()
  const tela = renderHook(({ base }) => useProducaoSegura(base, 'estudio-direto', 'conteudo', salvar, { ...opcoesJobs, rota: `${base}/jobs` }), { initialProps: { base: '/predios/1/conteudo' } })
  await waitFor(() => expect(tela.result.current.podeEditar).toBe(true))
  act(() => { void tela.result.current.enviar(corpoJobs) })
  if (mudanca === 'logout') clearTokens()
  else if (mudanca === 'conta') setTokens('nova-conta-digest', 'refresh-novo')
  else if (mudanca === 'contexto') tela.rerender({ base: '/predios/2/conteudo' })
  else tela.unmount()
  await act(async () => resolver(new ArrayBuffer(32)))
  expect(api.post).not.toHaveBeenCalled(); expect(salvar).not.toHaveBeenCalled(); expect(registros()).toHaveLength(0)
})

it.each([false, true])('sem WebCrypto bloqueia só o novo POST; recibo anterior continua consultável (crypto ausente %s)', async ausente => {
  const tela = await montarJobs()
  vi.stubGlobal('crypto', ausente ? undefined : { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) })
  await act(async () => { await tela.result.current.enviar(corpoJobs) })
  expect(tela.result.current.erro).toContain('HTTPS'); expect(api.post).not.toHaveBeenCalled(); expect(registros()).toHaveLength(0)
  tela.unmount()
  reciboAnterior('["estudio-direto"]', idAntigo, `offiz:producao:${API_V1}:7:/predios/1/conteudo:`, rotaJobs)
  const salvar = vi.fn(), segunda = renderHook(() => useProducaoSegura('/predios/1/conteudo', '["estudio-direto"]', 'conteudo', salvar, opcoesJobs))
  await waitFor(() => expect(segunda.result.current.temEnvioPendente).toBe(true))
  consulta({ ...confirmado(idAntigo), replayed: true })
  await act(async () => { await segunda.result.current.conferir() })
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91, { corpoSha256: null }); expect(api.post).not.toHaveBeenCalled()
})

it.each([undefined, 'inválido'])('legado/hash %s consulta 404 mas não ganha vínculo para um corpo novo', async hash => {
  const key = reciboAnterior('["estudio-direto"]', idAntigo, `offiz:producao:${API_V1}:7:/predios/1/conteudo:`, rotaJobs)
  localStorage.setItem(key, JSON.stringify({ versao: 1, request_id: idAntigo, ...(hash ? { corpo_sha256: hash } : {}) }))
  const tela = renderHook(() => useProducaoSegura('/predios/1/conteudo', '["estudio-direto"]', 'conteudo', vi.fn(), opcoesJobs))
  await waitFor(() => expect(tela.result.current.temEnvioPendente).toBe(true))
  consulta(new ApiError(404, 'Não encontrado'), true)
  await act(async () => { await tela.result.current.conferir(); await tela.result.current.enviar(corpoJobs) })
  expect(tela.result.current.erro).toContain('conteúdo'); expect(api.post).not.toHaveBeenCalled()
  const raw = localStorage.getItem(key)
  act(() => tela.result.current.prepararOutro())
  await act(async () => { await tela.result.current.enviar(corpoJobs) })
  expect(api.post).toHaveBeenCalledOnce(); expect(uuid()).not.toBe(idAntigo); expect(localStorage.getItem(key)).toBe(raw)
})

it('StrictMode não consulta nem cria pedidos por efeito; clique único ganha um recibo', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'ACK perdido'))
  const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>
  const tela = renderHook(() => useProducaoSegura('/predios/1/conteudo', 'estudio-direto', 'conteudo', vi.fn(), opcoesJobs), { wrapper })
  await waitFor(() => expect(tela.result.current.podeEditar).toBe(true))
  expect(api.post).not.toHaveBeenCalled(); expect(consultas()).toHaveLength(0)
  await act(async () => { await tela.result.current.enviar(corpoJobs) })
  expect(api.post).toHaveBeenCalledOnce(); expect(registros()).toHaveLength(1)
})

it('confirmar uma intenção só permite outra após preparação explícita e cria UUID distinta', async () => {
  vi.mocked(api.post).mockImplementation(async (_p, b) => confirmado((b as { request_id: string }).request_id))
  const tela = await montarJobs()
  await act(async () => { await tela.result.current.enviar(corpoJobs); await tela.result.current.enviar({ prompt: 'Outra' }) })
  expect(api.post).toHaveBeenCalledOnce(); const id = uuid()
  act(() => tela.result.current.prepararOutro())
  await act(async () => { await tela.result.current.enviar({ prompt: 'Outra' }) })
  expect(api.post).toHaveBeenCalledTimes(2); expect(uuid()).not.toBe(id)
  expect(tela.salvar).toHaveBeenCalledTimes(2)
})

it('dois recibos de jobs pedem escolha; consultar A não apaga B nem repete qualquer POST', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'ACK perdido'))
  const tela = await montarJobs()
  await act(async () => { await tela.result.current.enviar(corpoJobs) }); const a = uuid()
  act(() => tela.result.current.prepararOutro())
  await act(async () => { await tela.result.current.enviar({ prompt: 'B' }) }); const b = uuid()
  tela.unmount()
  const salvar = vi.fn(), nova = renderHook(() => useProducaoSegura('/predios/1/conteudo', '["estudio-direto"]', 'conteudo', salvar, opcoesJobs))
  await waitFor(() => expect(nova.result.current.precisaEscolherEnvio).toBe(true))
  expect(consultas()).toHaveLength(0)
  act(() => nova.result.current.selecionarEnvio(a)); consulta({ ...confirmado(a), replayed: true })
  await act(async () => { await nova.result.current.conferir() })
  expect(salvar).toHaveBeenCalledExactlyOnceWith(91, { corpoSha256: await hashCorpoProducao(corpoJobs) })
  expect(registros()).toHaveLength(1); expect(JSON.parse(localStorage.getItem(registros()[0])!).request_id).toBe(b)
  expect(api.post).toHaveBeenCalledTimes(2)
})

it('consulta em andamento após logout não confirma nem apaga recibo com digest', async () => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'ACK perdido'))
  const tela = await montarJobs()
  await act(async () => { await tela.result.current.enviar(corpoJobs) }); const id = uuid(), raw = localStorage.getItem(registros()[0])
  let resolver!: (r: unknown) => void
  vi.mocked(api.get).mockImplementation(() => new Promise(r => { resolver = r }))
  act(() => { void tela.result.current.conferir() }); clearTokens()
  await act(async () => resolver({ ...confirmado(id), replayed: true }))
  expect(tela.salvar).not.toHaveBeenCalled(); expect(localStorage.getItem(registros()[0])).toBe(raw)
})

it.each([false, true])('falha ao regravar recibo existente não abandona sua UUID (binding %s)', async binding => {
  vi.mocked(api.post).mockRejectedValue(new ApiError(0, 'ACK perdido'))
  const tela = binding ? await montarJobs() : await montar()
  await act(async () => { await tela.result.current.enviar(corpoJobs) })
  const id = uuid(), key = registros()[0], raw = localStorage.getItem(key)
  consulta(new ApiError(404, 'Não encontrado'), true)
  await act(async () => { await tela.result.current.conferir() })
  const gravar = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota sintética') })
  await act(async () => { await tela.result.current.enviar(corpoJobs) })
  gravar.mockRestore()
  expect(localStorage.getItem(key)).toBe(raw)
  expect(tela.result.current.temEnvioPendente).toBe(true)
  consulta({ ...confirmado(id), replayed: true })
  await act(async () => { await tela.result.current.enviar(corpoJobs) })
  expect(api.post).toHaveBeenCalledOnce()
  expect(consultas()[consultas().length - 1][0]).toContain(id)
  expect(tela.salvar).toHaveBeenCalledOnce()
})

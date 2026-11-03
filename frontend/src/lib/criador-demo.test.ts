import { beforeEach, expect, it, vi } from 'vitest'
import { api } from './api'
import { prepararDemoCriador } from './criador-demo'
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), api: { get: vi.fn(), post: vi.fn() } }))
beforeEach(() => vi.clearAllMocks())
it('abre uma demo já liberada sem tentar conceder novamente', async () => {
  vi.mocked(api.get).mockResolvedValue([{ id: 8, slug: 'demo-criador', offices: [{ office_slug: 'conteudo' }] }])
  expect(await prepararDemoCriador('conteudo')).toBe('/app?org=8&slug=conteudo')
  expect(api.post).not.toHaveBeenCalled()
})
it('expõe a recusa de acesso e não devolve um link que vai falhar', async () => {
  vi.mocked(api.get).mockResolvedValue([{ id: 8, slug: 'demo-criador', offices: [] }])
  vi.mocked(api.post).mockRejectedValue(new Error('Acesso negado'))
  await expect(prepararDemoCriador('conteudo')).rejects.toThrow('Acesso negado')
})
it('cria uma demo com a conta do criador sem disparar e-mail', async () => {
  vi.mocked(api.get).mockImplementation(async endpoint => endpoint === '/admin/orgs' ? [] : { email: 'criador@example.com' })
  vi.mocked(api.post).mockResolvedValue({ id: 9, slug: 'demo-criador' })
  expect(await prepararDemoCriador('conteudo')).toBe('/app?org=9&slug=conteudo')
  expect(api.post).toHaveBeenCalledWith('/admin/orgs', expect.objectContaining({ owner_email: 'criador@example.com', enviar_email: false, offices: ['conteudo'] }))
})

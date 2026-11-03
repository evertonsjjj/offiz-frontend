import { api, asList } from './api'

type Demo = { id: number; slug: string; offices?: (string | { office_slug: string })[] }

/** A demo rápida reutiliza a empresa do criador; primeiro acesso usa Clientes e demos. */
export async function prepararDemoCriador(slug: string): Promise<string> {
  const orgs = asList<Demo>(await api.get<unknown>('/admin/orgs'), 'orgs', 'organizations')
  let demo = orgs.find(o => o.slug === 'demo-criador')
  if (!demo) {
    const me = await api.get<{ email: string }>('/auth/me')
    demo = await api.post<Demo>('/admin/orgs', {
      nome: 'Demo do Criador', slug: 'demo-criador', owner_email: me.email,
      offices: [slug], enviar_email: false,
    })
  } else if (!(demo.offices || []).some(office => (typeof office === 'string' ? office : office.office_slug) === slug)) {
    // Uma recusa ao liberar o escritório precisa aparecer antes de abrir a demo.
    await api.post(`/orgs/${demo.id}/offices`, { office_slug: slug })
  }
  return `/app?org=${demo.id}&slug=${encodeURIComponent(slug)}`
}

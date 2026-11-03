import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PrepararInicio } from './PrepararInicio'
vi.mock('../lib/i18n', () => ({ useIdioma: () => ({ t: (pt: string) => pt }) }))
vi.mock('../pages/ConfigOrg', () => ({
  PainelMotorEmbutido: () => <div>Contas locais</div>,
  SecaoAppDesktop: () => <a href="/download">Baixar o aplicativo</a>,
  SecaoMotorIA: () => <label>Chave de API<input /></label>,
}))
afterEach(() => { cleanup(); delete window.offizMotor })
it('web oferece download ou API, sem impor mídia', () => {
  render(<PrepararInicio orgId={1} aoAtualizar={() => {}} />)
  expect(screen.getByRole('link', { name: 'Baixar o aplicativo' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Continuar no navegador com uma chave de API' }))
  expect(screen.getByLabelText('Chave de API')).toBeInTheDocument()
  expect(screen.queryByText('Contas locais')).not.toBeInTheDocument()
})
it('app mostra preparação da conta local', () => {
  window.offizMotor = { estado: vi.fn() } as unknown as NonNullable<typeof window.offizMotor>
  render(<PrepararInicio orgId={1} aoAtualizar={() => {}} />)
  expect(screen.getByText('Contas locais')).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Baixar o aplicativo' })).not.toBeInTheDocument()
})

import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AtualizacaoMotor, motorSuportaTentativas } from './AtualizacaoMotor'

it('no navegador e no aplicativo compatível não pede atualização', () => {
  const tela = render(<AtualizacaoMotor />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  tela.rerender(<AtualizacaoMotor versao="0.2.14" />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('aplicativo antigo explica tarefas e atualização sem dizer que o login falhou', () => {
  render(<AtualizacaoMotor versao="0.2.13" />)
  expect(screen.getByRole('status')).toHaveTextContent('novas tarefas precisam da versão 0.2.14')
  expect(screen.getByRole('status')).toHaveTextContent('aguarde o encerramento')
  expect(screen.getByRole('link', { name: 'Baixar atualização para Windows' })).toHaveAttribute('href', expect.stringContaining('/Offiz-Setup.exe'))
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('uma versão não identificada ou de desenvolvimento não comprova compatibilidade', () => {
  for (const versao of ['', 'unknown', '0.2.14-dev', '0.2.140evil', '0.02.13', '0.1.99']) expect(motorSuportaTentativas(versao)).toBe(false)
  for (const versao of ['v0.2.14', '0.2.15', '0.3.0', '1.0.0', '0.2.14+build.1']) expect(motorSuportaTentativas(versao)).toBe(true)
})

import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { SeletorAcervoConversa, type ItemAcervoAnexo } from './SeletorAcervoConversa'

vi.mock('../MiniaturaArquivo', () => ({ default: ({ caminho, nome }: { caminho: string; nome: string }) => <span aria-hidden="true" data-testid="miniatura" data-caminho={caminho} data-nome={nome} /> }))

const itens: ItemAcervoAnexo[] = [
  { nome: 'garrincha.jpg', legenda: 'Garrincha na seleção — crédito do fotógrafo', pasta: 'produto', sub: 'história/ídolos', andar: 'conteudo', caminho: 'memoria/brand/acervo/história/ídolos/garrincha.jpg' },
  { nome: 'CREDITOS.md', legenda: 'Fontes documentais', pasta: 'produto', andar: 'conteudo', caminho: 'memoria/brand/acervo/CREDITOS.md' },
  { nome: 'manual.pdf', legenda: 'Identidade do clube', pasta: 'marca', andar: 'juridico', caminho: 'memoria/brand/assets/marca/manual.pdf' },
  { nome: 'garrincha.jpg', legenda: 'Referência de enquadramento', pasta: 'exemplos', sub: 'ensaio b', andar: 'conteudo', caminho: 'memoria/brand/acervo/exemplos/ensaio b/garrincha.jpg' },
]
function montar(overrides: Partial<React.ComponentProps<typeof SeletorAcervoConversa>> = {}) {
  const props = { orgId: 33, slug: 'predio', nivelPredio: true, itens, carregando: false, erro: null, ocupado: false, aoSelecionar: vi.fn(), aoFechar: vi.fn(), aoConsultarNovamente: vi.fn(), ...overrides }
  return { ...render(<SeletorAcervoConversa {...props} />), props }
}
const busca = () => screen.getByRole('searchbox', { name: 'Buscar no acervo' })
const lista = () => screen.getByRole('list', { name: 'Arquivos do acervo' })

it.each([
  ['GARRINCHA', ['garrincha.jpg', 'garrincha.jpg']],
  ['selecao fotografo', ['garrincha.jpg']],
  ['historia idolos', ['garrincha.jpg']],
  ['juridico', ['manual.pdf']],
  ['a marca', ['manual.pdf']],
  ['referencias ensaio', ['garrincha.jpg']],
  ['creditos', ['CREDITOS.md']],
])('busca imediata por nome, legenda, pasta e área, sem diferenças de acento: %s', (termo, nomes) => {
  const { props } = montar()
  fireEvent.change(busca(), { target: { value: termo } })
  expect(within(lista()).getAllByRole('button').map(botao => botao.querySelector('strong')?.textContent)).toEqual(nomes)
  expect(props.aoSelecionar).not.toHaveBeenCalled()
  expect(props.aoConsultarNovamente).not.toHaveBeenCalled()
})

it('usa a miniatura compacta autenticada, com subpasta e nome codificados e sem ler original', () => {
  montar()
  const thumb = within(screen.getByRole('button', { name: /garrincha.jpg.*crédito/ })).getByTestId('miniatura')
  expect(thumb).toHaveAttribute('data-caminho', '/predios/33/conteudo/arquivos/produto/garrincha.jpg/miniatura?sub=hist%C3%B3ria%2F%C3%ADdolos')
  expect(within(screen.getByRole('button', { name: /ensaio b/ })).getByTestId('miniatura')).toHaveAttribute('data-caminho', '/predios/33/conteudo/arquivos/exemplos/garrincha.jpg/miniatura?sub=ensaio%20b')
})

it('mostra nome primeiro, mantém descrição e origem completas no acesso e seleciona o objeto original', () => {
  const { props } = montar()
  const botao = screen.getByRole('button', { name: /garrincha.jpg.*crédito/ })
  expect(botao.querySelector('.conversa-acervo-texto')?.firstChild?.textContent).toBe('garrincha.jpg')
  expect(botao).toHaveAttribute('title', 'garrincha.jpg · Garrincha na seleção — crédito do fotógrafo · conteudo / O produto / história/ídolos')
  fireEvent.click(botao)
  expect(props.aoSelecionar).toHaveBeenCalledExactlyOnceWith(itens[0])
})

it('não confirma nada com Enter na busca, ArrowDown alcança o primeiro resultado e Escape fecha', () => {
  const { props } = montar()
  expect(busca()).toHaveFocus()
  fireEvent.change(busca(), { target: { value: 'creditos' } })
  expect(screen.getByRole('status')).toHaveTextContent('1 arquivo encontrado')
  fireEvent.keyDown(busca(), { key: 'Enter' })
  expect(props.aoSelecionar).not.toHaveBeenCalled()
  fireEvent.keyDown(busca(), { key: 'ArrowDown' })
  expect(screen.getByRole('button', { name: /CREDITOS.md/ })).toHaveFocus()
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(props.aoFechar).toHaveBeenCalledTimes(1)
})

it('distingue busca sem resultado de acervo vazio e permite limpar mantendo o foco', () => {
  montar()
  fireEvent.change(busca(), { target: { value: 'não existe' } })
  expect(screen.getByText(/Nenhum arquivo encontrado/)).toBeVisible()
  expect(screen.queryByText(/Nada guardado ainda/)).not.toBeInTheDocument()
  expect(within(lista()).queryAllByRole('button')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Limpar busca do acervo' }))
  expect(busca()).toHaveValue(''); expect(busca()).toHaveFocus()
  expect(within(lista()).getAllByRole('button')).toHaveLength(4)
})

it('falha e carregamento não afirmam acervo vazio nem conservam seleção de uma consulta falha', () => {
  const { rerender, props } = montar({ itens: null, carregando: true })
  expect(screen.getByRole('status')).toHaveTextContent('Abrindo o seu acervo')
  expect(screen.queryByText(/Nada guardado ainda|Nenhum arquivo encontrado/)).not.toBeInTheDocument()
  rerender(<SeletorAcervoConversa {...props} itens={itens} carregando={false} erro="Armazenamento indisponível." />)
  expect(within(lista()).queryAllByRole('button')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
  expect(props.aoConsultarNovamente).toHaveBeenCalledTimes(1)
  rerender(<SeletorAcervoConversa {...props} itens={itens} carregando={false} erro={null} />)
  expect(busca()).toHaveFocus()
})

it('cópia em andamento bloqueia todas as seleções e busca não libera os botões', () => {
  const { props } = montar({ ocupado: true })
  fireEvent.change(busca(), { target: { value: 'creditos' } })
  const botao = screen.getByRole('button', { name: /CREDITOS.md/ })
  expect(botao).toBeDisabled()
  fireEvent.click(botao)
  expect(props.aoSelecionar).not.toHaveBeenCalled()
})

it('uma nova montagem para outro contexto inicia com busca vazia', () => {
  const { unmount } = montar()
  fireEvent.change(busca(), { target: { value: 'historia' } })
  unmount()
  montar({ orgId: 34, itens: [{ ...itens[1], nome: 'outra-org.txt' }] })
  expect(busca()).toHaveValue('')
  expect(screen.getByRole('button', { name: /outra-org.txt/ })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /garrincha.jpg/ })).not.toBeInTheDocument()
})

it('busca também pelo nome da área vindo da leitura normal, preservando o slug na rota', () => {
  montar({ itens: [{ ...itens[1], andar: 'conteudo', andarNome: 'Conteúdo e marca' }] })
  fireEvent.change(busca(), { target: { value: 'conteudo marca' } })
  const botao = screen.getByRole('button', { name: /CREDITOS.md.*Conteúdo e marca/ })
  expect(within(botao).getByTestId('miniatura')).toHaveAttribute('data-caminho', '/predios/33/conteudo/arquivos/produto/CREDITOS.md/miniatura')
})

it('campos do acervo são texto puro, mesmo ao pesquisar conteúdo semelhante a HTML', () => {
  montar({ itens: [{ ...itens[1], legenda: '<img src=x onerror=alert(1)>' }] })
  fireEvent.change(busca(), { target: { value: 'onerror' } })
  expect(lista().querySelector('img')).toBeNull()
  expect(screen.getByRole('button', { name: /<img src=x/ })).toHaveTextContent('<img src=x onerror=alert(1)>')
})

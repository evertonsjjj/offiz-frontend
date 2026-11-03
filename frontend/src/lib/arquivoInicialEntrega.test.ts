import { expect, it } from 'vitest'
import { arquivoInicialEntrega } from './arquivoInicialEntrega'
import type { Entrega } from './types'

const arquivo = (id: number, nome: string, post?: number, mime?: string): Entrega => ({ id, nome, mime, editorial_peca_id: post, job_id: 7, caminho_rel: `outputs/${post || 'lote'}/${nome}`, tamanho_bytes: 10, status: 'pendente', criado_em: '2026-10-13T00:00:00Z' })
it.each(['feed.png', 'story.jpg', 'campanha.webm', 'animacao.mp4'])('abre %s do mesmo post antes do texto, sem renomear nem ordenar o lote', nome => {
  const lote = [arquivo(1, 'post.html', 10), arquivo(2, 'legenda.docx', 10), arquivo(3, nome, 10), arquivo(4, 'arte.png', 20)]
  expect(arquivoInicialEntrega(lote)?.id).toBe(3)
  expect(lote.map(e => e.id)).toEqual([1, 2, 3, 4])
})
it('reconhece mídia pelo MIME sem depender do nome do modelo', () => {
  expect(arquivoInicialEntrega([arquivo(1, 'post.html', 10), arquivo(2, 'arquivo', 10, 'image/png')])?.id).toBe(2)
})
it('prefere o PNG final ao SVG editável anterior no lote real de nomes do post337', () => {
  const lote = [arquivo(1003, 'post.html', 20), arquivo(1004, 'feed-editavel.svg', 20, 'image/svg+xml'), arquivo(1005, 'feed.png', 20, 'image/png'), arquivo(1006, 'story.png', 20, 'image/png')]
  expect(arquivoInicialEntrega(lote)?.id).toBe(1005)
  expect(arquivoInicialEntrega(lote, lote[1])?.id).toBe(1004)
})
it('usa SVG como alternativa quando o mesmo post não tem raster ou vídeo', () => {
  expect(arquivoInicialEntrega([arquivo(1, 'post.html', 10), arquivo(2, 'feed-editavel.svg', 10, 'image/svg+xml')])?.id).toBe(2)
})
it('não toma a imagem de outro post nem uma imagem sem vínculo para acompanhar o texto', () => {
  expect(arquivoInicialEntrega([arquivo(1, 'post.html', 10), arquivo(2, 'feed.png', 20), arquivo(3, 'logo.png')])?.id).toBe(1)
})
it('mantém uma referência de vídeo, PDF ou legenda mesmo quando há imagens auxiliares', () => {
  for (const nome of ['campanha.mp4', 'apresentacao.pdf', 'legenda.docx']) {
    const referencia = arquivo(9, nome, 10)
    expect(arquivoInicialEntrega([arquivo(1, 'post.html', 10), arquivo(2, 'feed.png', 10), referencia], referencia)).toBe(referencia)
  }
})
it('conserva o contrato arte.png e o primeiro card de uma sequência válida no mesmo post', () => {
  const html = arquivo(1, 'post.html', 10)
  expect(arquivoInicialEntrega([html, arquivo(2, 'feed.png', 10), arquivo(3, 'arte.png', 10)])?.id).toBe(3)
  expect(arquivoInicialEntrega([html, arquivo(2, 'feed.png', 10), arquivo(3, 'card-02.png', 10), arquivo(4, 'card-01.png', 10)])?.id).toBe(4)
})
it('sem mídia conserva o documento e com lote vazio não inventa uma entrega', () => {
  expect(arquivoInicialEntrega([arquivo(1, 'post.html', 10), arquivo(2, 'legenda.docx', 10)])?.id).toBe(1)
  expect(arquivoInicialEntrega([])).toBeUndefined()
})

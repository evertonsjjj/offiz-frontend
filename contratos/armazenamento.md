# Armazenamento por empresa

`GET /api/v1/orgs/{org_id}/armazenamento` exige autenticação e acesso à empresa.
A autorização e a admissão de arquivos pertencem ao backend. O frontend apenas
apresenta o estado recebido; não pode liberar espaço alterando um valor local.

| Campo | Significado |
| --- | --- |
| `limite_bytes` | Cota de 10.000.000.000 bytes, em GB decimal |
| `unidade_bytes` | 1.000.000.000; a apresentação divide por esta unidade |
| `bytes_centrais_reais` | Bytes lógicos de arquivos atribuídos à empresa; `null` quando desconhecidos |
| `bytes_legados_gpu` | Bytes atribuídos do cache GPU antigo, ainda sujeito à migração |
| `bytes_alocados_centrais` | Espaço alocado que o sistema conseguiu medir; pode ser `null` |
| `medicao_completa` | Se a medição atribuída à empresa terminou sem impedimentos |
| `disponivel_bytes` / `excedido` | Derivados da medição; podem ser `null` |
| `pode_incrementar` | Indicação do servidor; nunca substitui a autorização de cada escrita |
| `destino` | `compartilhado` ou `externo_pendente` |
| `requisitos` | Conexões testadas e comprovação de infraestrutura externa, como fatos separados |
| `pendencias_residencia` | Mensagens para apresentar sem reinterpretar como aprovação |
| `prontidao_residencia` | Diagnóstico de destinos e categorias ainda centrais; não contém credenciais |
| `residencia_integral_verificada` | Permanece falso enquanto não houver prova integral |

A medição de arquivos não equivale ao tamanho físico total da empresa no VPS:
linhas do banco, WAL e backups têm escopo próprio. Se houver cache legado sem
ownership comprovado, a resposta informa pendência operacional; não atribua esses
bytes a uma empresa por suposição. Falha de leitura, endpoint ausente e `null`
devem aparecer como indisponibilidade, nunca como zero ou espaço ilimitado.

As conexões PostgreSQL/S3 testadas não provam que os recursos estão fora do VPS
nem que conversas, casos, peças, conhecimento e cópias históricas foram migrados.
`prontidao_residencia` é um diagnóstico de caminhos de escrita, não um certificado
de residência. A pasta escolhida no desktop também não elimina dados do servidor.

O IPC de pasta (`escolherPastaTrabalho` / `abrirPastaTrabalho`) exige Desktop
0.2.24 ou posterior. A tela não deve simular seleção bem-sucedida em versões
anteriores nem no navegador. Trocar de empresa/conta invalida respostas em curso;
preserve as guardas de sessão e de contexto nas alterações da interface.

As fixtures de `scripts/armazenamento-interface.mjs` são sintéticas. Não indicam
uso real, conexão externa validada ou homologação de uma conta.

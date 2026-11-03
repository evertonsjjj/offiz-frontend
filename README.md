# Frontend do Offiz

Código da interface web do Offiz: aplicativo, página pública, componentes,
estilos, assets e testes. Inclui a tela de configuração do desktop e os contratos
necessários para trabalhar na experiência de uso.

## Demonstração local

Requer **Node.js 22.12 ou superior** e npm. A validação desta distribuição usou
Node.js 22.23.4. Clone ou baixe o repositório inteiro, preservando as pastas irmãs.

```sh
git clone https://github.com/evertonsjjj/offiz-frontend.git
cd offiz-frontend/frontend
npm ci
npm run demo
```

- Aplicativo: <http://127.0.0.1:5180/app?org=3&slug=conteudo&conversa=42&vista=conversa>
- Página pública: <http://127.0.0.1:5180/>
- Entrega de exemplo: <http://127.0.0.1:5180/app?org=3&vista=biblioteca&trabalho=71&arquivo=91>

A demo inicia uma API de fixtures em `127.0.0.1:8188` e o frontend em
`127.0.0.1:5180`. Usa dados fictícios, recusa gravações, não precisa de conta e não
chama IA nem serviços pagos. As portas precisam estar livres. `Ctrl+C` encerra a
demonstração. Rotas não simuladas retornam uma indicação de fixture ausente.
O exemplo visual Aurora é fictício.

## Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `frontend/` | React, TypeScript, Vite, página pública, aplicativo e testes |
| `desktop-ui/` | Tela do motor e referência da ponte de IPC do desktop |
| `standalone/vendor/` | Conversão de áudio compartilhada com o frontend |
| `contratos/openapi.json` | Contrato HTTP público; exclui rotas internas e gerenciadas |

Preserve `standalone/vendor/` ao lado de `frontend/`: há imports relativos usados
no build. `desktop-ui/CONTRATO-preload-site.js` é uma referência de integração;
não injete esse arquivo em uma página web nem exponha IPC arbitrário.

O backend, o executor da IA e o aplicativo Electron completo são componentes
separados e não estão neste repositório. Também não há bancos, arquivos de
clientes, credenciais ou dependências instaladas.

## Build e testes

Dentro de `frontend/`:

```sh
npm run build
npm run lint
npm test
```

O build é gravado em `frontend/dist/`. `npm run preview` permite conferi-lo.
`npm run test:interface` exige um navegador compatível instalado; informe o
caminho em `BROWSER_EXECUTABLE` quando necessário. Os scripts avulsos
`carrossel-preview-interface.mjs` e `nginx-privacy.mjs` dependem, respectivamente,
do renderizador e da configuração Nginx da instalação completa; eles não fazem
parte do build nem da demonstração deste repositório.

## Usar uma API real

Use uma API de homologação isolada, fornecida pelo responsável pelo backend,
com CORS habilitado para a origem local. Configure `VITE_API_URL` antes do dev
server ou build. Por exemplo, no PowerShell:

```powershell
$env:VITE_API_URL = 'http://127.0.0.1:8100'
npm run dev
```

No macOS/Linux:

```sh
VITE_API_URL=http://127.0.0.1:8100 npm run dev
```

Não use a demo como substituto da autenticação ou autorização do servidor.
Variáveis `VITE_*` ficam públicas no navegador: nunca coloque chaves de IA ou
segredos nelas. A conta da API precisa das permissões corretas por empresa,
escritório e usuário. Testar a assinatura pessoal exige o motor desktop pareado
e autenticado; este frontend sozinho não executa a IA.

Os links de instalação são configuráveis no build com
`VITE_APP_DOWNLOAD_BASE_WINDOWS`, `VITE_APP_DOWNLOAD_BASE_MAC_NATIVE` e
`VITE_APP_INSTALL_URL`. Esses valores precisam apontar para arquivos existentes;
alterá-los não cria instaladores nem publica serviços.

## Alterações na interface

Consulte [LEIA-ME-FRONTEND.txt](LEIA-ME-FRONTEND.txt) para o mapa das telas.
Preserve contratos, identificadores e limites de autenticação. Confira temas,
telas pequenas, teclado, carregamento, erros e estados vazios. Se uma mudança
exigir outra resposta da API, descreva o contrato para implementação separada.

`MANIFESTO-SHA256.json` registra os arquivos desta distribuição, excluindo o
próprio manifesto. É uma referência do snapshot inicial, não dos arquivos que
forem alterados depois. Não inclua `node_modules`, `dist`, `.env`, logs ou dados
nas alterações compartilhadas.

import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
/* AS TRÊS FACES DO DESENHO CLÁSSICO — todas self-hosted (CSP + offline;
   nada de Google Fonts em runtime).
   - Mona Sans (UI) vem por @font-face em tokens.css, do arquivo vendorizado.
   - IBM Plex Serif é a DISPLAY: até 14/08/2026 ela estava só declarada na
     pilha de `--font-display` e nunca foi vendorizada, então todo h1–h4, o
     logo e os KPIs caíam em Georgia — a voz editorial do produto era o
     fallback. Agora ela existe de verdade.
   - IBM Plex Mono é a "verdade de máquina" (log, número, nome de arquivo).
   Só os subsets latin/latin-ext: o import sem subset traz também cirílico,
   grego e vietnamita, que o Vite copia para o dist sem ninguém usar. */
/* Instrument Sans (UI e texto — --font-display/--font-body do tokens.css) era
   a ÚNICA coisa que ainda vinha do Google Fonts em runtime (7ª passada,
   06/09/2026): cada visita mandava o IP do visitante para o Google, num
   produto que vende conformidade LGPD — e contradizia a política escrita
   logo acima. Agora é self-hosted como as outras duas. */
import '@fontsource/instrument-sans/latin-400.css'
import '@fontsource/instrument-sans/latin-500.css'
import '@fontsource/instrument-sans/latin-600.css'
import '@fontsource/instrument-sans/latin-700.css'
import '@fontsource/instrument-sans/latin-400-italic.css'
import '@fontsource/instrument-sans/latin-600-italic.css'
import '@fontsource/instrument-sans/latin-ext-400.css'
import '@fontsource/instrument-sans/latin-ext-500.css'
import '@fontsource/instrument-sans/latin-ext-600.css'
import '@fontsource/instrument-sans/latin-ext-700.css'
import '@fontsource/ibm-plex-serif/latin-400.css'
import '@fontsource/ibm-plex-serif/latin-600.css'
import '@fontsource/ibm-plex-serif/latin-700.css'
import '@fontsource/ibm-plex-serif/latin-ext-400.css'
import '@fontsource/ibm-plex-serif/latin-ext-600.css'
import '@fontsource/ibm-plex-serif/latin-ext-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-ext-400.css'
import '@fontsource/ibm-plex-mono/latin-ext-500.css'
import './styles/tokens.css'
import './styles/app.css'
import './styles/shell.css'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { IdiomaProvider } from './lib/i18n'
import { ToastsProvider } from './components/Toasts'
import { BordaRaiz } from './components/BordaRaiz'
import { recoverRouteChunk } from './lib/routeReload'

/* Depois de um deploy, o index.html novo aponta para chunks novos — e uma aba
   que ficou aberta com o index ANTIGO, ao navegar para uma rota que ainda não
   tinha baixado, pede um chunk que não existe mais (o nginx cacheia /assets/
   para sempre, e o hash mudou). Sem isto, a tela ficava em branco. O Vite
   avisa por este evento: recarrega a página uma vez; se acabou de recarregar,
   deixa o erro seguir em vez de entrar em loop. */
window.addEventListener('vite:preloadError', (event) => recoverRouteChunk(event))

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* React Router 7 (06/09/2026): as flags `future.v7_*` que o app já ligava
        viraram o padrão — e o v7 corrige o open redirect por barra invertida
        em <Link>/useNavigate que o 6.30 carregava. */}
    <BrowserRouter>
      {/* Toasts por fora do Auth: o AuthProvider avisa "sessão expirada" por
          toast (app desktop fica dias aberto e o refresh acaba vencendo). */}
      {/* A borda de erro da raiz fica por FORA dos providers: se um deles
          quebrar no render, ainda existe alguém para mostrar o aviso. */}
      <BordaRaiz>
        <ToastsProvider>
          <AuthProvider>
            <IdiomaProvider><App /></IdiomaProvider>
          </AuthProvider>
        </ToastsProvider>
      </BordaRaiz>
    </BrowserRouter>
  </React.StrictMode>,
)

/**
 * Detecta se o site está rodando dentro do app desktop do Offiz (Electron).
 *
 * Dois marcadores porque há duas gerações de app em circulação:
 *  - "OffizDesktop/x.y" — userAgent customizado que as versões novas do app
 *    passam a enviar (marcador oficial daqui pra frente);
 *  - "Electron" — os apps já distribuídos, anteriores ao userAgent próprio,
 *    mandam apenas o padrão do Electron (que sempre contém "Electron/…").
 *
 * Navegadores comuns não trazem nenhum dos dois, então o teste é seguro
 * para diferenciar "site no navegador" de "site dentro do app".
 */
export const ehDesktop = /OffizDesktop|Electron/i.test(navigator.userAgent)

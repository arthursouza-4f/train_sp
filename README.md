# TrainView SP

Mapa 3D da rede sobre trilhos da Região Metropolitana de São Paulo — Metrô (linhas 1, 2, 3, 4, 5, 6, 15 e 17)
e trens metropolitanos (linhas 7 a 13) — com a **posição estimada** de cada trem em tempo real, em 3D sobre um
mapa de verdade da cidade (inspirado no [Mini Tokyo 3D](https://minitokyo3d.com)).

> ⚠️ **Projeto não oficial.** As posições são calculadas a partir da tabela oficial de intervalos; não vêm de GPS nem de
> nenhum sistema das operadoras. O site não tem vínculo com Metrô, CPTM, ViaQuatro, ViaMobilidade, TIC Trens,
> Trivia Trens, Linha Uni, SPTrans, EMTU, Governo do Estado ou Prefeitura de São Paulo. O aviso aparece fixo no topo
> da tela e detalhado no diálogo "Saiba mais".

## O que dá para fazer

- Ver os trens andando em 3D sobre o mapa, tocar num trem, numa estação ou numa linha para os detalhes, seguir um trem.
- **Buscar** estação, linha ou terminal (campo no canto; no celular, botão de lupa; atalho `/` no computador).
- **Favoritar** estações (estrela no painel): elas ficam no começo da barra de linhas com o tempo até o próximo trem.
  Fica salvo só no aparelho, sem login.
- **Compartilhar** o que está na tela: o endereço acompanha a seleção (`#estacao=pinheiros`, `#linha=4`,
  `#trem=…`, `#local=…`) e o botão de compartilhar abre o menu do celular ou copia o link.
- Simular outro horário/dia e acelerar o relógio.

## Rodando

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # gera dist/ (site 100% estático)
npm run preview    # serve o dist/ para conferir
```

Para a **prévia do link** no WhatsApp/redes funcionar, gere o build com o endereço público do site (a imagem de
prévia precisa de endereço completo):

```bash
SITE_URL=https://seu-dominio.com.br npm run build
```

A imagem (`public/og-image.png`, 1200×630) é gerada a partir das linhas reais com `npm run og`.

O `dist/` pode ser publicado em qualquer hospedagem estática (Netlify, Vercel, GitHub Pages, Cloudflare Pages, S3…).
Os caminhos são relativos (`base: './'`), então funciona também em subpastas. A hospedagem precisa aceitar requisições
HTTP Range (todas essas aceitam) e não deve recomprimir o `.pmtiles`.

**Nenhuma API ou servidor de mapas externo é chamado em tempo de execução**:

- a rede vem de `public/data/network.json` (~205 KB, ~70 KB com gzip);
- o mapa de fundo vem de `public/map/sp.pmtiles` (~35 MB, recorte do OpenStreetMap só da região da rede). O
  navegador **não baixa o arquivo inteiro**: pede por HTTP Range só os tiles que aparecem na tela (dezenas de KB por
  vez), então abre rápido também no celular;
- fontes e ícones dos rótulos ficam em `public/map/fonts` e `public/map/sprites`.

## Como a estimativa funciona

1. **Tabela oficial** — para cada linha e sentido, o GTFS da SPTrans (`frequencies.txt`) traz o intervalo entre trens
   de cada hora. Os trens partem dos terminais do horário de abertura ao de fechamento nesses intervalos
   (intervalos abaixo do mínimo técnico da sinalização são elevados a esse mínimo — ver `minHeadway`).
2. **Em movimento** — entre estações o trem acelera, roda em cruzeiro e freia (perfil trapezoidal). A velocidade de
   cruzeiro é calibrada para que a viagem completa feche o tempo típico de percurso da linha (`tripMin`,
   velocidade comercial de ~30–45 km/h, já contando as paradas).
3. **Tempo de plataforma** — 25–45 s por parada, mais nas estações de integração (`dwell` / `dwellX`).
4. **Posição** — distância percorrida desde a partida, projetada sobre o traçado real (shape do GTFS).

Os parâmetros por linha ficam em [`src/data/lines-meta.js`](src/data/lines-meta.js) e o modelo em
[`src/sim/model.js`](src/sim/model.js).

## Atualizando o mapa de fundo

```bash
brew install pmtiles   # CLI do Protomaps (uma vez)
npm run map:fetch      # recorta o mapa-múndi do Protomaps para a área da rede (+ margem) e baixa fontes/ícones
```

O recorte vai até o zoom 14 (de perto o MapLibre amplia os vetores, sem perder nitidez). A área é calculada a partir
dos traçados em `network.json`; se a rede crescer, basta rodar de novo.

> Por que não Google Maps? Os termos de uso do Google não permitem baixar e hospedar os mapas. O OpenStreetMap tem
> licença aberta (ODbL) e permite exatamente isso.

## Atualizando os dados da rede

```bash
npm run data       # baixa (data:fetch) e processa (data:build)
```

- `scripts/fetch-data.mjs` baixa para `data-raw/` (fora do git):
  - GTFS da SPTrans (inclui Metrô e CPTM) pelo espelho público do Mobility Database (`mdb-8`).
- `scripts/build-data.mjs` gera `public/data/network.json`: traçados suavizados, estações agrupadas em complexos de
  integração, conexões a pé, terminais de ônibus da SPTrans próximos às estações, rodoviárias e aeroportos.

Se uma linha nova aparecer no GTFS, basta adicioná-la em `lines-meta.js` com o `route_id` correspondente.

## Estrutura

```
src/
  main.js                 mapa, câmera, abertura, seleção, toque/clique e o loop
  data/lines-meta.js      cores oficiais, operadoras, afastamento entre linhas, parâmetros de estimativa
  data/network.js         carrega e prepara o network.json
  sim/model.js            partidas, perfil de velocidade, posição dos trens, próximas chegadas
  core/time.js            relógio no fuso de São Paulo (ao vivo ou simulado)
  map/basemap.js          estilo claro do mapa de fundo (MapLibre + PMTiles do Protomaps)
  map/geo.js              conversões km da rede ↔ lng/lat ↔ Mercator
  map/network-layers.js   estações, rótulos, plaquinhas das linhas e pontos de interesse (camadas nativas)
  map/rails-layer.js      linhas em WebGL2: desenho na abertura, pulso na linha selecionada, rastro dos trens
  map/trains-layer.js     trens 3D (nariz em bico, faróis/lanternas, sombra, anel do selecionado)
  map/images.js           plaquinhas e ícones desenhados em canvas
  ui/ui.js                painéis, barra de linhas e favoritas, horário, aviso
  ui/search.js            busca de estações, linhas e terminais
  ui/favorites.js         estações favoritas (localStorage)
  ui/permalink.js         link compartilhável (seleção no endereço)
```

## Desempenho (mobile)

- Mapa vetorial servido do próprio site, carregado sob demanda (só os tiles da tela).
- Trens e linhas em WebGL2 puro dentro do mapa (sem three.js): todos os trens numa única chamada de desenho.
- A simulação roda no ritmo necessário para o movimento parecer contínuo na tela: de longe, poucas vezes por
  segundo (os trens andam menos de 1 px/s); de perto ou com animações, a cada quadro. Poupa bateria.
- Simulação de ~300 trens + rastros custa < 1 ms de CPU por atualização.

## Créditos

- Dados de linhas, estações, intervalos e terminais: GTFS SPTrans.
- Mapa de fundo: © colaboradores do OpenStreetMap (ODbL), tiles vetoriais do [Protomaps](https://protomaps.com).
- Renderização do mapa: [MapLibre GL JS](https://maplibre.org).

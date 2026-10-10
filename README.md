# TrainView SP

Mapa 3D (Three.js) da rede sobre trilhos da Região Metropolitana de São Paulo — Metrô (linhas 1, 2, 3, 4, 5, 6, 15 e 17)
e trens metropolitanos (linhas 7 a 13) — com a **posição estimada** de cada trem em tempo real.

> ⚠️ **Projeto não oficial.** As posições são calculadas a partir da tabela oficial de intervalos; não vêm de GPS nem de
> nenhum sistema das operadoras. O site não tem vínculo com Metrô, CPTM, ViaQuatro, ViaMobilidade, TIC Trens,
> Trivia Trens, Linha Uni, SPTrans, EMTU, Governo do Estado ou Prefeitura de São Paulo. O aviso aparece fixo no topo
> da tela e detalhado no diálogo "Saiba mais".

## Rodando

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # gera dist/ (site 100% estático)
npm run preview    # serve o dist/ para conferir
```

O `dist/` pode ser publicado em qualquer hospedagem estática (Netlify, Vercel, GitHub Pages, S3…). Os caminhos são
relativos (`base: './'`), então funciona também em subpastas.

**Nenhuma API é chamada em tempo de execução**: tudo vem de `public/data/network.json` (~290 KB, ~100 KB com gzip).

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

## Atualizando os dados

```bash
npm run data       # baixa (data:fetch) e processa (data:build)
```

- `scripts/fetch-data.mjs` baixa para `data-raw/` (fora do git):
  - GTFS da SPTrans (inclui Metrô e CPTM) pelo espelho público do Mobility Database (`mdb-8`);
  - rios, represas e limite do município do OpenStreetMap (Overpass), só como contexto visual.
- `scripts/build-data.mjs` gera `public/data/network.json`: traçados suavizados, estações agrupadas em complexos de
  integração, conexões a pé, terminais de ônibus da SPTrans próximos às estações, rodoviárias e aeroportos.

Se uma linha nova aparecer no GTFS, basta adicioná-la em `lines-meta.js` com o `route_id` correspondente.

## Estrutura

```
src/
  main.js              orquestra cena, simulação, seleção, toque/clique e o loop
  data/lines-meta.js   cores oficiais, operadoras, parâmetros de estimativa
  data/network.js      carrega e prepara o network.json
  sim/model.js         partidas, perfil de velocidade, posição dos trens, próximas chegadas
  core/time.js         relógio no fuso de São Paulo (ao vivo ou simulado)
  render/stage.js      renderer, câmera, controles (toque), voos de câmera, qualidade adaptativa
  render/ribbon.js     fitas com largura em px (linhas neon, rios)
  render/rails.js      linhas neon + rastro luminoso dos trens + reflexo
  render/stations.js   estações (marcadores) e feixes de luz nas integrações
  render/trains.js     trens 3D instanciados + brilho
  render/ground.js     chão com grade, represas, rios e limite do município
  ui/                  rótulos com anti-sobreposição, painéis, horário, aviso
```

## Desempenho (mobile)

- Tudo em poucas draw calls: trens e estações instanciados, linhas como fitas com shader próprio.
- Brilho neon feito no shader (sem pós-processamento).
- Pixel ratio adaptativo: cai automaticamente se o aparelho não sustentar ~30 fps.
- Simulação de ~300 trens + rastros custa < 1 ms de CPU por quadro.

## Créditos

- Dados de linhas, estações, intervalos e terminais: GTFS SPTrans.
- Contexto geográfico: © colaboradores do OpenStreetMap (ODbL).
- Renderização: [three.js](https://threejs.org).

# Traffic Counter

[English](README.md) · **Português (Brasil)** · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Nederlands](README.nl.md) · [Italiano](README.it.md) · [Dansk](README.da.md)

Aplicativo de computador que conta **ciclistas, pedestres, automóveis, motocicletas, patinetes, scooters elétricos e monociclos** em vídeos de câmeras fixas de rua — com revisão humana de cada contagem antes do resultado final.

Feito para pesquisas de mobilidade (começou com a câmera da ciclovia de Andradas, MG), funciona com qualquer vídeo de câmera parada. O app fala português, inglês, espanhol, francês, alemão, holandês, italiano e dinamarquês: segue o idioma do computador, e dá para escolher outro em **Configurações**. Até a versão 0.0.7 ele se chamava "Contador de Tráfego".

## Como funciona

1. **Escolha o vídeo** — um arquivo do computador ou um link do Google Drive.
2. **Desenhe as linhas de contagem** em qualquer ângulo (ciclovia, calçada, faixa da rua) e escolha o que cada linha conta. Em vídeos 4K de câmera alta, marque também a área de análise.
3. **Detecção** — o app encontra e acompanha tudo o que se move (inteligência artificial YOLO + detecção de movimento), na placa de vídeo NVIDIA ou no processador.
4. **Sugestões** — um modelo de visão (via OpenRouter, com a sua chave) sugere a categoria de cada objeto que cruzou uma linha. As instruções e os nomes das categorias acompanham o idioma do app.
5. **Revisão** — você confere cada objeto num editor com o clipe, o vídeo original e uma linha do tempo, aceitando ou corrigindo a sugestão (atalhos de teclado, aceite em lote dos casos confiáveis).
6. **Vídeo final** — um MP4 com as linhas, as contagens e o painel de totais, mais uma planilha (`events.csv`) e um relatório (`report.json`). Vários vídeos (por exemplo, as horas de um dia) podem virar um único vídeo final com os totais somados.

## Baixar e instalar

Baixe o instalador da última versão em **[Releases](https://github.com/rafaels-dev/contador-ciclistas-andradas/releases/latest)**:

| Sistema | Arquivo |
|---|---|
| Windows 10/11 (64 bits) | `TrafficCounter-Setup-<versão>.exe` |
| macOS (chip Apple) | `TrafficCounter-<versão>-arm64.dmg` |
| macOS (Intel) | `TrafficCounter-<versão>-x64.dmg` |
| Linux | `.AppImage` ou `.deb` |

O instalador não pede administrador e o app se atualiza sozinho: quando há versão nova, aparece a faixa **Reiniciar e atualizar**.

Na primeira vez, um assistente prepara quatro coisas:

- **Idioma** — o do computador ou outro.
- **Placa de vídeo** — usa a NVIDIA se houver (bem mais rápido); dá para escolher só o processador.
- **Motor de detecção** — o app baixa e instala o Python e as bibliotecas de inteligência artificial (cerca de 1 GB sem placa NVIDIA, 2,5 GB com ela; ocupa até ~6 GB no disco).
- **Chave do OpenRouter** — o serviço pago por uso que faz as sugestões. Cada sugestão custa uma fração de centavo (duas horas de vídeo de uma avenida movimentada saíram por cerca de US$ 0,10). Crie a chave em [openrouter.ai](https://openrouter.ai/keys) e cole no app; ele testa antes de salvar.

**Requisitos:** placa de vídeo NVIDIA opcional (recomendada), espaço em disco para o motor (~6 GB) e para os vídeos finais, e internet para instalar o motor e para as sugestões.

**Se algo der errado:** em **Configurações → Ajuda e diagnóstico**, clique em **Salvar relatório de diagnóstico** e envie o arquivo `.zip` a quem dá suporte. Ele leva o registro do programa e o que aconteceu em cada vídeo — sem os vídeos e sem a sua chave.

Quem atualiza da 0.0.7 ou anterior: na primeira abertura o app move os dados para o nome novo. Nada é detectado de novo e nenhuma revisão se perde.

## Privacidade

Os vídeos são processados **no seu computador** e não são enviados a lugar nenhum. O app só se comunica com outros sistemas nestes casos:

| Quando | Para onde | O que vai |
|---|---|---|
| Sugestões de categoria (com a chave que você configurou) | [OpenRouter](https://openrouter.ai/privacy) e o provedor do modelo escolhido por ele (padrão: Anthropic; reservas: DeepSeek e Google) | Recortes pequenos de cada objeto candidato (sequência de recortes e o quadro do cruzamento, em JPEG). Nada mais do vídeo. |
| Você cola um link do Google Drive | [Google Drive](https://policies.google.com/privacy) | O pedido de download do arquivo do link. |
| Instalação do motor (primeira execução ou "Instalar agora") | GitHub (Python), [PyPI](https://pypi.org) e download.pytorch.org | Pedidos de download das bibliotecas. |
| Atualizações (ao abrir o app e a cada 4 h) | [GitHub Releases](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) deste repositório | Consulta da versão mais recente e, se houver, o download dela. |

Não há telemetria, conta de usuário nem coleta de dados de uso. O relatório de diagnóstico só é gerado quando você pede, fica salvo no seu computador e omite a chave do OpenRouter.

## Política de assinatura de código (Code signing policy)

Os instaladores são gerados pelo GitHub Actions ([`.github/workflows/desktop.yml`](.github/workflows/desktop.yml)) direto do código deste repositório, a partir de cada tag `v*`. A assinatura gratuita de código para projetos open source foi solicitada à [SignPath Foundation](https://signpath.org); enquanto ela não sai, o Windows e o macOS avisam na primeira abertura que o app é de um desenvolvedor não identificado.

Equipe:

- Autores (commits sem revisão adicional): [Rafael Schettino](https://github.com/rafaels-dev)
- Revisores: [Rafael Schettino](https://github.com/rafaels-dev)
- Aprovadores (aprovam cada assinatura): [Rafael Schettino](https://github.com/rafaels-dev)

Toda mudança na branch `main` passa pelos testes automatizados ([`.github/workflows/tests.yml`](.github/workflows/tests.yml)) antes do merge.

Privacidade: veja a seção [Privacidade](#privacidade) — este programa não transfere informações a outros sistemas em rede, exceto nos casos listados lá, pedidos pelo usuário ou por quem o instala ou opera.

## Para desenvolvedores

Estrutura:

- `web/` — o app (Next.js): telas, banco SQLite, orquestração das etapas e chamadas ao OpenRouter. Traduções em `web/messages/<idioma>.json` (next-intl) e as instruções do modelo de visão em `web/src/lib/prompts.ts`.
- `worker/` — Python: detecção e rastreamento (`detect.py`), vídeo final (`render.py`), leitura de vídeo com FFmpeg/NVDEC (`reader.py`).
- `desktop/` — Electron e instaladores (electron-builder); ver [`desktop/README.md`](desktop/README.md).
- `counter/`, `process_video.py`, `stream_realtime.py` — o contador original de linha de comando (contagem automática numa linha vertical, sem revisão), mantido para processamento em lote e tempo real.
- `evaluation/` — ferramentas de avaliação da contagem e calibração dos modelos.
- `tests/`, `web/src/**/*.test.ts` e `web/evals/` — testes automatizados e avaliação das instruções do modelo.

Rodar o app em desenvolvimento (Python 3.11 com as dependências e Node.js 22+):

```bash
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install torch==2.12.0 torchvision==0.27.0 --index-url https://download.pytorch.org/whl/cpu   # ou cu126 para NVIDIA
pip install -r requirements-dev.txt
cd web && npm ci && npm run dev                       # http://127.0.0.1:3000
```

Testes (os mesmos do CI, exigidos para o merge na `main`):

```bash
python -m pytest                      # worker e contador (na raiz)
cd web && npm run lint && npm run typecheck && npm test
cd web && npm run eval:prompts        # instruções do modelo em cada idioma (pago; ver web/evals/README.md)
```

Para incluir um idioma: um `web/messages/<código>.json` com todas as chaves do `en.json`, uma entrada em `web/src/i18n/locales.ts` e as instruções em `web/src/lib/prompts.ts`; depois, rode a avaliação das instruções.

Contador de linha de comando:

```bash
python process_video.py --video camera.mp4                 # vídeo anotado + result.json
python process_video.py --video camera.mp4 --no-video      # só os números
python stream_realtime.py rtsp://192.168.1.100/cam4         # eventos JSON em tempo real
```

## Licença

Copyright © 2026 Rafael Schettino.

Este programa é software livre, distribuído sob a **GNU Affero General Public License, versão 3** ([`LICENSE`](LICENSE)). Você pode usá-lo, estudá-lo, modificá-lo e redistribuí-lo; quem distribuir versões modificadas — ou oferecê-las a outras pessoas pela rede — deve disponibilizar o código-fonte sob a mesma licença.

Principais componentes de terceiros, todos open source:

| Componente | Licença |
|---|---|
| [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) e os pesos `yolov8n.pt` (inclusive o ajuste fino em `runs/ft_blur`) | AGPL-3.0 |
| [PyTorch](https://pytorch.org) | BSD-3-Clause |
| [OpenCV](https://opencv.org) | Apache-2.0 |
| [supervision](https://github.com/roboflow/supervision) | MIT |
| [FFmpeg](https://ffmpeg.org) (via imageio-ffmpeg) | LGPL/GPL |
| [Electron](https://www.electronjs.org), [Next.js](https://nextjs.org), [next-intl](https://next-intl.dev), [React](https://react.dev) | MIT |
| [uv](https://github.com/astral-sh/uv) | MIT / Apache-2.0 |

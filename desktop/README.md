# App desktop (Windows, macOS, Linux)

Empacota o app de revisão (`web/`) como um programa instalável, no estilo do Spotify:

- **Instalação:** instala por usuário, sem pedir senha de administrador, e abre ao terminar.
- **Janela:** sem moldura, com a barra de título desenhada pelo próprio app.
- **Atualização:** baixa em segundo plano pelos GitHub Releases (electron-updater) e instala ao fechar.

## Como funciona

- **Electron** (`main.cjs`): abre a janela e sobe o servidor Next *standalone* num processo filho, numa porta livre de `127.0.0.1`. A ponte mínima com a página fica em `preload.cjs`: plataforma, cor dos botões da janela por tema e o diálogo nativo de arquivos.
- **Acesso ao servidor:** a cada execução o Electron sorteia um token (`CONTADOR_TOKEN`) e o entrega só à sua janela, como cookie. O `web/src/proxy.ts` recusa requisições sem o token ou com `Host` diferente de `127.0.0.1:<porta>`, o que barra outros programas do computador e DNS rebinding. A janela só navega dentro da origem do app; o resto (só `http`/`https`) abre no navegador padrão.
- **Dados do usuário:** ficam na pasta de dados do app.
  - Windows: `%APPDATA%\Contador de Tráfego`.
  - macOS: `~/Library/Application Support/Contador de Tráfego`.
  - Linux: `~/.config/Contador de Tráfego`.
  - Conteúdo: `dados/` (banco e vídeos processados), `config.env` (chave do OpenRouter, editável em **Configurações**), `motor/` (Python) e `servidor.log`.
- **Primeiro acesso:** um assistente pergunta pela placa de vídeo, instala o motor e pede a chave da IA (com passo a passo e teste antes de salvar). Tudo isso continua editável em **Configurações**.
- **Motor (Python + YOLO):** não vai no instalador, porque o PyTorch com CUDA passa de 2 GB. O assistente (ou **Configurações → Instalar**) usa o `uv` embutido para:
  - baixar o Python 3.11;
  - instalar o PyTorch (com CUDA se houver placa NVIDIA, senão para CPU; MPS no Mac);
  - instalar o `requirements.txt`.
- **Python já existente:** a variável `PYTHON` aponta o worker para um Python já instalado. Sem ela, o app usa só o ambiente que ele mesmo instalou.
- **Versões fixas:** `requirements.txt` e o PyTorch têm versão fixa, porque cada máquina instala do zero. Testado no Linux: a instalação só com processador ocupa 1,7 GB e detecta normalmente (17 fps num clipe 1080p).

## Gerar os instaladores

```bash
cd desktop
npm install
npm run dist:linux   # AppImage + .deb (dá para gerar no WSL)
npm run dist:win     # .exe (NSIS) — rode no Windows
npm run dist:mac     # .dmg (arm64 e x64) — rode num Mac
```

`npm run preparar` monta `recursos/`:

- **Servidor Next standalone:** compilado numa cópia limpa de `web/`, sem `data/`. Com os vídeos lá dentro, o Turbopack estoura a memória.
- **Worker e pesos:** `worker/`, `config.py` e os pesos do YOLO.
- **uv:** a cópia do sistema; no CI, baixada do GitHub.
- **Pesos:** `best.pt` vem do repositório; `yolov8n.pt` da raiz ou, faltando, do release da Ultralytics.

No CI (`.github/workflows/desktop.yml`), uma tag `v*` (ex.: `git tag v0.0.1 && git push origin v0.0.1`) gera os três instaladores e os publica no Release, de onde os apps já instalados se atualizam; em **Actions → App desktop → Run workflow** dá para gerar à mão, informando a versão e o sistema, sem publicar. O fine-tune de bicicletas (`runs/ft_blur/weights/best.pt`, 6 MB) está no git; o `yolov8n.pt` o CI baixa da Ultralytics.

## Testar sem empacotar

```bash
cd desktop
npm run dev          # janela do app sobre um servidor já rodando em http://127.0.0.1:3000 (`next dev` ou `npm run producao` em web/)
npm run preparar && npm run iniciar   # com o servidor embutido, como no instalador
```

## Pendências

- **Assinatura:** sem certificado de código, o Windows (SmartScreen) e o macOS (Gatekeeper) avisam na primeira abertura. O Mac usa assinatura ad-hoc.
- **macOS:** a instalação do motor e a detecção ainda não foram testadas. No Mac não há NVDEC, então o worker lê o vídeo pela CPU.

## Validado no Windows (out/2026)

Windows 11, RTX 4060: instalador NSIS, assistente de primeiro acesso (placa, motor com CUDA pelo `uv`, chave da IA), importação pelo diálogo nativo e pelo campo de caminho, detecção, sugestões, revisão, vídeo final (h264_nvenc), downloads, cancelamento (`taskkill /T`) e fechamento com worker rodando (nada fica órfão). Armadilhas encontradas e corrigidas:

- `cv2.imwrite` devolve `False` em silêncio com acento no caminho — e a pasta de dados é `Contador de Tráfego`. O worker grava JPG por `imencode` + `write_bytes` (`gravar_jpg` em `worker/leitor.py`).
- O Python do Windows nasce em cp1252: os eventos JSON com "→"/"…" derrubavam o worker. O runner passa `PYTHONUTF8=1` e os scripts reconfiguram o stdout.
- `fs.readdirSync` lista as junções de compatibilidade da pasta do usuário ("Application Data", "My Documents"…), que não abrem; o navegador de pastas as esconde.

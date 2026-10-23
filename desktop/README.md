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
- **Motor (Python + YOLO):** não vai no instalador, porque o PyTorch com CUDA passa de 2 GB. Na primeira execução, **Configurações → Instalar o motor** usa o `uv` embutido para:
  - baixar o Python 3.11;
  - instalar o PyTorch (com CUDA se houver placa NVIDIA, senão para CPU; MPS no Mac);
  - instalar o `requirements.txt`.
- **Python já existente:** a variável `PYTHON` aponta o worker para um Python já instalado.

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

No CI (`.github/workflows/desktop.yml`), uma tag `v*` gera os três instaladores e os publica no Release, de onde os apps já instalados se atualizam. Para isso, o fine-tune de bicicletas (`runs/ft_blur/weights/best.pt`) precisa estar anexado a um release, com a URL na variável `PESOS_BICICLETAS_URL` do repositório.

## Testar sem empacotar

```bash
cd desktop
npm run dev          # janela do app sobre o `next dev` em http://127.0.0.1:3000
npm run preparar && npm run iniciar   # com o servidor embutido, como no instalador
```

## Pendências

- **Assinatura:** sem certificado de código, o Windows (SmartScreen) e o macOS (Gatekeeper) avisam na primeira abertura. O Mac usa assinatura ad-hoc.
- **Testes nos outros sistemas:** a instalação do motor e a detecção ainda não foram testadas no Windows e no macOS. No Mac não há NVDEC, então o worker lê o vídeo pela CPU.

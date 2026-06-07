# Contador de Ciclistas, Pedestres, Automóveis e Motocicletas

Ferramenta de inteligência artificial que analisa vídeos de câmeras de rua e conta automaticamente quatro categorias de usuários:

- 🚲 **Ciclistas** — pessoas andando de bicicleta
- 🚶 **Pedestres** — pessoas a pé
- 🚗 **Automóveis** — carros, ônibus e caminhões
- 🏍️ **Motocicletas**

A contagem é feita quando cada objeto cruza uma linha vertical no centro do vídeo. O programa gera um vídeo anotado em H.264 (tamanho próximo ao original) e um arquivo JSON com os totais e os instantes de cada evento.

---

## Requisitos de hardware

| Item | Mínimo | Recomendado |
|---|---|---|
| RAM | 4 GB | 8 GB ou mais |
| CPU | Qualquer dual-core | Quad-core ou melhor |
| GPU | Não obrigatório | NVIDIA com CUDA (processa mais rápido) |
| Espaço em disco | ~1,3× o tamanho do vídeo original | — |

> O vídeo de saída é gravado em H.264 via ffmpeg embutido no pacote `imageio` — sem instalação manual. Nos testes com a câmera de Andradas, um vídeo original de 47 MB gerou um arquivo anotado de 63 MB. As anotações visuais (caixas, texto, painel) aumentam levemente a complexidade dos frames, daí a diferença. Use `--sem-video` se quiser apenas os números, sem gerar vídeo.

---

## 1. Instale o Python

O programa precisa do **Python 3.10 ou superior**.

### Windows

1. Acesse [python.org/downloads](https://www.python.org/downloads/) e baixe o instalador mais recente.
2. Execute o instalador. **Marque a opção "Add Python to PATH"** antes de clicar em *Install Now*.
3. Após a instalação, abra o **Prompt de Comando** (tecle `Win + R`, digite `cmd`, pressione Enter) e confirme:
   ```
   python --version
   ```
   Deve aparecer algo como `Python 3.12.x`.

### macOS

1. Acesse [python.org/downloads](https://www.python.org/downloads/) e baixe o instalador para macOS.
2. Execute o `.pkg` e siga os passos.
3. Abra o **Terminal** (Finder → Aplicativos → Utilitários → Terminal) e confirme:
   ```
   python3 --version
   ```

### Linux (Ubuntu / Debian)

O Python já costuma vir instalado. Confirme no terminal:
```bash
python3 --version
```
Se não estiver instalado:
```bash
sudo apt update && sudo apt install python3 python3-pip python3-venv -y
```

---

## 2. Baixe o projeto

Se você recebeu os arquivos por zip ou pen drive, extraia tudo em uma pasta de fácil acesso, por exemplo:

- Windows: `C:\Users\SeuNome\contador-ciclistas`
- macOS/Linux: `/home/seunome/contador-ciclistas`

Se tiver o **Git** instalado, pode clonar diretamente:
```bash
git clone <url-do-repositorio>
cd contador-ciclistas-andradas
```

---

## 3. Crie um ambiente virtual e instale as dependências

Um ambiente virtual isola as bibliotecas deste projeto sem interferir no resto do seu computador. O comando `pip install` já instala tudo que é necessário, incluindo o ffmpeg embutido para geração do vídeo em H.264 — **não é preciso instalar o ffmpeg separadamente**.

### Windows

Abra o **Prompt de Comando** na pasta do projeto (você pode digitar `cmd` na barra de endereço do Explorador de Arquivos) e execute:

```bat
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Quando o ambiente estiver ativo, você verá `(venv)` no início da linha do prompt.

### macOS e Linux

Abra o **Terminal** na pasta do projeto e execute:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Quando ativo, você verá `(venv)` no início da linha.

> **Na primeira execução**, o programa baixará automaticamente o modelo de IA (~6 MB). É necessário ter conexão com a internet somente nessa primeira vez.

---

## 4. Como usar

> **Importante:** sempre ative o ambiente virtual antes de rodar o programa (passo 3). Se fechar e reabrir o terminal, ative novamente com `venv\Scripts\activate` (Windows) ou `source venv/bin/activate` (macOS/Linux).

### Uso básico — processar o vídeo padrão

Coloque o vídeo chamado `Andradas.mp4` na mesma pasta do programa e execute:

```bash
# Windows
python processar_video.py

# macOS / Linux
python3 processar_video.py
```

Ao terminar, serão criados dois arquivos na mesma pasta:
- `Andradas_anotado.mp4` — vídeo em H.264 com as detecções desenhadas e os contadores na tela
- `resultado.json` — dados detalhados em formato de texto estruturado

### Especificar outro vídeo

```bash
python processar_video.py --video minha_camera.mp4
```

### Escolher o nome do vídeo de saída

```bash
python processar_video.py --video entrada.mp4 --saida saida_anotada.mp4
```

### Processar apenas um trecho (em segundos)

```bash
# Processar do segundo 30 ao segundo 90
python processar_video.py --inicio 30 --fim 90
```

### Só obter as estatísticas, sem gerar vídeo

Mais rápido — útil quando você só quer os números:

```bash
python processar_video.py --sem-video
```

### Referência completa das opções

| Opção | Descrição | Padrão |
|---|---|---|
| `--video ARQUIVO` | Caminho para o vídeo a analisar | `Andradas.mp4` |
| `--saida ARQUIVO` | Nome do vídeo anotado gerado | `<nome-do-video>_anotado.mp4` |
| `--json ARQUIVO` | Nome do arquivo JSON com resultados | `resultado.json` |
| `--sem-video` | Não gera vídeo anotado (mais rápido) | — |
| `--inicio SEGUNDOS` | Começa a processar a partir desse segundo | `0` |
| `--fim SEGUNDOS` | Para de processar nesse segundo | fim do vídeo |

---

## 5. Exemplo de saída no terminal

```
Vídeo     : Andradas.mp4
Resolução : 1920x1080 @ 15.0fps  |  Duração: 371.7s
Intervalo : frames 0–5576 (371.7s)

Codec de saída: H.264 (libx264)

  🏍️ motocicletas   frame 63   (00:04.20) | total: 1
  🚶 pedestres      frame 88   (00:05.87) | total: 1
  🚲 ciclistas      frame 2083 (02:18.87) | total: 1
  🚲 ciclistas      frame 2377 (02:38.47) | total: 2
  🚶 pedestres      frame 2402 (02:40.13) | total: 2
  ...

────────────────────────────────────────────────────
  Ciclistas    : 2
  Pedestres    : 7
  Automóveis   : 11
  Motocicletas : 11
────────────────────────────────────────────────────
  Processamento: 175.3s (2.12× tempo real)
  Vídeo anotado: Andradas_anotado.mp4
  Tamanho      : 62.7 MB
  JSON         : resultado.json
```

Cada linha mostra o momento exato (em `MM:SS.ss`) em que um novo objeto foi contado.

---

## 6. Entendendo o vídeo anotado

No vídeo gerado você verá:

- **Linha branca vertical** no centro — é a linha de contagem; objetos são registrados ao cruzá-la
- **Caixas coloridas** ao redor de cada objeto detectado:
  - 🟢 Verde — ciclistas
  - 🟡 Amarelo — pedestres
  - 🟠 Laranja — automóveis
  - 🔵 Ciano — motocicletas
- **Painel de contagem** no canto superior esquerdo com os totais acumulados

---

## 7. Ajustando as configurações

Se precisar adaptar o programa para outra câmera ou local, edite o arquivo `config.py` com um editor de texto simples (Bloco de Notas, TextEdit, gedit):

| Configuração | O que faz | Padrão |
|---|---|---|
| `LINHA_X` | Posição horizontal da linha de contagem (pixels) | `960` (centro de 1920px) |
| `CONFIANCA` | Sensibilidade da detecção (0.0 a 1.0). Valor menor detecta mais objetos, mas pode gerar falsos positivos | `0.40` |
| `DIST_MAX_CYCLIST_PX` | Distância máxima (pixels) entre pessoa e bicicleta para considerar ciclista | `250` |

---

## 8. Resolução de problemas

### "python não é reconhecido como um comando"
- **Windows:** o Python não foi adicionado ao PATH durante a instalação. Reinstale e marque a opção **"Add Python to PATH"**.
- **macOS/Linux:** tente usar `python3` em vez de `python`.

### "ModuleNotFoundError: No module named 'ultralytics'"
O ambiente virtual não está ativo ou as dependências não foram instaladas. Execute:
```bash
# Windows
venv\Scripts\activate
pip install -r requirements.txt

# macOS / Linux
source venv/bin/activate
pip install -r requirements.txt
```

### "Erro: não foi possível abrir 'Andradas.mp4'"
O vídeo não foi encontrado na pasta. Verifique:
1. Se o arquivo existe na mesma pasta que `processar_video.py`
2. O nome exato do arquivo (incluindo a extensão `.mp4`)
3. Use `--video` para indicar o caminho completo: `python processar_video.py --video C:\Videos\meu_video.mp4`

### O processamento está muito lento
- Use `--sem-video` para não gerar o vídeo anotado (economiza tempo)
- Processe apenas um trecho com `--inicio` e `--fim`
- Um computador com GPU NVIDIA acelera significativamente o processo

### O vídeo anotado não abre
O vídeo de saída usa o codec H.264, compatível com a grande maioria dos players modernos (Windows Media Player, Fotos do Windows, QuickTime, VLC). Se o seu player não abrir, instale o **VLC Media Player** ([videolan.org](https://www.videolan.org/)) — ele suporta qualquer formato.

### A linha "Codec de saída" mostra "mp4v (fallback)"
Isso ocorre em situações raras em que o ffmpeg embutido não pôde ser carregado. O vídeo ainda será gerado, porém em qualidade equivalente e com tamanho maior (~3× o original). Para resolver, tente reinstalar as dependências:
```bash
pip install --force-reinstall imageio[ffmpeg]
```

---

## Suporte

Em caso de dúvidas ou problemas, entre em contato com a equipe responsável pelo projeto.

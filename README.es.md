# Traffic Counter

[English](README.md) · [Português (Brasil)](README.pt-BR.md) · **Español** · [Français](README.fr.md) · [Deutsch](README.de.md) · [Nederlands](README.nl.md) · [Italiano](README.it.md) · [Dansk](README.da.md)

Una aplicación de escritorio que cuenta **ciclistas, peatones, automóviles, motocicletas, patinetes, ciclomotores eléctricos y monociclos** en videos de cámaras de calle fijas. Una persona revisa cada conteo antes del resultado final.

Se creó para la investigación en movilidad urbana (empezó con la cámara de la ciclovía de Andradas, Brasil) y funciona con cualquier video de una cámara que no se mueva. La aplicación está en inglés, portugués, español, francés, alemán, neerlandés, italiano y danés. Sigue el idioma del equipo, y puedes elegir otro en **Configuración**.

## Cómo funciona

1. **Elige el video.** Usa un archivo de tu equipo o un enlace de Google Drive.
2. **Dibuja las líneas de conteo.** Pueden ir en cualquier ángulo (ciclovía, acera, un carril) y tú eliges qué cuenta cada línea. En videos 4K de una cámara alta, marca también el área de análisis.
3. **Detección.** La aplicación encuentra y sigue todo lo que se mueve, con la detección de objetos de YOLO más la detección de movimiento. Funciona con una tarjeta gráfica NVIDIA o con el procesador.
4. **Sugerencias.** Un modelo de visión, al que se llama a través de OpenRouter con tu propia clave, sugiere la categoría de cada objeto que cruzó una línea. El prompt y los nombres de las categorías siguen el idioma de la aplicación.
5. **Revisión.** Compruebas cada objeto en un editor con el clip, el video original y una línea de tiempo, y aceptas o corriges la sugerencia. Los atajos de teclado y la aceptación en bloque de los casos fiables hacen que sea rápido.
6. **Video final.** Obtienes un MP4 con las líneas, los conteos y un panel de totales, además de una hoja de cálculo (`events.csv`) y un informe (`report.json`). Varios videos (las horas de un día, por ejemplo) pueden convertirse en un único video final con los totales sumados.

## Descarga e instalación

Descarga el instalador de la última versión en **[Releases](https://github.com/rafaels-dev/contador-ciclistas-andradas/releases/latest)**:

| Sistema | Archivo |
|---|---|
| Windows 10/11 (64 bits) | `TrafficCounter-Setup-<version>.exe` |
| macOS (chip de Apple) | `TrafficCounter-<version>-arm64.dmg` |
| macOS (Intel) | `TrafficCounter-<version>-x64.dmg` |
| Linux | `.AppImage` o `.deb` |

El instalador no pide permisos de administrador y la aplicación se actualiza sola. Cuando hay una nueva versión lista, aparece un aviso **Reiniciar y actualizar**.

La primera vez, un asistente configura cuatro cosas:

- **Idioma.** El idioma del equipo u otro.
- **Tarjeta gráfica.** La aplicación usa una tarjeta NVIDIA si la hay (mucho más rápido). Puedes elegir usar solo el procesador.
- **Motor de detección.** La aplicación descarga e instala Python y las bibliotecas de IA: unos 1 GB sin tarjeta NVIDIA, 2,5 GB con ella, y hasta ~6 GB en disco.
- **Clave de OpenRouter.** OpenRouter es el servicio de pago por uso que hace las sugerencias. Cada sugerencia cuesta una fracción de centavo: dos horas de video de una avenida con mucho tráfico salieron por unos US$ 0,10. Crea una clave en [openrouter.ai](https://openrouter.ai/keys) y pégala en la aplicación, que la prueba antes de guardarla.

**Requisitos:**
- Una tarjeta gráfica NVIDIA (opcional, recomendada).
- Espacio en disco para el motor (~6 GB) y para los videos finales.
- Internet, para instalar el motor y para las sugerencias.

**Si algo sale mal:** ve a **Configuración → Ayuda y diagnóstico**, haz clic en **Guardar informe de diagnóstico** y envía el archivo `.zip` a quien te da soporte. Contiene el registro del programa y lo que pasó con cada video. No contiene los videos ni tu clave.

Si actualizas desde la 0.0.7 o anterior (cuando la aplicación se llamaba "Contador de Tráfego"): la aplicación traslada tus datos al nuevo nombre la primera vez que se inicia. No se vuelve a detectar nada y no se pierde ninguna revisión.

## Privacidad

Los videos se procesan **en tu equipo** y no se envían a ningún sitio. La aplicación solo se comunica con otros sistemas en estos casos:

| Cuándo | Adónde | Qué se envía |
|---|---|---|
| Sugerencias de categoría (con la clave que configuraste) | [OpenRouter](https://openrouter.ai/privacy) y el proveedor del modelo al que lo dirige (por defecto: Anthropic; reservas: DeepSeek y Google) | Pequeños recortes de cada objeto candidato (una secuencia de recortes y el fotograma del cruce, en JPEG). Nada más del video. |
| Pegas un enlace de Google Drive | [Google Drive](https://policies.google.com/privacy) | La solicitud de descarga del archivo enlazado. |
| Instalación del motor (primer uso o "Instalar ahora") | GitHub (Python), [PyPI](https://pypi.org) y download.pytorch.org | Solicitudes de descarga de las bibliotecas. |
| Actualizaciones (al abrir la aplicación y cada 4 h) | Los [GitHub Releases](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement) de este repositorio | Una consulta de la última versión y, si la hay, su descarga. |

No hay telemetría, ni cuenta de usuario, ni recopilación de datos de uso. El informe de diagnóstico solo se crea cuando lo pides. Se guarda en tu equipo y no incluye la clave de OpenRouter.

## Política de firma de código (Code signing policy)

Los instaladores los compila GitHub Actions ([`.github/workflows/desktop.yml`](.github/workflows/desktop.yml)) directamente a partir del código de este repositorio, desde cada etiqueta `v*`. Se ha solicitado la firma de código gratuita para proyectos de código abierto a la [SignPath Foundation](https://signpath.org). Hasta que llegue, Windows y macOS avisan en el primer inicio de que la aplicación es de un desarrollador no identificado.

Equipo:

- Committers (commits sin revisión adicional): [Rafael Schettino](https://github.com/rafaels-dev)
- Revisores: [Rafael Schettino](https://github.com/rafaels-dev)
- Aprobadores (aprueban cada firma): [Rafael Schettino](https://github.com/rafaels-dev)

Todo cambio en la rama `main` debe pasar las pruebas automáticas ([`.github/workflows/tests.yml`](.github/workflows/tests.yml)) antes de poder fusionarse.

Privacidad: consulta la sección [Privacidad](#privacidad). Este programa no transferirá ninguna información a otros sistemas en red salvo que lo solicite expresamente el usuario o la persona que lo instala o lo opera, excepto en los casos que allí se enumeran.

## Para desarrolladores

Estructura:

- `web/`: la aplicación (Next.js). Pantallas, base de datos SQLite, orquestación de los pasos y las llamadas a OpenRouter. Las traducciones están en `web/messages/<idioma>.json` (next-intl) y los prompts de visión en `web/src/lib/prompts.ts`.
- `worker/`: Python. Detección y seguimiento (`detect.py`), video final (`render.py`), lectura de video con FFmpeg/NVDEC (`reader.py`).
- `desktop/`: Electron e instaladores (electron-builder). Consulta [`desktop/README.md`](desktop/README.md).
- `counter/`, `process_video.py`, `stream_realtime.py`: el contador original de línea de comandos (conteo automático en una línea vertical, sin revisión), que se mantiene para el procesamiento por lotes y en tiempo real.
- `evaluation/`: herramientas para evaluar el conteo y calibrar los modelos.
- `tests/`, `web/src/**/*.test.ts` y `web/evals/`: pruebas automáticas y evaluaciones de prompts.

Para ejecutar la aplicación en desarrollo necesitas Python 3.11 con las dependencias y Node.js 22+:

```bash
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install torch==2.12.0 torchvision==0.27.0 --index-url https://download.pytorch.org/whl/cpu   # o cu126 para NVIDIA
pip install -r requirements-dev.txt
cd web && npm ci && npm run dev                       # http://127.0.0.1:3000
```

Pruebas (las mismas que en CI, obligatorias para fusionar en `main`):

```bash
python -m pytest                      # worker y contador (en la raíz)
cd web && npm run lint && npm run typecheck && npm test
cd web && npm run eval:prompts        # prompt de visión en todos los idiomas (de pago; ver web/evals/README.md)
```

Añadir un idioma: agrega un `web/messages/<código>.json` con todas las claves de `en.json`, una entrada en `web/src/i18n/locales.ts` y el prompt en `web/src/lib/prompts.ts`. Después ejecuta las evaluaciones de prompts.

Contador de línea de comandos:

```bash
python process_video.py --video camera.mp4                 # video anotado + result.json
python process_video.py --video camera.mp4 --no-video      # solo los números
python stream_realtime.py rtsp://192.168.1.100/cam4         # eventos JSON en tiempo real
```

## Licencia

Copyright © 2026 Rafael Schettino.

Este programa es software libre, distribuido bajo la **GNU Affero General Public License, versión 3** ([`LICENSE`](LICENSE)). Puedes usarlo, estudiarlo, modificarlo y redistribuirlo. Si distribuyes versiones modificadas, o las ofreces a otras personas a través de una red, debes poner a disposición el código fuente bajo la misma licencia.

Principales componentes de terceros, todos de código abierto:

| Componente | Licencia |
|---|---|
| [Ultralytics YOLO](https://github.com/ultralytics/ultralytics) y los pesos `yolov8n.pt` (incluido el ajuste fino en `runs/ft_blur`) | AGPL-3.0 |
| [PyTorch](https://pytorch.org) | BSD-3-Clause |
| [OpenCV](https://opencv.org) | Apache-2.0 |
| [supervision](https://github.com/roboflow/supervision) | MIT |
| [FFmpeg](https://ffmpeg.org) (vía imageio-ffmpeg) | LGPL/GPL |
| [Electron](https://www.electronjs.org), [Next.js](https://nextjs.org), [next-intl](https://next-intl.dev), [React](https://react.dev) | MIT |
| [uv](https://github.com/astral-sh/uv) | MIT / Apache-2.0 |

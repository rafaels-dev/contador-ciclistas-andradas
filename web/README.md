# web — app de revisão (Next.js)

Fluxo de um job (ordem fixa):

1. **baixando** — vídeo do link do Google Drive (público; fallback: rclone `gdrive`)
2. **aguardando_linhas** — usuário desenha uma ou mais linhas de contagem (qualquer ângulo) sobre o 1º frame; podem ser salvas por câmera
3. **detectando** — worker Python (`../contador/`) gera um candidato por trajetória que cruza cada linha (sem linhas: toda trajetória com deslocamento relevante)
4. **sugerindo** — OpenRouter sugere a categoria para **todos** os candidatos
5. **aguardando_revisao** — humano confirma, corrige ou descarta cada candidato
6. **renderizando** → **concluido** — vídeo original + contador, só com os eventos confirmados

```bash
npm install
npm run dev        # desenvolvimento (hot reload), http://localhost:3000
npm run producao   # modo produção com os mesmos dados (compila numa cópia limpa e sobe na 3000)
```

`OPENROUTER_API_KEY` vem do `.env` da raiz do repositório (carregado em `next.config.ts`).
Banco SQLite (`node:sqlite`, Node ≥ 22.13) e arquivos dos jobs em `web/data/` (gitignored).

import Link from "next/link";
import { connection } from "next/server";
import { listarGrupos, listarJobs, listarRenders } from "@/lib/db";
import { BOTAO, TITULO_PAINEL } from "@/lib/ui";
import { ItemNav, NovoGrupo } from "./itens-nav";

/** Painel lateral: a biblioteca de vídeos, organizada em grupos, e as exportações. */
export async function Biblioteca() {
  await connection();
  const jobs = listarJobs();
  const grupos = listarGrupos();
  const semGrupo = jobs.filter((j) => !j.grupo_id).length;
  const renders = listarRenders().length;

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-panel px-2 py-3" aria-label="Biblioteca">
      <Link href="/importar" className={`${BOTAO.primario} mx-1`}>
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Importar vídeos
      </Link>

      <nav className="flex flex-col gap-0.5">
        <h2 className={`${TITULO_PAINEL} px-2 pb-1`}>Biblioteca</h2>
        <ItemNav href="/" grupo={null} n={jobs.length} icone="todos">
          Todos os vídeos
        </ItemNav>
        {grupos.map((g) => (
          <ItemNav key={g.id} href={`/?grupo=${g.id}`} grupo={g.id} n={g.n} icone="grupo">
            {g.nome}
          </ItemNav>
        ))}
        {semGrupo > 0 && grupos.length > 0 && (
          <ItemNav href="/?grupo=sem" grupo="sem" n={semGrupo} icone="solto">
            Sem grupo
          </ItemNav>
        )}
        <NovoGrupo />
      </nav>

      <nav className="flex flex-col gap-0.5">
        <h2 className={`${TITULO_PAINEL} px-2 pb-1`}>Vídeo final</h2>
        <ItemNav href="/renders" grupo={undefined} n={renders} icone="exportar">
          Exportações
        </ItemNav>
      </nav>

      <nav className="mt-auto flex flex-col gap-0.5">
        <ItemNav href="/configuracoes" grupo={undefined} n={null} icone="config">
          Configurações
        </ItemNav>
      </nav>
    </aside>
  );
}

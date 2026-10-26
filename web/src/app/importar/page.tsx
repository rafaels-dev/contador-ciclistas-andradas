import { connection } from "next/server";
import { Suspense } from "react";
import { listarGrupos } from "@/lib/db";
import { arquivosLocaisPermitidos } from "@/lib/locais";
import { Importar } from "./importar";

export default function PaginaImportar(props: PageProps<"/importar">) {
  return (
    <Suspense fallback={<p className="p-6 text-muted">Carregando…</p>}>
      <Conteudo searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Conteudo({ searchParams }: { searchParams: PageProps<"/importar">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const grupos = listarGrupos().map((g) => ({ id: g.id, nome: g.nome }));
  const inicial = typeof sp.grupo === "string" && grupos.some((g) => g.id === sp.grupo) ? sp.grupo : "";
  return <Importar grupos={grupos} grupoInicial={inicial} locais={arquivosLocaisPermitidos()} />;
}

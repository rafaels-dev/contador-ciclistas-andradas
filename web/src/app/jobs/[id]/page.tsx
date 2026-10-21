import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { obterJob } from "@/lib/db";

export default function PaginaJob(props: PageProps<"/jobs/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <Link href="/" className="text-sm text-emerald-700 hover:underline dark:text-emerald-400">
        ← Jobs
      </Link>
      <Suspense fallback={<p className="text-zinc-500">Carregando…</p>}>
        <DetalheJob params={props.params} />
      </Suspense>
    </main>
  );
}

async function DetalheJob({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = obterJob(id);
  if (!job) notFound();

  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">{job.nome_arquivo ?? job.drive_id}</h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-zinc-500">Status</dt>
        <dd>{job.status}</dd>
        <dt className="text-zinc-500">Progresso</dt>
        <dd>{Math.round(job.progresso * 100)}%</dd>
        <dt className="text-zinc-500">Link</dt>
        <dd className="truncate">{job.link_drive}</dd>
        {job.erro && (
          <>
            <dt className="text-zinc-500">Erro</dt>
            <dd className="text-red-600">{job.erro}</dd>
          </>
        )}
      </dl>
    </section>
  );
}

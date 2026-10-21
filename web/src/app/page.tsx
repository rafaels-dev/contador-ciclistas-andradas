import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { listarJobs } from "@/lib/db";
import { FormNovoJob } from "./form-novo-job";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <header>
        <h1 className="text-2xl font-semibold">Contador de tráfego</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Cole o link de um vídeo do Google Drive. O app detecta os objetos em movimento, pede uma
          sugestão de classificação ao modelo de visão e você confirma antes do vídeo final.
        </p>
      </header>

      <FormNovoJob />

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Jobs</h2>
        <Suspense fallback={<p className="text-zinc-500">Carregando…</p>}>
          <ListaJobs />
        </Suspense>
      </section>
    </main>
  );
}

async function ListaJobs() {
  await connection();
  const jobs = listarJobs();
  if (jobs.length === 0) return <p className="text-zinc-500">Nenhum job ainda.</p>;

  return (
    <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {jobs.map((job) => (
        <li key={job.id}>
          <Link
            href={`/jobs/${job.id}`}
            className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <span className="truncate">{job.nome_arquivo ?? job.drive_id}</span>
            <span className="shrink-0 text-sm text-zinc-500">{job.status}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

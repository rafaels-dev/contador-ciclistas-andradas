import { connection } from "next/server";
import { Suspense } from "react";
import { listGroups } from "@/lib/db";
import { localFilesAllowed } from "@/lib/local-files";
import { Importer } from "./importer";
import { PageLoading } from "@/app/_shell/page-loading";

export default function ImportPage(props: PageProps<"/import">) {
  return (
    <Suspense fallback={<PageLoading />}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/import">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const groups = listGroups().map((g) => ({ id: g.id, name: g.name }));
  const initial = typeof sp.group === "string" && groups.some((g) => g.id === sp.group) ? sp.group : "";
  return <Importer groups={groups} initialGroup={initial} roots={localFilesAllowed()} />;
}

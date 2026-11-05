"use client";

import { useTranslations } from "next-intl";
import { BUTTON } from "@/lib/ui";
import { editLines } from "./actions";

/** Asks for confirmation: redoing the candidates discards suggestions and reviews. */
export function EditLinesButton({ jobId, quick }: { jobId: string; quick: boolean }) {
  const t = useTranslations("job");
  return (
    <form
      action={editLines.bind(null, jobId)}
      onSubmit={(e) => {
        if (!confirm(t(quick ? "editLinesConfirmQuick" : "editLinesConfirmFull"))) e.preventDefault();
      }}
    >
      <button className={BUTTON.secondary}>{t("editLines")}</button>
    </form>
  );
}

"use client";

import { useEffect } from "react";

/** <html lang> follows the app language (the root layout renders before the language is known). */
export function DocumentLang({ locale }: { locale: string }) {
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}

/**
 * Placeholder while a page loads. No text: the language comes from the
 * settings, read per request, and a Suspense fallback is prerendered — a
 * translated text here would be frozen in the build's language.
 */
export function PageLoading() {
  return (
    <div className="flex flex-col gap-3 p-6" aria-busy="true">
      <span className="h-6 w-48 animate-pulse rounded bg-raised" />
      <span className="h-4 w-80 max-w-full animate-pulse rounded bg-raised" />
    </div>
  );
}

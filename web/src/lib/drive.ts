/**
 * Extrai o ID de arquivo de um link do Google Drive. Aceita os formatos:
 *   https://drive.google.com/file/d/<ID>/view?usp=sharing
 *   https://drive.google.com/open?id=<ID>
 *   https://drive.google.com/uc?id=<ID>&export=download
 *   https://drive.usercontent.google.com/download?id=<ID>
 *   <ID> puro
 */
export function extrairIdDrive(link: string): string | null {
  const texto = link.trim();
  if (/^[\w-]{20,}$/.test(texto)) return texto;

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (!/(^|\.)google\.com$/.test(url.hostname)) return null;

  const porCaminho = url.pathname.match(/\/d\/([\w-]{20,})/);
  if (porCaminho) return porCaminho[1];

  const porQuery = url.searchParams.get("id");
  if (porQuery && /^[\w-]{20,}$/.test(porQuery)) return porQuery;

  return null;
}

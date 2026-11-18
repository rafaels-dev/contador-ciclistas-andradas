import { Archivo } from "next/font/google";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, LANGUAGE_KEY, LOCALES, type Locale, localePath } from "@/lib/site";
import "@/styles/site.css";

/** One grotesque for everything; the width axis lets heads run condensed. */
const archivo = Archivo({
  subsets: ["latin", "latin-ext"],
  axes: ["wdth"],
  variable: "--font-archivo",
  display: "swap",
});

/**
 * Runs before the first paint. Marks the page as scripted, sends a first-time
 * visitor on the English root to their own language (once, and never after they
 * pick one), and remembers the language picked in the menu.
 */
function bootScript(locale: Locale): string {
  const paths = Object.fromEntries(LOCALES.map((l) => [l.toLowerCase(), localePath(l)]));
  return `(function(){var d=document,K=${JSON.stringify(LANGUAGE_KEY)},P=${JSON.stringify(paths)};
d.documentElement.classList.add("js");
function get(){try{return localStorage.getItem(K)}catch(e){return null}}
function set(v){try{localStorage.setItem(K,v)}catch(e){}}
if(${JSON.stringify(locale === DEFAULT_LOCALE)}&&!get()){var ls=navigator.languages||[navigator.language||""];
for(var i=0;i<ls.length;i++){var l=String(ls[i]).toLowerCase(),k=P[l]?l:(l.slice(0,2)==="pt"?"pt-br":l.slice(0,2));
if(P[k]){if(k!=="en"){set(k);location.replace(P[k]+location.hash)}break}}}
d.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[data-language]");if(a)set(a.getAttribute("data-language"))});
d.addEventListener("click",function(e){d.querySelectorAll("details.lang[open]").forEach(function(m){if(!m.contains(e.target))m.removeAttribute("open")})});
d.addEventListener("keydown",function(e){if(e.key==="Escape")d.querySelectorAll("details.lang[open]").forEach(function(m){m.removeAttribute("open");var s=m.querySelector("summary");if(s)s.focus()})});
})();`;
}

/** Hallmark's slot script: lets a picture be swapped without touching the layout. */
const SLOTS = `window.hallmarkSlots=(m)=>{for(const [k,v] of Object.entries(m)){const s=document.querySelector('[data-slot="'+k+'"]');if(!s)continue;const im=new Image();im.src=typeof v==='string'?v:v.src;im.alt=(typeof v==='object'&&v.alt)||s.dataset.alt||'';s.querySelectorAll(':scope > img').forEach((o)=>o.remove());s.prepend(im)}};
document.querySelectorAll('[data-slot] img').forEach((i)=>{if(i.complete&&!i.naturalWidth)i.remove();else i.addEventListener('error',()=>i.remove(),{once:true})});`;

export function Document({ locale, children }: { locale: Locale; children: ReactNode }) {
  return (
    <html lang={locale} className={archivo.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript(locale) }} />
      </head>
      <body>
        {children}
        <script dangerouslySetInnerHTML={{ __html: SLOTS }} />
      </body>
    </html>
  );
}

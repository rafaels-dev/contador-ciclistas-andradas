#!/usr/bin/env python3
"""
Generates the labeling app (single index.html file + clips/ folder) in
evaluation/mining/webapp/. No server: Cristiano opens index.html in the
browser, labels with the keyboard (or by clicking) and exports
rotulos_andradas.json.

Interface: looping clip player + collapsible "playlist" sidebar with every
clip (navigable, with its own scrollbar and a ✔ status).

The page itself stays in Brazilian Portuguese: it is used by Cristiano, a
Portuguese speaker. Its exported file (rotulos_andradas.json, the
localStorage key and the label values bicicleta/moto/pedestre/carro/nada/
naosei) is also kept in Portuguese, because import_labels.py and
build_llm_calibration.py read the file he already sent back.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import legacy

ROOT = Path(__file__).resolve().parent
MINING = legacy.mining_dir(ROOT)
# shown to the labeler (pt-BR): A = motion without a count, B = fast
# pedestrian (night), C = possible bicycle (low confidence)
SOURCE_DESC = {
    "A": "movimento sem contagem",
    "B": "pedestre rápido (noite)",
    "C": "possível bicicleta (baixa confiança)",
}

HTML = """<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Rotulagem — Contador Andradas</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
 *{box-sizing:border-box}
 body{font-family:system-ui,sans-serif;background:#111;color:#eee;margin:0;
      display:flex;flex-direction:column;height:100vh;overflow:hidden}
 header{background:#1b2733;padding:10px 16px;display:flex;
        justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
 h1{font-size:16px;margin:0;white-space:nowrap}
 #prog{font-size:14px;color:#8fd}
 #togpl{background:#243b53;color:#fff;border:none;border-radius:8px;
        padding:8px 12px;cursor:pointer;font-size:14px}
 #layout{display:flex;flex:1;min-height:0}
 /* ---- playlist sidebar ---- */
 #sidebar{width:250px;min-width:250px;background:#161d24;border-right:1px solid #2a3642;
          overflow-y:auto;overscroll-behavior:contain;padding:6px}
 #sidebar.hidden{display:none}
 #sidebar::-webkit-scrollbar{width:10px}
 #sidebar::-webkit-scrollbar-thumb{background:#33475a;border-radius:5px}
 .pl-item{padding:7px 9px;border-radius:7px;cursor:pointer;font-size:12.5px;
          display:flex;justify-content:space-between;align-items:center;gap:6px;
          color:#cdd6df;margin-bottom:2px}
 .pl-item:hover{background:#21303f}
 .pl-item.active{background:#0b57d0;color:#fff}
 .pl-badge{font-size:11px;padding:1px 7px;border-radius:9px;background:#333;
           white-space:nowrap}
 .lb-bicicleta{background:#188038}.lb-moto{background:#b3560f}
 .lb-pedestre{background:#8a6d00}.lb-carro{background:#555}
 .lb-nada{background:#333}.lb-naosei{background:#6a1b9a}
 /* ---- content ---- */
 main{flex:1;overflow-y:auto;padding:12px;max-width:980px;margin:0 auto;width:100%}
 video,img{width:100%;border-radius:8px;background:#000}
 #key{margin-top:6px;display:none}
 .meta{font-size:13px;color:#aaa;margin:6px 0}
 .buttons{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
 button{font-size:15px;padding:12px 14px;border:none;border-radius:8px;
        cursor:pointer;color:#fff;flex:1;min-width:110px}
 .b1{background:#188038}.b2{background:#b3560f}.b3{background:#8a6d00}
 .b4{background:#555}.b5{background:#333}.b0{background:#6a1b9a}
 .nav{background:#243b53;min-width:60px;flex:0}
 #export{background:#0b57d0;width:100%;padding:14px;font-size:16px}
 kbd{background:#333;border-radius:4px;padding:1px 6px;font-size:12px}
 footer{font-size:12px;color:#777;padding:8px;text-align:center}
 @media (max-width:760px){#sidebar{position:absolute;z-index:5;height:100%;
   box-shadow:4px 0 14px #000c}}
</style></head><body>
<header>
 <button id="togpl" title="mostrar/ocultar playlist">☰ Playlist</button>
 <h1>🚲 Rotulagem Andradas</h1><div id="prog"></div>
</header>
<div id="layout">
 <nav id="sidebar"></nav>
 <main>
  <div class="meta" id="meta"></div>
  <video id="clip" autoplay muted loop playsinline></video>
  <img id="key" alt="keyframe">
  <div class="meta" id="sugbox" style="display:none">🤖 Sugestão da IA:
    <b id="sugtxt"></b> — <kbd>Enter</kbd> confirma, ou corrija com os botões.</div>
  <div class="meta">O que está passando perto da <b>linha vermelha</b> neste clipe?
    (<a href="#" id="togkey" style="color:#8fd">alternar clipe/foto</a> — tecla <kbd>F</kbd>)</div>
  <div class="buttons">
   <button class="b1" data-l="bicicleta"><kbd>1</kbd> Bicicleta</button>
   <button class="b2" data-l="moto"><kbd>2</kbd> Moto</button>
   <button class="b3" data-l="pedestre"><kbd>3</kbd> Pedestre</button>
   <button class="b4" data-l="carro"><kbd>4</kbd> Carro</button>
   <button class="b5" data-l="nada"><kbd>5</kbd> Nada/outro</button>
   <button class="b0" data-l="naosei"><kbd>0</kbd> Não sei</button>
  </div>
  <div class="buttons">
   <button class="nav" id="prev">◀</button>
   <button class="nav" id="next">▶</button>
   <button id="export">⬇ Exportar rótulos (envie o arquivo de volta)</button>
  </div>
  <footer>Rotule na ordem; o app avança sozinho. O progresso fica salvo neste
  navegador. Ao final, clique em Exportar e envie o arquivo
  <b>rotulos_andradas.json</b> de volta.</footer>
 </main>
</div>
<script>
const CANDS = __CANDS__;
// label values and storage keys stay in Portuguese (format of the exported file)
const LABEL_TXT = {bicicleta:'🚲 bici', moto:'🏍 moto', pedestre:'🚶 ped',
                   carro:'🚗 carro', nada:'∅ nada', naosei:'? n. sei'};
const SUG_TXT = {bicicleta:'🚲 Bicicleta', moto:'🏍 Moto', pedestre:'🚶 Pedestre',
                 carro:'🚗 Carro', nada:'∅ Nada', duvida:'? Dúvida'};
const STORE_KEY = 'rotulos_andradas', HIDDEN_KEY = 'pl_oculta';
let i = 0;
let labels = JSON.parse(localStorage.getItem(STORE_KEY)||'{}');
const clip=document.getElementById('clip'), key=document.getElementById('key');
const sidebar=document.getElementById('sidebar');
function save(){localStorage.setItem(STORE_KEY,JSON.stringify(labels));}

/* ---- playlist ---- */
function buildPlaylist(){
 sidebar.innerHTML='';
 CANDS.forEach((c,idx)=>{
  const d=document.createElement('div');
  d.className='pl-item'; d.id='pl-'+idx;
  d.innerHTML=`<span>#${idx+1} · h${c.hour} · ${Math.floor(c.time_s/60)}m${String(Math.round(c.time_s%60)).padStart(2,'0')}s</span>
               <span class="pl-badge" id="plb-${idx}"></span>`;
  d.onclick=()=>{i=idx;render();};
  sidebar.appendChild(d);
 });
}
function updatePlaylist(){
 CANDS.forEach((c,idx)=>{
  const d=document.getElementById('pl-'+idx);
  d.classList.toggle('active', idx===i);
  const b=document.getElementById('plb-'+idx);
  const l=labels[c.id];
  if(l){ b.textContent=LABEL_TXT[l]||l; b.className='pl-badge lb-'+l; b.style.opacity=1; }
  else if(c.sug && c.sug!=='duvida'){ b.textContent='ia: '+(LABEL_TXT[c.sug]||c.sug);
    b.className='pl-badge lb-'+c.sug; b.style.opacity=0.45; }
  else { b.textContent='·'; b.className='pl-badge'; b.style.opacity=1; }
 });
 const current=document.getElementById('pl-'+i);
 if(current && !sidebar.classList.contains('hidden'))
   current.scrollIntoView({block:'nearest'});
}

function render(){
 const c=CANDS[i];
 clip.src='clips/'+c.id+'.mp4'; key.src='clips/'+c.id+'.jpg';
 clip.style.display='block'; key.style.display='none';
 document.getElementById('meta').textContent =
   `#${i+1}/${CANDS.length} — hora ${c.hour}, t=${c.time_s}s — pista: ${c.source_desc}` +
   (labels[c.id]?`  ✔ rotulado: ${labels[c.id]}`:'');
 const sb=document.getElementById('sugbox');
 if(c.sug && c.sug!=='duvida' && !labels[c.id]){
   sb.style.display='block';
   document.getElementById('sugtxt').textContent=SUG_TXT[c.sug]||c.sug;
 } else sb.style.display='none';
 const n=Object.keys(labels).length;
 document.getElementById('prog').textContent=`${n}/${CANDS.length} rotulados`;
 updatePlaylist();
}
function mark(l){labels[CANDS[i].id]=l;save();if(i<CANDS.length-1){i++;}render();}
function next(){if(i<CANDS.length-1)i++;render();}
function prev(){if(i>0)i--;render();}
function togkey(){const v=clip.style.display!=='none';
 clip.style.display=v?'none':'block';key.style.display=v?'block':'none';}
document.querySelectorAll('button[data-l]').forEach(b=>
 b.addEventListener('click',()=>mark(b.dataset.l)));
document.getElementById('next').onclick=next;
document.getElementById('prev').onclick=prev;
document.getElementById('togkey').onclick=e=>{e.preventDefault();togkey();};
document.getElementById('togpl').onclick=()=>{
 sidebar.classList.toggle('hidden');
 localStorage.setItem(HIDDEN_KEY, sidebar.classList.contains('hidden')?'1':'0');
 if(!sidebar.classList.contains('hidden')) updatePlaylist();
};
document.getElementById('export').onclick=()=>{
 const blob=new Blob([JSON.stringify({rotulos:labels,total:CANDS.length,
   quando:new Date().toISOString()},null,1)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);
 a.download='rotulos_andradas.json';a.click();};
document.addEventListener('keydown',e=>{
 const m={'1':'bicicleta','2':'moto','3':'pedestre','4':'carro','5':'nada','0':'naosei'};
 if(m[e.key])mark(m[e.key]);
 else if(e.key==='Enter'){const s=CANDS[i].sug;
   if(s && s!=='duvida' && !labels[CANDS[i].id]) mark(s); else next();}
 else if(e.key==='ArrowRight')next();
 else if(e.key==='ArrowLeft')prev();
 else if(e.key==='f'||e.key==='F')togkey();
});
buildPlaylist();
if(localStorage.getItem(HIDDEN_KEY)==='1') sidebar.classList.add('hidden');
// resume from the first unlabeled one
while(i<CANDS.length-1 && labels[CANDS[i].id]) i++;
render();
</script></body></html>
"""

# instructions for the labeler (pt-BR, shipped with the app)
README_PT = (
    "Rotulagem do contador de bicicletas — Andradas\n\n"
    "1. Descompacte esta pasta inteira.\n"
    "2. Abra o arquivo index.html em qualquer navegador (Chrome/Edge/Firefox).\n"
    "3. Para cada clipe, aperte a tecla do que você vê perto da linha vermelha:\n"
    "   1 = Bicicleta   2 = Moto   3 = Pedestre   4 = Carro   5 = Nada   0 = Não sei\n"
    "   (F alterna entre o clipe e a foto ampliada; setas navegam;\n"
    "    botão ☰ Playlist mostra/oculta a lista de clipes para pular direto.)\n"
    "4. O progresso fica salvo no navegador — pode parar e continuar depois.\n"
    "5. No final, clique em 'Exportar rótulos' e envie o arquivo\n"
    "   rotulos_andradas.json de volta para o Rafael.\n")


def main():
    cands = legacy.load_mined_candidates(MINING)
    # suggestions.json: {candidate id: label in the app's vocabulary (bicicleta, ..., duvida)}
    sug_path = legacy.first_existing(MINING / "suggestions.json", MINING / "sugestoes.json")
    suggestions = (json.loads(sug_path.read_text(encoding="utf-8"))
                   if sug_path.exists() else {})
    web = []
    for c in cands:
        web.append({"id": c["id"], "hour": c["hour"], "time_s": c["time_s"],
                    "source_desc": SOURCE_DESC[c["source"]],
                    "sug": suggestions.get(c["id"])})
    out = MINING / "webapp"
    out.mkdir(parents=True, exist_ok=True)
    (out / "index.html").write_text(
        HTML.replace("__CANDS__", json.dumps(web, ensure_ascii=False)), encoding="utf-8")
    (out / "LEIA-ME.txt").write_text(README_PT, encoding="utf-8")
    print(f"webapp: {out/'index.html'} ({len(web)} candidates)")


if __name__ == "__main__":
    main()

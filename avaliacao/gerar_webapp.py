#!/usr/bin/env python3
"""
Gera o app de rotulagem (arquivo único index.html + pasta clipes/) em
avaliacao/mineracao/webapp/. Sem servidor: o Cristiano abre o index.html
no navegador, rotula com o teclado (ou clicando) e exporta rotulos.json.

Interface: player de clipe em loop + sidebar "playlist" recolhível com
todos os clipes (navegável, com barra de rolagem própria e status ✔).
"""
import json
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
FONTE_DESC = {
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
 /* ---- sidebar playlist ---- */
 #sidebar{width:250px;min-width:250px;background:#161d24;border-right:1px solid #2a3642;
          overflow-y:auto;overscroll-behavior:contain;padding:6px}
 #sidebar.oculta{display:none}
 #sidebar::-webkit-scrollbar{width:10px}
 #sidebar::-webkit-scrollbar-thumb{background:#33475a;border-radius:5px}
 .pl-item{padding:7px 9px;border-radius:7px;cursor:pointer;font-size:12.5px;
          display:flex;justify-content:space-between;align-items:center;gap:6px;
          color:#cdd6df;margin-bottom:2px}
 .pl-item:hover{background:#21303f}
 .pl-item.ativo{background:#0b57d0;color:#fff}
 .pl-badge{font-size:11px;padding:1px 7px;border-radius:9px;background:#333;
           white-space:nowrap}
 .lb-bicicleta{background:#188038}.lb-moto{background:#b3560f}
 .lb-pedestre{background:#8a6d00}.lb-carro{background:#555}
 .lb-nada{background:#333}.lb-naosei{background:#6a1b9a}
 /* ---- conteúdo ---- */
 main{flex:1;overflow-y:auto;padding:12px;max-width:980px;margin:0 auto;width:100%}
 video,img{width:100%;border-radius:8px;background:#000}
 #key{margin-top:6px;display:none}
 .meta{font-size:13px;color:#aaa;margin:6px 0}
 .botoes{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
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
  <div class="botoes">
   <button class="b1" data-l="bicicleta"><kbd>1</kbd> Bicicleta</button>
   <button class="b2" data-l="moto"><kbd>2</kbd> Moto</button>
   <button class="b3" data-l="pedestre"><kbd>3</kbd> Pedestre</button>
   <button class="b4" data-l="carro"><kbd>4</kbd> Carro</button>
   <button class="b5" data-l="nada"><kbd>5</kbd> Nada/outro</button>
   <button class="b0" data-l="naosei"><kbd>0</kbd> Não sei</button>
  </div>
  <div class="botoes">
   <button class="nav" id="ant">◀</button>
   <button class="nav" id="prox">▶</button>
   <button id="export">⬇ Exportar rótulos (envie o arquivo de volta)</button>
  </div>
  <footer>Rotule na ordem; o app avança sozinho. O progresso fica salvo neste
  navegador. Ao final, clique em Exportar e envie o arquivo
  <b>rotulos_andradas.json</b> de volta.</footer>
 </main>
</div>
<script>
const CANDS = __CANDS__;
const ROTULO_TXT = {bicicleta:'🚲 bici', moto:'🏍 moto', pedestre:'🚶 ped',
                    carro:'🚗 carro', nada:'∅ nada', naosei:'? n. sei'};
const SUG_TXT = {bicicleta:'🚲 Bicicleta', moto:'🏍 Moto', pedestre:'🚶 Pedestre',
                 carro:'🚗 Carro', nada:'∅ Nada', duvida:'? Dúvida'};
let i = 0;
let rot = JSON.parse(localStorage.getItem('rotulos_andradas')||'{}');
const clip=document.getElementById('clip'), key=document.getElementById('key');
const sidebar=document.getElementById('sidebar');
function salvar(){localStorage.setItem('rotulos_andradas',JSON.stringify(rot));}

/* ---- playlist ---- */
function montarPlaylist(){
 sidebar.innerHTML='';
 CANDS.forEach((c,idx)=>{
  const d=document.createElement('div');
  d.className='pl-item'; d.id='pl-'+idx;
  d.innerHTML=`<span>#${idx+1} · h${c.hora} · ${Math.floor(c.tempo_s/60)}m${String(Math.round(c.tempo_s%60)).padStart(2,'0')}s</span>
               <span class="pl-badge" id="plb-${idx}"></span>`;
  d.onclick=()=>{i=idx;render();};
  sidebar.appendChild(d);
 });
}
function atualizarPlaylist(){
 CANDS.forEach((c,idx)=>{
  const d=document.getElementById('pl-'+idx);
  d.classList.toggle('ativo', idx===i);
  const b=document.getElementById('plb-'+idx);
  const l=rot[c.id];
  if(l){ b.textContent=ROTULO_TXT[l]||l; b.className='pl-badge lb-'+l; b.style.opacity=1; }
  else if(c.sug && c.sug!=='duvida'){ b.textContent='ia: '+(ROTULO_TXT[c.sug]||c.sug);
    b.className='pl-badge lb-'+c.sug; b.style.opacity=0.45; }
  else { b.textContent='·'; b.className='pl-badge'; b.style.opacity=1; }
 });
 const atual=document.getElementById('pl-'+i);
 if(atual && !sidebar.classList.contains('oculta'))
   atual.scrollIntoView({block:'nearest'});
}

function render(){
 const c=CANDS[i];
 clip.src='clipes/'+c.id+'.mp4'; key.src='clipes/'+c.id+'.jpg';
 clip.style.display='block'; key.style.display='none';
 document.getElementById('meta').textContent =
   `#${i+1}/${CANDS.length} — hora ${c.hora}, t=${c.tempo_s}s — pista: ${c.fonte_desc}` +
   (rot[c.id]?`  ✔ rotulado: ${rot[c.id]}`:'');
 const sb=document.getElementById('sugbox');
 if(c.sug && c.sug!=='duvida' && !rot[c.id]){
   sb.style.display='block';
   document.getElementById('sugtxt').textContent=SUG_TXT[c.sug]||c.sug;
 } else sb.style.display='none';
 const n=Object.keys(rot).length;
 document.getElementById('prog').textContent=`${n}/${CANDS.length} rotulados`;
 atualizarPlaylist();
}
function marcar(l){rot[CANDS[i].id]=l;salvar();if(i<CANDS.length-1){i++;}render();}
function prox(){if(i<CANDS.length-1)i++;render();}
function ant(){if(i>0)i--;render();}
function togkey(){const v=clip.style.display!=='none';
 clip.style.display=v?'none':'block';key.style.display=v?'block':'none';}
document.querySelectorAll('button[data-l]').forEach(b=>
 b.addEventListener('click',()=>marcar(b.dataset.l)));
document.getElementById('prox').onclick=prox;
document.getElementById('ant').onclick=ant;
document.getElementById('togkey').onclick=e=>{e.preventDefault();togkey();};
document.getElementById('togpl').onclick=()=>{
 sidebar.classList.toggle('oculta');
 localStorage.setItem('pl_oculta', sidebar.classList.contains('oculta')?'1':'0');
 if(!sidebar.classList.contains('oculta')) atualizarPlaylist();
};
document.getElementById('export').onclick=()=>{
 const blob=new Blob([JSON.stringify({rotulos:rot,total:CANDS.length,
   quando:new Date().toISOString()},null,1)],{type:'application/json'});
 const a=document.createElement('a');a.href=URL.createObjectURL(blob);
 a.download='rotulos_andradas.json';a.click();};
document.addEventListener('keydown',e=>{
 const m={'1':'bicicleta','2':'moto','3':'pedestre','4':'carro','5':'nada','0':'naosei'};
 if(m[e.key])marcar(m[e.key]);
 else if(e.key==='Enter'){const s=CANDS[i].sug;
   if(s && s!=='duvida' && !rot[CANDS[i].id]) marcar(s); else prox();}
 else if(e.key==='ArrowRight')prox();
 else if(e.key==='ArrowLeft')ant();
 else if(e.key==='f'||e.key==='F')togkey();
});
montarPlaylist();
if(localStorage.getItem('pl_oculta')==='1') sidebar.classList.add('oculta');
// retoma do primeiro não rotulado
while(i<CANDS.length-1 && rot[CANDS[i].id]) i++;
render();
</script></body></html>
"""


def main():
    cands = json.loads((RAIZ / "mineracao/candidatos.json").read_text())
    sug_path = RAIZ / "mineracao/sugestoes.json"
    sugestoes = (json.loads(sug_path.read_text()) if sug_path.exists() else {})
    web = []
    for c in cands:
        web.append({"id": c["id"], "hora": c["hora"], "tempo_s": c["tempo_s"],
                    "fonte_desc": FONTE_DESC[c["fonte"]],
                    "sug": sugestoes.get(c["id"])})
    out = RAIZ / "mineracao/webapp"
    out.mkdir(parents=True, exist_ok=True)
    (out / "index.html").write_text(
        HTML.replace("__CANDS__", json.dumps(web, ensure_ascii=False)))
    (out / "LEIA-ME.txt").write_text(
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
    print(f"webapp: {out/'index.html'} ({len(web)} candidatos)")


if __name__ == "__main__":
    main()

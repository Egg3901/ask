// Public Ask page, rendered from the SAME design system the ops Ask uses:
// design-system TOKENS_CSS + ops-shell BASE_CSS + the ask-page component styles.
// Deliberately NOT the ops shell — no sidebar, no nav, no staff chrome. Just the
// conversation column, so it reads as a product rather than a tool with the
// dashboard bolted on.
const OPS = "/root/projects/LSGD-ops-dash";
const { TOKENS_CSS } = require(`${OPS}/design-system`);
const { icon, THEME_HEAD } = require(`${OPS}/ui-kit`);
const starterQuestions = require("./starters");
const changelog = require("./changelog");
const modelRouter = require("./router");
const models = require("./models");
const auth = require("./auth");
const cites = require("./citations");
const gameRegistry = require("./games");

// Inline jargon annotation: underline terms that have a doc/wiki page, show a
// blurb on hover/tap, link to the source. The glossary is the same doc/wiki
// index the citations use, so every link resolves.
const glossaryJson = () => { try { return JSON.stringify(cites.glossary()).replace(/</g, "\\u003c"); } catch { return "[]"; } };

// The game's own mark (Liberty Bell), served from /ahd-logo.png. Used wherever
// the page identifies itself: header brand, landing, gates, shared pages.
// The switcher's marks come from the docs build, which already applies the
// Lakeside-mark fallback for a game with no logo of its own.
const mark = (size, gameId = "ahd") =>
  `<img class="brandmark" id="brand-mark" src="${gameId === "ahd" ? "/ahd-logo.png" : `/game-logo/${gameId}.png`}" alt="" width="${size}" height="${size}">`;
const jargonScripts = () => `<script>window.__JARGON=${glossaryJson()};</script><script>${JARGON_JS}</script>`;

// Self-contained rich renderer for the static shared/report pages: the same
// tables/headings/callouts/lists/code plus Mermaid diagrams and AHD maps the
// live app renders, so a shared link looks identical to the real answer.
const SHARED_RENDER_JS = `(function(){
function esc(s){var d=document.createElement('div');d.textContent=s==null?'':s;return d.innerHTML;}
function inl(s){return s
  .replace(/\`([^\`]+)\`/g,'<code>$1</code>')
  .replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')
  .replace(/(^|[^*])\\*([^*\\n]+)\\*(?!\\*)/g,'$1<em>$2</em>')
  .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');}
function tbl(block){var lines=block.split('\\n').filter(function(l){return l.trim();});
  if(lines.length<2||!/\\|/.test(lines[0])||!/^\\s*\\|?[\\s:|-]+$/.test(lines[1]))return null;
  var cx=function(l){return l.replace(/^\\s*\\||\\|\\s*$/g,'').split('|').map(function(c){return c.trim();});};
  var h=cx(lines[0]),r=lines.slice(2).filter(function(l){return /\\|/.test(l);}).map(cx);
  return '<div class="tbl-wrap"><table class="md-table"><thead><tr>'+h.map(function(x){return '<th>'+inl(x)+'</th>';}).join('')+'</tr></thead><tbody>'+r.map(function(row){return '<tr>'+row.map(function(c){return '<td>'+inl(c)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>';}
function md(t){t=esc(t||'');var parts=t.split(/\`\`\`/),o='';
  for(var i=0;i<parts.length;i++){
    if(i%2===1){var seg=parts[i],nl=seg.indexOf('\\n'),lang=nl>0?seg.slice(0,nl).trim().toLowerCase():'',code=nl>0?seg.slice(nl+1):seg;
      if(lang==='mermaid'||lang==='mmd')o+='<pre class="mermaid-source">'+code+'</pre>';
      else if(lang==='ahd-map')o+='<pre class="map-source">'+code+'</pre>';
      else o+='<div class="codeblock"><pre><code>'+code+'</code></pre></div>';
    }else{
      o+=parts[i].split(/\\n{2,}/).map(function(block){
        var b=block.replace(/^\\n+|\\n+$/g,'');if(!b.trim())return '';
        var tb=tbl(b);if(tb)return tb;
        if(/^\\s*(?:---+|\\*\\*\\*+|___+)\\s*$/.test(b))return '<hr>';
        if(/^\\s*&gt;/.test(b))return '<blockquote>'+inl(b.replace(/^\\s*&gt;\\s?/gm,'')).replace(/\\n/g,'<br>')+'</blockquote>';
        var s=inl(b)
          .replace(/^\\s*#### (.+)$/gm,'<h4>$1</h4>').replace(/^\\s*### (.+)$/gm,'<h3>$1</h3>')
          .replace(/^\\s*## (.+)$/gm,'<h2>$1</h2>').replace(/^\\s*# (.+)$/gm,'<h2>$1</h2>')
          .replace(/^\\s*\\d+[.)] (.+)$/gm,'<oli>$1</oli>').replace(/^\\s*[-*] (.+)$/gm,'<uli>$1</uli>');
        s=s.replace(/(<oli>[\\s\\S]*?<\\/oli>)(?!\\n?<oli>)/g,function(m){return '<ol>'+m.split('\\n').join('')+'</ol>';}).replace(/oli>/g,'li>');
        s=s.replace(/(<uli>[\\s\\S]*?<\\/uli>)(?!\\n?<uli>)/g,function(m){return '<ul>'+m.split('\\n').join('')+'</ul>';}).replace(/uli>/g,'li>');
        return /^<(h[1-6]|ul|ol|blockquote|hr|div|table)/.test(s.trim())?s:'<p>'+s.replace(/\\n/g,'<br>')+'</p>';}).join('');
    }}
  return o;}
function fit(svg){requestAnimationFrame(function(){try{var vb=svg.viewBox&&svg.viewBox.baseVal,box=svg.getBBox();if(vb&&box&&box.width&&box.height){var pad=20;svg.setAttribute('viewBox',[Math.min(vb.x,box.x-pad),Math.min(vb.y,box.y-pad),Math.max(vb.width,box.width+2*pad),Math.max(vb.height,box.height+2*pad)].join(' '));}svg.removeAttribute('width');svg.removeAttribute('height');}catch(e){}});}
function mcfg(){var light=document.documentElement.getAttribute('data-theme')==='light';var v=light?{background:'#ffffff',primaryColor:'#f2f2f3',primaryTextColor:'#0a0a0a',primaryBorderColor:'#b0b0b0',lineColor:'#8a8a8a',mainBkg:'#f2f2f3',nodeBorder:'#b0b0b0',textColor:'#0a0a0a',fontFamily:'Inter, sans-serif'}:{background:'#000000',primaryColor:'#181818',primaryTextColor:'#fafafa',primaryBorderColor:'#5a5a5a',lineColor:'#8a8a8a',mainBkg:'#181818',nodeBorder:'#4a4a4a',textColor:'#e8e8e8',fontFamily:'Inter, sans-serif'};return{startOnLoad:false,securityLevel:'strict',theme:'base',themeVariables:v,xyChart:{plotColorPalette:light?'#111111,#666666,#999999,#444444,#bbbbbb':'#ffffff,#aaaaaa,#777777,#cccccc,#555555'}};}
function renderMermaid(root){var blocks=root.querySelectorAll('.mermaid-source');if(!blocks.length)return;var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';s.onload=function(){window.mermaid.initialize(mcfg());blocks.forEach(function(block,i){var src=block.textContent;var wrap=document.createElement('div');wrap.className='mermaid-wrap';block.replaceWith(wrap);window.mermaid.render('sh-mmd-'+Date.now()+'-'+i,src).then(function(r){wrap.innerHTML=r.svg;var svg=wrap.querySelector('svg');if(svg)fit(svg);}).catch(function(){wrap.innerHTML='<div class="mermaid-err">This visualization could not be rendered.</div>';});});};document.head.appendChild(s);}
function renderMaps(root){root.querySelectorAll('.map-source').forEach(function(block){var src=block.textContent;var wrap=document.createElement('div');wrap.className='map-wrap';block.replaceWith(wrap);var spec;try{spec=JSON.parse(src);}catch(e){wrap.innerHTML='<div class="mermaid-err">This map could not be rendered.</div>';return;}fetch('/api/map/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(spec)}).then(function(r){if(!r.ok)throw new Error();return r.text();}).then(function(svg){wrap.innerHTML=svg;var s2=wrap.querySelector('svg');if(s2)fit(s2);}).catch(function(){wrap.innerHTML='<div class="mermaid-err">This map could not be rendered.</div>';});});}
window.__hydrateShared=function(){document.querySelectorAll('[data-md]').forEach(function(el){el.innerHTML=md(el.textContent||'');renderMermaid(el);renderMaps(el);if(window.annotateJargon)try{window.annotateJargon(el);}catch(e){}});};
})();`;
const sharedScripts = () => jargonScripts() + `<script>${SHARED_RENDER_JS}</script>`;
const JARGON_JS = String.raw`(function(){
var G=window.__JARGON||[];if(!G.length)return;
var byKey={},terms=[];
G.forEach(function(e){var k=e.term.toLowerCase();if(!byKey[k]){byKey[k]=e;terms.push(e.term);}});
terms.sort(function(a,b){return b.length-a.length;});
function esc(s){return s.replace(/[.*+?^(){}|[\]\\$]/g,'\\$&');}
var SRC='\\b('+terms.map(esc).join('|')+')\\b';
var pop,hideT;
function schedHide(){clearTimeout(hideT);hideT=setTimeout(function(){if(pop&&!pop._over)pop.hidden=true;},150);}
function ensurePop(){if(pop)return pop;pop=document.createElement('div');pop.className='jargon-pop';pop.hidden=true;document.body.appendChild(pop);
pop.addEventListener('mouseenter',function(){clearTimeout(hideT);pop._over=true;});
pop.addEventListener('mouseleave',function(){pop._over=false;schedHide();});
document.addEventListener('click',function(ev){if(pop&&!pop.hidden&&!pop.contains(ev.target)&&!(ev.target.classList&&ev.target.classList.contains('jargon')))pop.hidden=true;});
return pop;}
function showPop(el){var e=byKey[el.getAttribute('data-term')];if(!e)return;ensurePop();
pop.innerHTML='<div class="jp-term"></div><div class="jp-blurb"></div><a class="jp-link" target="_blank" rel="noopener">Read more →</a>';
pop.querySelector('.jp-term').textContent=e.term;pop.querySelector('.jp-blurb').textContent=e.blurb;pop.querySelector('.jp-link').href=e.url;
pop.hidden=false;var r=el.getBoundingClientRect(),vw=document.documentElement.clientWidth;
pop.style.top=(r.bottom+8+window.scrollY)+'px';pop.style.left=Math.max(8,Math.min(r.left+window.scrollX,vw+window.scrollX-312))+'px';}
function bind(el){el.addEventListener('mouseenter',function(){clearTimeout(hideT);showPop(el);});
el.addEventListener('mouseleave',schedHide);el.addEventListener('focus',function(){showPop(el);});
el.addEventListener('blur',function(){if(pop)pop.hidden=true;});
el.addEventListener('click',function(ev){ev.preventDefault();showPop(el);});}
window.annotateJargon=function(root){if(!root)return;var RE=new RegExp(SRC,'gi'),used={},count=0,CAP=14;
var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:function(n){if(!n.nodeValue||!n.nodeValue.trim())return NodeFilter.FILTER_REJECT;
var p=n.parentNode;while(p&&p!==root){var t=p.nodeName;if(t==='CODE'||t==='PRE'||t==='A'||t==='SCRIPT'||t==='STYLE'||t==='H1'||(p.classList&&p.classList.contains('jargon')))return NodeFilter.FILTER_REJECT;p=p.parentNode;}
return NodeFilter.FILTER_ACCEPT;}});
var nodes=[],nn;while((nn=w.nextNode()))nodes.push(nn);
nodes.forEach(function(node){if(count>=CAP)return;var text=node.nodeValue,out=[],last=0,m;RE.lastIndex=0;
while((m=RE.exec(text))){if(count>=CAP)break;var term=m[0],key=term.toLowerCase();if(used[key])continue;used[key]=true;count++;
if(m.index>last)out.push(document.createTextNode(text.slice(last,m.index)));
var s=document.createElement('span');s.className='jargon';s.tabIndex=0;s.setAttribute('data-term',key);s.textContent=term;bind(s);out.push(s);last=m.index+term.length;}
if(out.length){if(last<text.length)out.push(document.createTextNode(text.slice(last)));var frag=document.createDocumentFragment();out.forEach(function(x){frag.appendChild(x);});node.parentNode.replaceChild(frag,node);}});};
})();`;

// Gate copy is generated from the real tier table. It was hand-written before,
// and went stale the moment the budgets changed.
function tierRows() {
  const player = auth.PLAYER;
  return [
    `<div class="gate-tier"><b>Every player</b> ${player.questions} questions a day · ${player.mcp} with live game data</div>`,
    ...Object.values(auth.TIERS)
      .sort((a, b) => a.questions - b.questions)
      .map(t => `<div class="gate-tier"><b>${t.label}</b> ${t.questions} a day · ${t.mcp} with live data · charts and maps</div>`),
  ].join("\n      ");
}

// Ask is deliberately monochrome even though it reuses the ops token names.
// Status colours still carry meaning, but product chrome is white on OLED black
// or black on white.
const ASK_THEME_CSS = `
:root{
  --bg-0:#000;--bg-1:#050505;--surface:#090909;--surface-2:#101010;--surface-3:#171717;
  --glass-1:rgba(255,255,255,.018);--glass-2:rgba(255,255,255,.045);--glass-3:rgba(255,255,255,.075);
  --glass-hover:rgba(255,255,255,.09);--border:rgba(255,255,255,.1);--border-2:rgba(255,255,255,.22);
  --text:#fff;--text-2:rgba(255,255,255,.66);--text-3:rgba(255,255,255,.4);
  --accent:#fff;--accent-2:#fff;--accent-soft:rgba(255,255,255,.1);--accent-hover:#e8e8e8;--on-accent:#000;
  --field-bg:#090909;--info:#fff;--info-soft:rgba(255,255,255,.1);
  --e1:0 1px 2px rgba(0,0,0,.7);--e2:0 16px 44px rgba(0,0,0,.45);--e3:0 28px 80px rgba(0,0,0,.7);
  --hi:inset 0 1px 0 rgba(255,255,255,.055);--ring:0 0 0 3px rgba(255,255,255,.2);
  --scroll:rgba(255,255,255,.16);--scroll-h:rgba(255,255,255,.3);
  --glow-1:rgba(255,255,255,.055);--glow-2:rgba(255,255,255,.025);
  --edge:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.045));
  --edge-focus:linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,.14));
  --send-grad:linear-gradient(180deg,#fff,#d7d7d7);
  --send-hi:inset 0 1px 0 rgba(255,255,255,.95),inset 0 -1px 0 rgba(0,0,0,.14)
}
:root[data-theme="light"]{
  --bg-0:#fff;--bg-1:#fafafa;--surface:#fff;--surface-2:#f5f5f5;--surface-3:#ececec;
  --glass-1:rgba(0,0,0,.012);--glass-2:rgba(0,0,0,.035);--glass-3:rgba(0,0,0,.065);
  --glass-hover:rgba(0,0,0,.055);--border:rgba(0,0,0,.1);--border-2:rgba(0,0,0,.22);
  --text:#050505;--text-2:rgba(0,0,0,.66);--text-3:rgba(0,0,0,.42);
  --accent:#050505;--accent-2:#050505;--accent-soft:rgba(0,0,0,.075);--accent-hover:#222;--on-accent:#fff;
  --field-bg:#fff;--info:#050505;--info-soft:rgba(0,0,0,.075);
  --e1:0 1px 2px rgba(0,0,0,.08);--e2:0 16px 44px rgba(0,0,0,.1);--e3:0 28px 80px rgba(0,0,0,.14);
  --hi:inset 0 1px 0 rgba(255,255,255,.65);--ring:0 0 0 3px rgba(0,0,0,.14);--scroll:rgba(0,0,0,.16);--scroll-h:rgba(0,0,0,.3);
  --glow-1:rgba(0,0,0,.035);--glow-2:rgba(0,0,0,.018);
  --edge:linear-gradient(180deg,rgba(0,0,0,.17),rgba(0,0,0,.06));
  --edge-focus:linear-gradient(180deg,rgba(0,0,0,.45),rgba(0,0,0,.16));
  --send-grad:linear-gradient(180deg,#3d3d3d,#050505);
  --send-hi:inset 0 1px 0 rgba(255,255,255,.28),inset 0 -1px 0 rgba(0,0,0,.5)
}`;

// Component CSS lifted from ask-page.js so the answer body, code blocks and
// chips render identically to the staff surface.
const ASK_CSS = `
html,body{height:100%}
body{background:var(--bg-0);color:var(--text);height:100dvh;overflow:hidden}
.ask-shell{display:flex;flex-direction:column;height:100dvh;min-height:0;min-width:0;overflow:hidden}
.ask-head{flex:0 0 auto;z-index:20;display:flex;align-items:center;gap:var(--s-3);
  padding:14px clamp(16px,4vw,24px);border-bottom:1px solid var(--border);
  background:color-mix(in srgb,var(--bg-0) 82%,transparent);backdrop-filter:var(--blur);-webkit-backdrop-filter:var(--blur)}
.ask-brand{display:flex;align-items:center;gap:9px;font-weight:700;letter-spacing:-.02em;font-size:1rem}
.brandmark{display:block;flex-shrink:0}
.gate-card .brandmark{margin:0 auto 16px}
.ask-brand em{font-style:normal;color:var(--text-3);font-weight:500}
.gamesw{position:relative;display:inline-flex}
.gamesw>button{display:inline-flex;align-items:center;gap:5px;background:none;border:0;padding:2px 4px;border-radius:7px;
  cursor:pointer;font:inherit;font-weight:500;color:var(--text-3);letter-spacing:-.01em}
.gamesw>button:hover{color:var(--text-1);background:var(--bg-2)}
.gamesw>button .cv{width:0;height:0;border-top:4px solid currentColor;border-left:3.5px solid transparent;border-right:3.5px solid transparent;opacity:.7}
.gamesw .gmenu{position:absolute;top:calc(100% + 7px);left:-4px;z-index:70;min-width:255px;
  max-width:calc(100vw - 28px);background:var(--bg-1);
  border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 34px -14px rgba(0,0,0,.5);padding:5px;display:none}
.gamesw>button .gname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gamesw.open .gmenu{display:block}
.gamesw .gmenu .ghd{font-size:.6875rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-3);padding:7px 9px 4px}
.gamesw .gmenu button{display:flex;align-items:center;gap:9px;width:100%;text-align:left;background:none;border:0;
  padding:7px 9px;border-radius:8px;cursor:pointer;font:inherit;font-size:.875rem;color:var(--text-1)}
.gamesw .gmenu button:hover{background:var(--bg-2)}
.gamesw .gmenu button img{width:20px;height:20px;border-radius:5px;flex-shrink:0;object-fit:cover}
.gamesw .gmenu button.on{font-weight:600}
.gamesw .gmenu button .gtick{margin-left:auto;opacity:.75}
.gamesw .gmenu .gnote{font-size:.6875rem;color:var(--text-3);padding:5px 9px 7px;border-top:1px solid var(--line);margin-top:4px}
.ask-head-right{margin-left:auto;display:flex;align-items:center;gap:8px}
.who{display:inline-flex;align-items:center;gap:7px;font-size:.8125rem;color:var(--text-2);
  border:1px solid var(--border);background:var(--glass-2);padding:.3rem .7rem;border-radius:var(--r-full)}
.who b{color:var(--text);font-weight:600}
.who .dot{width:7px;height:7px;border-radius:50%;background:var(--green)}
.signin{display:inline-flex;align-items:center;gap:6px;font-size:.8125rem;font-weight:600;
  padding:.38rem .8rem;border-radius:var(--r-full);background:var(--accent);color:var(--on-accent);border:none;cursor:pointer}
.signin:hover{filter:brightness(1.08)}
.signout{background:transparent;border:1px solid var(--border);color:var(--text-3);font-size:.75rem;
  padding:.3rem .6rem;border-radius:var(--r-full);cursor:pointer}
.signout:hover{color:var(--text);border-color:var(--border-2)}

.ask-body{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;min-width:0;overscroll-behavior:contain}
.ask-col{max-width:820px;margin:0 auto;padding:26px clamp(18px,4vw,32px) 48px;display:flex;flex-direction:column;gap:24px;min-width:0}

.hero{padding:clamp(36px,8vh,76px) 0 8px;text-align:left}
.hero-kicker{display:flex;align-items:center;gap:10px;margin-bottom:14px;color:var(--text-3);font-size:.68rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
.hero-kicker::before{content:'';width:20px;height:1px;background:var(--text-3)}
.hero h1{font-size:clamp(3.6rem,8vw,5.9rem);font-weight:800;line-height:.92;letter-spacing:-.072em;margin:0 0 22px}
.hero p{color:var(--text-2);font-size:clamp(1.02rem,2.2vw,1.2rem);line-height:1.5;max-width:42ch;letter-spacing:-.02em}
.hero .ctx{display:flex;align-items:center;gap:7px;margin-top:16px;color:var(--text-3);font-size:.76rem;line-height:1.4}
.hero .ctx svg{width:12px;height:12px;color:var(--text-3)}

.ask-turn{display:flex;flex-direction:column;gap:14px;animation:rise .34s var(--ease) both;min-width:0}
.ask-turn+.ask-turn{border-top:1px solid var(--border);padding-top:26px}
/* The question is the headline of its turn: display serif, no chrome. */
.ask-q{display:flex;gap:12px;align-items:flex-start}
.ask-q .qmark{display:none}
.ask-q .qt{font-size:clamp(1.25rem,2.6vw,1.55rem);font-weight:700;letter-spacing:-.03em;line-height:1.28;color:var(--text);min-width:0;overflow-wrap:anywhere}
.ask-ans-head{display:flex;align-items:center;gap:9px;padding:0 0 9px;border-bottom:1px solid var(--border);margin-bottom:12px}
.ask-ans-head .lbl{font-size:.66rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.11em}
.ask-ans-head .flag{padding:2px 6px;border:1px solid var(--border);border-radius:var(--r-full);
  color:var(--text-3);font-size:.58rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.ask-ans-head .flag:empty{display:none}
.setting-live.setting-locked{opacity:.55}
.setting-live.setting-locked input{cursor:not-allowed}
.ask-viz-note{margin-top:10px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--r-sm);
  color:var(--text-3);font-size:.78rem}
.ask-ans-head .flag.flag-model{border-color:transparent;color:var(--text-3);opacity:.72;text-transform:none;letter-spacing:0;padding-left:2px}
.ask-ans-head .flag.flag-model a{color:inherit;text-decoration:none;border-bottom:1px dotted currentColor}
.ask-ans-head .flag.flag-model a:hover{color:var(--text);opacity:1}

.ask-direct{font-size:1.02rem;line-height:1.7;color:var(--text);min-width:0;overflow-wrap:break-word}
.ask-direct strong{font-weight:700}
.ask-direct p{margin:.4rem 0}
.ask-direct p:first-child{margin-top:0}
.ask-direct p:last-child{margin-bottom:0}
.ask-direct h3{font-size:1rem;font-weight:700;margin:.7rem 0 .3rem;letter-spacing:-.01em}
.ask-direct h3:first-child{margin-top:0}
.ask-direct ul,.ask-direct ol{padding-left:1.4rem;margin:.4rem 0}
.ask-direct li{margin:.2rem 0}
.ask-direct code{background:var(--glass-2);padding:.14em .4em;border-radius:5px;font-family:var(--mono);font-size:.82em;overflow-wrap:anywhere;word-break:break-all}
.ask-direct blockquote{border-left:2px solid var(--accent);padding:.25rem .7rem;margin:.45rem 0;color:var(--text-2);
  background:var(--accent-soft);border-radius:0 var(--r-xs) var(--r-xs) 0}
.ask-direct hr{border:none;border-top:1px solid var(--border);margin:.65rem 0}
.ask-direct h1{font-size:1.5rem;font-weight:800;margin:.3rem 0 .55rem;letter-spacing:-.035em;line-height:1.15}
.ask-direct h2{font-size:1.16rem;font-weight:700;margin:1.05rem 0 .38rem;letter-spacing:-.02em}
.ask-direct h2:first-child{margin-top:0}
.ask-direct h4{font-size:.9rem;font-weight:700;margin:.6rem 0 .2rem;color:var(--text-2)}
.ask-direct em{font-style:italic}
.ask-direct a{color:var(--accent);border-bottom:1px solid color-mix(in srgb,var(--accent) 42%,transparent)}
.ask-direct a:hover{border-bottom-color:var(--accent)}
.tbl-wrap{overflow-x:auto;margin:.6rem 0;-webkit-overflow-scrolling:touch;border:1px solid var(--border);border-radius:var(--r-sm)}
.ask-direct .md-table{border-collapse:collapse;width:100%;font-size:.86rem}
.ask-direct .md-table th,.ask-direct .md-table td{padding:.42rem .65rem;text-align:left;vertical-align:top;border-bottom:1px solid var(--border)}
.ask-direct .md-table th{background:var(--glass-2);font-weight:700;color:var(--text);white-space:nowrap}
.ask-direct .md-table tr:last-child td{border-bottom:none}
.ask-direct .md-table tbody tr:nth-child(even) td{background:var(--glass-1)}
.ask-direct a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
.ask-direct .codeblock{margin:.6rem 0;border:1px solid var(--border);border-radius:var(--r-sm);overflow:hidden;background:var(--bg-1)}
.cb-head{display:flex;align-items:center;justify-content:space-between;padding:.32rem .6rem;background:var(--glass-2);border-bottom:1px solid var(--border)}
.cb-lang{font-family:var(--mono);font-size:.64rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)}
.cb-copy{background:transparent;border:none;color:var(--text-3);font-size:.66rem;cursor:pointer;font-family:var(--font);padding:.12em .35em;border-radius:var(--r-xs)}
.cb-copy:hover{color:var(--text)}
.cb-copy.copied{color:var(--green)}
.ask-direct .codeblock pre{margin:0;border:none;background:none;padding:.7rem;overflow-x:auto;font-size:.82rem;line-height:1.55}
.ask-direct .codeblock pre code{background:none;padding:0}
.ask-direct table{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:.82rem}
.ask-direct th{background:var(--glass-2);color:var(--text-2);font-weight:600;text-align:left;padding:.4rem .6rem;
  border:1px solid var(--border);font-family:var(--mono);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em}
.ask-direct td{padding:.35rem .6rem;border:1px solid var(--border)}
.mermaid-wrap{margin:.7rem 0;padding:1rem;background:var(--glass-2);border:1px solid var(--border);border-radius:var(--r-md);overflow-x:auto;text-align:center;cursor:zoom-in}
.map-wrap{margin:.7rem 0;padding:1rem;background:var(--glass-2);border:1px solid var(--border);border-radius:var(--r-md);overflow:hidden;text-align:center;cursor:zoom-in}
.mermaid-wrap svg{display:block;width:100%;min-width:0;height:auto;max-width:100%;flex-shrink:1}
.map-wrap svg{display:block;width:100%;min-width:0;height:auto;max-width:100%;flex-shrink:1}
.map-details{margin:-.15rem 0 .8rem;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--glass-1);text-align:left;overflow:hidden}.map-details summary{cursor:pointer;padding:.65rem .8rem;font-size:.75rem;font-weight:600;color:var(--text-2)}.map-details summary:hover{color:var(--text)}.map-detail-list{max-height:220px;overflow:auto;border-top:1px solid var(--border)}.map-detail-row{display:grid;grid-template-columns:minmax(90px,1fr) auto;gap:10px;padding:.48rem .8rem;border-bottom:1px solid var(--border);font-size:.72rem}.map-detail-row:last-child{border-bottom:0}.map-detail-row span:last-child{color:var(--text-2);text-align:right;max-width:60vw;overflow-wrap:anywhere}
.mermaid-source,.map-source{display:none}
.viz-skeleton{min-height:150px;display:flex;flex-direction:column;gap:12px}
.viz-skeleton .sk-top{display:flex;align-items:center;gap:9px;color:var(--text-3);font-size:.82rem}
.viz-skeleton .sk-top::before{content:"";width:9px;height:9px;border-radius:50%;background:var(--text-3);animation:sk-pulse 1.1s ease-in-out infinite}
.viz-skeleton .sk-row{flex:1;display:flex;gap:9px;align-items:flex-end;min-height:104px}
.viz-skeleton .sk-bar{flex:1;border-radius:6px 6px 2px 2px;background:linear-gradient(90deg,var(--glass-1) 20%,var(--glass-3) 50%,var(--glass-1) 80%);
  background-size:300% 100%;animation:sk-shimmer 1.5s linear infinite}
@keyframes sk-shimmer{0%{background-position:150% 0}100%{background-position:-150% 0}}
@keyframes sk-pulse{0%,100%{opacity:.3}50%{opacity:1}}
@media(prefers-reduced-motion:reduce){.viz-skeleton .sk-bar,.viz-skeleton .sk-top::before{animation:none}}
.jargon{border-bottom:1px dotted var(--text-3);cursor:help}
.jargon:hover,.jargon:focus{border-bottom-color:var(--text);outline:none}
.jargon-pop{position:absolute;z-index:1200;width:300px;max-width:calc(100vw - 16px);background:var(--surface-2);
  border:1px solid var(--border-2);border-radius:var(--r-md);box-shadow:var(--e2),var(--hi);padding:11px 13px;
  font-size:.82rem;line-height:1.48;color:var(--text-2)}
.jargon-pop[hidden]{display:none}
.jargon-pop .jp-term{font-weight:700;color:var(--text);font-size:.85rem;margin-bottom:4px;letter-spacing:-.01em}
.jargon-pop .jp-blurb{margin-bottom:8px}
.jargon-pop .jp-link{display:inline-block;color:var(--accent);font-weight:600;font-size:.78rem}
.mermaid-err{color:var(--red);font-size:.75rem;font-family:var(--mono);padding:.5rem;text-align:left;white-space:pre-wrap}
.chart-viewer{position:fixed;inset:0;z-index:1000;display:none;flex-direction:column;background:var(--bg-0);color:var(--text)}
.chart-viewer.open{display:flex}
.chart-toolbar{flex:0 0 auto;display:flex;align-items:center;gap:8px;padding:max(10px,env(safe-area-inset-top)) 12px 10px;border-bottom:1px solid var(--border);background:var(--surface);box-shadow:var(--e1)}
.chart-toolbar strong{font-size:.85rem;margin-right:auto}
.chart-tool{min-width:42px;height:42px;border:1px solid var(--border-2);border-radius:var(--r-full);background:var(--glass-2);color:var(--text);font-size:1rem;font-weight:700;cursor:pointer}
.chart-tool.fit{padding:0 14px;font-size:.75rem}
.chart-stage{flex:1 1 auto;min-width:0;min-height:0;overflow:auto;overscroll-behavior:contain;touch-action:pan-x pan-y pinch-zoom;-webkit-overflow-scrolling:touch}
.chart-canvas{display:grid;place-items:center;width:max-content;min-width:100%;min-height:100%;padding:64px 72px 96px}
.chart-canvas svg{display:block;width:900px;min-width:0;height:auto;max-width:none!important;overflow:visible;flex-shrink:0}
@media(max-width:560px){.chart-toolbar strong{font-size:.75rem}.chart-canvas{padding:44px 48px 80px}}

.ask-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)}
.area{display:inline-flex;align-items:center;gap:5px;font-size:.72rem;color:var(--text-2);border:1px solid var(--border);
  background:var(--glass-2);border-radius:var(--r-full);padding:.22rem .6rem}
.area svg{width:11px;height:11px;color:var(--accent)}
.cachedtag{font-size:.72rem;color:var(--green);font-family:var(--mono)}
.ask-err{border:1px solid color-mix(in srgb,var(--red) 40%,transparent);background:color-mix(in srgb,var(--red) 8%,transparent);
  color:var(--text);border-radius:var(--r-md);padding:12px 14px;font-size:.9rem}

.starter-explorer{display:flex;flex-direction:column;gap:14px;padding-top:8px}
.starter-head{display:flex;align-items:center;justify-content:space-between;gap:16px}
.starter-heading{display:flex;flex-direction:column;gap:2px}
.starter-heading span{color:var(--text-3);font-size:.65rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.starter-heading h2{font-size:1.15rem;letter-spacing:-.025em}
.starter-browse{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--border);border-radius:var(--r-full);
  background:transparent;color:var(--text-2);padding:.42rem .72rem;font-size:.7rem;cursor:pointer;transition:all var(--t)}
.starter-browse:hover{color:var(--text);border-color:var(--border-2);background:var(--glass-2)}
.starter-browse svg{width:12px;height:12px}
.starter-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:1px 1px 2px}
.starter-tabs::-webkit-scrollbar{display:none}
.starter-tab{flex:0 0 auto;border:1px solid var(--border);border-radius:var(--r-full);background:transparent;
  color:var(--text-3);padding:.34rem .7rem;font-size:.7rem;cursor:pointer;transition:all var(--t)}
.starter-tab:hover{color:var(--text);border-color:var(--border-2)}
.starter-tab.active{color:var(--text);background:var(--glass-3);border-color:color-mix(in srgb,var(--accent) 34%,var(--border))}
.ask-follow{display:grid;grid-template-columns:1.14fr .86fr;gap:9px}
.ask-follow .starter-card{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 18px;grid-template-rows:auto 1fr;
  align-items:start;gap:7px 12px;width:100%;min-height:72px;padding:14px 15px;border-radius:var(--r-md);
  border:1px solid var(--border);background:var(--surface);color:var(--text-2);
  font-size:.83rem;line-height:1.38;text-align:left;cursor:pointer;transition:all var(--t);font-family:var(--font)}
.ask-follow .starter-card:hover{background:var(--glass-hover);border-color:var(--border-2);color:var(--text);transform:translateY(-1px)}
.ask-follow .starter-card>svg{grid-column:2;grid-row:1 / span 2;width:15px;height:15px;align-self:center;color:var(--text-3);transition:transform var(--t),color var(--t)}
.ask-follow .starter-card:hover>svg{transform:translateX(3px);color:var(--text)}
.starter-explorer .starter-card:first-child{grid-row:span 2;min-height:153px;padding:19px;font-size:1rem;line-height:1.38;
  background:linear-gradient(135deg,var(--glass-3),transparent 52%),var(--surface)}
.starter-explorer .starter-card:first-child:hover{background:linear-gradient(135deg,var(--glass-3),transparent 52%),var(--glass-hover)}
.starter-explorer .starter-card:first-child .starter-copy{align-self:end;max-width:24ch}
.starter-copy{grid-column:1;grid-row:2;overflow-wrap:anywhere}
.starter-meta{display:flex;align-items:center;gap:6px;color:var(--text-3);font-size:.62rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.starter-live{display:inline-flex;align-items:center;gap:3px;color:var(--text-2)}
.starter-live svg{width:10px;height:10px}
.question-sheet .sheet-card{max-width:720px}
.question-sheet .sheet-body{max-height:min(68vh,620px);overflow-y:auto;gap:12px}
.question-library{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.question-library .starter-card:first-child{grid-row:auto;min-height:78px;padding:14px 15px;font-size:.83rem}

.ask-composer{flex:0 0 auto;padding:12px clamp(14px,4vw,24px) 18px;
  padding-bottom:max(18px,env(safe-area-inset-bottom));background:linear-gradient(180deg,transparent,var(--bg-0) 22%)}
.ask-comp-inner{max-width:820px;margin:0 auto}
/* Gradient hairline: lit from above, falls off toward the bottom edge. */
.ask-comp-box{position:relative;display:flex;align-items:flex-end;gap:10px;padding:7px 7px 7px 16px;border:1px solid transparent;
  border-radius:28px;background:linear-gradient(var(--surface),var(--surface)) padding-box,var(--edge) border-box;
  box-shadow:0 12px 32px rgba(0,0,0,.14),var(--hi);transition:box-shadow var(--t)}
.ask-comp-box:focus-within{background:linear-gradient(var(--surface),var(--surface)) padding-box,var(--edge-focus) border-box;
  box-shadow:0 14px 38px rgba(0,0,0,.18),0 0 0 3px color-mix(in srgb,var(--accent) 10%,transparent)}
.ask-comp-box textarea{flex:1;width:100%;padding:8px 2px;background:transparent;border:none;color:var(--text);font-family:var(--font);
  font-size:16px;resize:none;outline:none;min-height:24px;max-height:120px;line-height:1.5}
.ask-comp-box textarea::placeholder{color:var(--text-3)}
.ask-send{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;
  border:none;background:var(--send-grad);color:var(--on-accent);cursor:pointer;
  box-shadow:var(--send-hi),0 2px 10px rgba(0,0,0,.35);
  transition:filter var(--t),transform var(--t),box-shadow var(--t);flex-shrink:0}
.ask-send:hover:not(:disabled){filter:brightness(1.05);transform:translateY(-1px);
  box-shadow:var(--send-hi),0 5px 16px rgba(0,0,0,.42)}
.ask-send:active:not(:disabled){transform:translateY(0) scale(.94);box-shadow:var(--send-hi),0 1px 5px rgba(0,0,0,.3)}
.ask-send:disabled{opacity:.35;cursor:not-allowed;box-shadow:none;transform:none}
.ask-send svg{width:19px;height:19px}
.seg{display:flex;align-items:center;gap:2px;padding:3px;border-radius:11px;background:var(--glass-2);min-width:0}
.segbtn{border:0;background:transparent;color:var(--text-3);border-radius:8px;padding:.38rem .72rem;font-size:.7rem;line-height:1;cursor:pointer;white-space:nowrap}
.segbtn:hover{color:var(--text)}
.segbtn.active{background:var(--surface);color:var(--text);box-shadow:0 1px 4px rgba(0,0,0,.12)}
.comp-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;padding:0 5px;font-size:.72rem;color:var(--text-3)}
.live-mode{display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;color:var(--text-3);
  padding:.22rem 0;font-size:.7rem;cursor:pointer}
.live-mode:hover:not(:disabled){color:var(--text)}
.live-mode[aria-pressed="true"]{color:var(--accent)}
.live-mode:disabled{opacity:.55;cursor:not-allowed}
.live-mode svg{width:12px;height:12px}
.ask-loading{display:flex;flex-direction:column;gap:6px;min-height:30px;color:var(--text-2);font-size:.92rem}
.ask-load-row{display:flex;align-items:center;gap:10px;min-width:0}
.ask-load-row.has-actions{cursor:pointer}
.ask-actions-toggle{margin-left:2px;color:var(--text-3);font-size:.8rem;font-variant-numeric:tabular-nums;user-select:none;flex:0 0 auto;white-space:nowrap}
.ask-actions-toggle[hidden]{display:none}
.ask-actions{list-style:none;margin:0 0 2px 26px;padding:0;display:flex;flex-direction:column;gap:3px;font-size:.8rem}
.ask-actions[hidden]{display:none}
.ask-actions li{display:flex;align-items:center;gap:7px;color:var(--text-2);max-width:100%}
.ask-actions li svg{width:12px;height:12px;flex:0 0 auto;color:var(--text-3)}
.ask-actions li .a-lbl{font-family:var(--mono,ui-monospace,SFMono-Regular,monospace);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* loading-ui "classic": 12 radial bars, currentColor, staggered fade. */
.ask-loading .classic{position:relative;display:inline-block;width:16px;height:16px;color:var(--accent);flex:0 0 auto}
.ask-loading .classic-in{position:absolute;top:50%;left:50%;display:block;width:100%;height:100%}
.ask-loading .classic i{position:absolute;top:-3.9%;left:-10%;width:24%;height:8%;border-radius:9999px;
  background:currentColor;animation:classic-fade 1.2s linear infinite}
@keyframes classic-fade{0%{opacity:1}100%{opacity:.15}}
.ask-loading .shimmer{background:linear-gradient(100deg, var(--text-3) 28%, var(--text) 50%, var(--text-3) 72%);
  background-repeat:no-repeat;background-size:220px 100%;-webkit-background-clip:text;background-clip:text;color:transparent;
  animation:shimmer-sweep 2.4s ease-in-out infinite}
/* Pixel geometry, not percent: the sweep is measured from the text box origin,
   so changing the status label's length no longer rescales the gradient and the
   animation runs continuously instead of jumping each time the phase narrates. */
@keyframes shimmer-sweep{0%{background-position:-180px 0}100%{background-position:380px 0}}
@media(prefers-reduced-motion:reduce){
  .ask-loading .classic i{animation:none;opacity:.55}
  .ask-loading .shimmer{animation:none;-webkit-background-clip:unset;background-clip:unset;color:var(--text-2)}
}
@media(max-width:560px){
  .ask-head{padding:10px 14px}.hero{padding:12px 0 0}.who b{display:none}.ask-brand em{display:none}
  .ask-brand{gap:7px;min-width:0}
  .gamesw{min-width:0}
  .gamesw>button{max-width:34vw;padding:2px 3px}
  .gamesw>button .dot{display:none}
  .ask-col{padding:10px 14px 18px;gap:14px}
  .hero-kicker{font-size:.62rem;margin-bottom:6px}
  .hero h1{font-size:clamp(3.8rem,19vw,4.7rem);margin-bottom:16px}
  .hero p{font-size:.92rem;line-height:1.42;max-width:none}
  .hero .ctx{margin-top:10px;font-size:.66rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .starter-explorer{gap:9px;padding-top:2px}.starter-heading h2{font-size:.94rem}.starter-head{align-items:center}
  .starter-browse{padding:.34rem .58rem;font-size:.64rem}
  .ask-follow{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
  .ask-follow .starter-card{min-height:68px;padding:10px;border-radius:13px;font-size:.72rem;line-height:1.28;gap:4px 7px;grid-template-columns:minmax(0,1fr) 13px}
  .ask-follow .starter-card>svg{width:12px;height:12px}.starter-meta{font-size:.53rem}
  .starter-explorer .starter-card:first-child{grid-column:1 / -1;grid-row:auto;min-height:76px;padding:12px;font-size:.8rem}
  .starter-explorer .starter-card:first-child .starter-copy{align-self:start;max-width:none}
  .question-library{grid-template-columns:1fr}.question-library .starter-card:first-child{grid-column:auto}
  .ask-composer{padding:7px 12px max(9px,env(safe-area-inset-bottom))}
  .ask-comp-box{border-radius:22px;padding:6px 6px 6px 14px}
  .ask-send{width:38px;height:38px}
  .comp-foot{margin-top:4px;font-size:.65rem}
  .sheet{align-items:flex-end;padding:0}
  .sheet-card{max-width:none;border-radius:24px 24px 0 0;border-bottom:0;padding-bottom:env(safe-area-inset-bottom)}
}
@media(max-width:560px) and (max-height:700px){
  .hero{padding-top:6px}.hero h1{font-size:3.55rem;margin-bottom:11px}
  .hero p{font-size:.84rem;line-height:1.35}
  .ask-follow .starter-card{min-height:64px;padding:8px}.ask-col{gap:10px}
}

/* ── sidebar (conversation history) ─────────────────────────────────────── */
.ask-root{display:grid;grid-template-columns:264px minmax(0,1fr);height:100dvh;overflow:hidden}
.ask-side{display:flex;flex-direction:column;border-right:1px solid var(--border);background:var(--bg-1);height:100dvh;min-height:0;overflow:hidden}
.side-scrim{display:none}
.side-top{flex:0 0 auto;padding:14px 14px 10px;border-bottom:1px solid var(--border)}
.ask-newq{width:100%;display:flex;align-items:center;justify-content:center;gap:8px;padding:.6rem;border-radius:var(--r-md);
  border:1px solid transparent;background:var(--accent);color:var(--on-accent);font-weight:600;font-size:var(--fs-sm,.875rem);
  cursor:pointer;box-shadow:var(--e1);transition:background var(--t),transform var(--t);font-family:var(--font)}
.ask-newq:hover{filter:brightness(1.07);transform:translateY(-1px)}
.side-lbl{font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);padding:12px 16px 6px}
.side-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 8px 12px}
.ask-conv{display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:.5rem .6rem;margin-bottom:2px;
  border-radius:var(--r-sm);border:1px solid transparent;background:transparent;color:var(--text-2);cursor:pointer;
  font-size:.8125rem;font-family:var(--font);line-height:1.35}
.ask-conv:hover{background:var(--glass-2);color:var(--text)}
.ask-conv.active{background:var(--glass-2);border-color:color-mix(in srgb,var(--accent) 30%,var(--border));color:var(--text);
  box-shadow:inset 2px 0 0 var(--accent)}
.ask-conv .ct{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ask-conv .cx{opacity:0;border:none;background:transparent;color:var(--text-3);cursor:pointer;font-size:1rem;line-height:1;padding:0 2px}
.ask-conv:hover .cx{opacity:1}
.ask-conv .cx:hover{color:var(--red)}
.side-foot{flex:0 0 auto;border-top:1px solid var(--border);padding:12px 14px;display:flex;flex-direction:column;gap:10px}
.quota{font-size:.75rem;color:var(--text-2)}
.quota .qrow{display:flex;justify-content:space-between;margin-bottom:5px}
.quota b{color:var(--text);font-weight:600}
.qbar{height:5px;border-radius:99px;background:var(--glass-3);overflow:hidden;margin-bottom:8px}
.qbar i{display:block;height:100%;background:var(--accent);border-radius:99px;transition:width var(--t)}
.qbar.mcp i{background:var(--accent-2,var(--accent))}
.qreset{font-size:.68rem;color:var(--text-3)}
.tierchip{display:inline-flex;align-items:center;gap:5px;font-size:.68rem;font-weight:600;padding:.18rem .5rem;
  border-radius:var(--r-full);background:var(--accent-soft);color:var(--accent);border:1px solid color-mix(in srgb,var(--accent) 26%,transparent)}
.side-user{flex:0 0 auto;display:flex;align-items:center;gap:8px;font-size:.78rem;color:var(--text-2);border-top:1px solid var(--border);padding:10px 14px;flex-wrap:wrap}
.side-user b{color:var(--text)}
.console-link{display:flex;align-items:center;gap:8px;padding:.5rem .6rem;border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-2);font-size:.78rem}
.console-link:hover{color:var(--text);background:var(--glass-2)}
.side-ver{align-self:flex-start;font-size:.72rem;color:var(--text-3,var(--text-2));font-family:var(--font-mono,monospace);letter-spacing:0}
.side-ver:hover{color:var(--accent)}
.side-user form{margin-left:auto}

.iconbtn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:var(--r-full);
  border:1px solid var(--border);background:var(--surface);color:var(--text-2);cursor:pointer;transition:all var(--t)}
.iconbtn:hover{color:var(--text);background:var(--glass-hover);border-color:var(--border-2)}
.sheet{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;padding:20px;
  background:color-mix(in srgb,#000 55%,transparent);backdrop-filter:blur(3px)}
.sheet.open{display:flex}
.sheet-card{width:100%;max-width:460px;border:1px solid transparent;border-radius:var(--r-lg);
  background:linear-gradient(var(--surface),var(--surface)) padding-box,var(--edge) border-box;
  box-shadow:var(--e3),var(--hi);overflow:hidden}
.sheet-head{display:flex;align-items:center;gap:10px;padding:15px 18px;border-bottom:1px solid var(--border);font-weight:700}
.sheet-head .x{margin-left:auto;background:transparent;border:none;color:var(--text-3);font-size:1.25rem;cursor:pointer;line-height:1}
.sheet-body{padding:18px;display:flex;flex-direction:column;gap:20px}
.setting-group>label{display:block;font-size:.69rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3);margin-bottom:8px}
.setting-group .seg{width:100%}
.setting-group .segbtn{flex:1;padding:.55rem .65rem;font-size:.78rem}
.setting-live{display:flex;align-items:center;gap:12px;padding:12px 13px;border:1px solid var(--border);border-radius:var(--r-md);background:var(--glass-2)}
.setting-live input{width:18px;height:18px;accent-color:var(--accent)}
.setting-live span{display:block;color:var(--text);font-size:.84rem;font-weight:600}
.setting-live small{display:block;color:var(--text-3);font-size:.7rem;font-weight:400;margin-top:2px}
.console-shell{height:100dvh;overflow-y:auto;background:var(--bg-0)}
.console-wrap{max-width:1180px;margin:0 auto;padding:24px clamp(16px,4vw,36px) 60px}
.console-top{display:flex;align-items:center;gap:12px;margin-bottom:24px}.console-top h1{font-size:1.8rem;letter-spacing:-.04em}.console-top a{margin-left:auto}
.console-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:18px}
.console-stat{border:1px solid var(--border);background:var(--surface);border-radius:var(--r-md);padding:14px}.console-stat small{display:block;color:var(--text-3);font-size:.68rem;text-transform:uppercase;letter-spacing:.06em}.console-stat b{display:block;font-size:1.3rem;margin-top:3px}
.console-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(320px,.85fr);gap:16px;align-items:start}
.console-card{border:1px solid var(--border);background:var(--surface);border-radius:var(--r-md);overflow:hidden}.console-card h2{font-size:.9rem;padding:13px 15px;border-bottom:1px solid var(--border)}
.console-table{width:100%;border-collapse:collapse;font-size:.78rem}.console-table th,.console-table td{padding:10px 12px;border-bottom:1px solid var(--border);text-align:left}.console-table th{color:var(--text-3);font-size:.62rem;text-transform:uppercase;letter-spacing:.05em}.console-table tr:last-child td{border-bottom:0}.console-table tbody tr:hover{background:var(--glass-2)}
.console-user{font-weight:600;color:var(--text)}.console-muted{color:var(--text-3)}.console-profile{padding:15px}.console-profile h3{font-size:1.2rem;margin-bottom:4px}.console-facts{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}.console-fact{font-size:.68rem;border:1px solid var(--border);border-radius:var(--r-full);padding:.2rem .55rem;color:var(--text-2)}
.console-question{padding:12px 15px;border-top:1px solid var(--border)}.console-question:first-child{border-top:0}.console-question b{display:block;font-size:.82rem;line-height:1.4}.console-question small{display:block;color:var(--text-3);margin-top:5px}.console-answer{color:var(--text-2);font-size:.75rem;line-height:1.45;margin-top:7px;white-space:pre-wrap;max-height:110px;overflow:auto}
.console-reports{margin-top:16px}.console-cluster{padding:12px 15px;border-top:1px solid var(--border)}.console-cluster:first-of-type{border-top:0}.console-cluster h3{font-size:.8rem}.console-cluster h3 span{color:var(--text-3);font-weight:500}.console-report{margin-top:9px;font-size:.74rem;color:var(--text-2);line-height:1.45}.console-replay{display:inline-block;margin-top:4px;font-size:.7rem;color:var(--accent)}
@media(max-width:820px){.console-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.console-grid{grid-template-columns:1fr}.console-table th:nth-child(4),.console-table td:nth-child(4){display:none}}
.toggle{display:flex;align-items:center;gap:10px;font-size:.85rem;color:var(--text-2)}
.toggle input{width:16px;height:16px;accent-color:var(--accent)}

/* ── citations + conflict ───────────────────────────────────────────────── */
.srcs{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px;min-width:0}
.src{display:inline-flex;align-items:center;gap:5px;font-size:.72rem;padding:.24rem .6rem;border-radius:var(--r-full);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  border:1px solid var(--border);background:var(--glass-2);color:var(--text-2);text-decoration:none;transition:all var(--t)}
.src:hover{color:var(--text);border-color:var(--border-2)}
.src svg{width:11px;height:11px}
.src.code{font-family:var(--mono);color:var(--accent);background:var(--accent-soft);
  border-color:color-mix(in srgb,var(--accent) 22%,transparent)}
.src.wiki{color:var(--amber,#f59e0b)}
.conflict{display:flex;gap:9px;margin-top:12px;padding:10px 12px;border-radius:var(--r-sm);
  border:1px solid color-mix(in srgb,var(--amber,#f59e0b) 38%,transparent);
  background:color-mix(in srgb,var(--amber,#f59e0b) 9%,transparent);font-size:.8rem;color:var(--text-2)}
.conflict b{color:var(--text)}
.conflict svg{width:14px;height:14px;color:var(--amber,#f59e0b);flex-shrink:0;margin-top:2px}

/* ── gate screens ───────────────────────────────────────────────────────── */
.gate{height:100dvh;overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:24px}
.gate-card{max-width:460px;width:100%;text-align:center;border:1px solid transparent;
  background:linear-gradient(var(--surface),var(--surface)) padding-box,var(--edge) border-box;
  border-radius:var(--r-lg);box-shadow:var(--e2),var(--hi);padding:34px 30px}
.gate-card .av{width:46px;height:46px;margin:0 auto 16px;border-radius:var(--r-md);
  background:var(--accent);display:flex;align-items:center;justify-content:center}
.gate-card .av svg{width:24px;height:24px;color:var(--on-accent)}
.gate-card h1{font-size:1.35rem;margin-bottom:8px;letter-spacing:-.02em}
.gate-card p{color:var(--text-2);font-size:.92rem;margin-bottom:20px}
.gate-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:.65rem 1.3rem;border-radius:var(--r-md);
  background:var(--accent);color:var(--on-accent);font-weight:600;font-size:.9rem;border:none;cursor:pointer;text-decoration:none}
.gate-btn:hover{filter:brightness(1.08)}
.gate-tiers{display:flex;flex-direction:column;gap:8px;margin:18px 0 20px;text-align:left}
.gate-tier{display:flex;align-items:center;gap:10px;padding:.55rem .8rem;border:1px solid var(--border);
  border-radius:var(--r-sm);background:var(--glass-2);font-size:.82rem;color:var(--text-2)}
.gate-tier b{color:var(--text);min-width:96px}
.gate-err{color:var(--red);font-size:.82rem;margin-bottom:14px}
.lander{min-height:100dvh;overflow-y:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:56px 24px;text-align:center}
.lander-in{width:100%;max-width:660px;display:flex;flex-direction:column;align-items:center;animation:rise .5s var(--ease,ease) both}
.lander-brand{display:flex;align-items:center;gap:10px;margin-bottom:32px;font-weight:700;letter-spacing:-.02em;font-size:1.05rem}
.lander-brand em{font-style:normal;color:var(--text-3);font-weight:500}
.lander h1{font-size:clamp(1.9rem,5.2vw,2.7rem);line-height:1.07;letter-spacing:-.032em;margin-bottom:16px}
.lander-sub{color:var(--text-2);font-size:1.02rem;line-height:1.62;max-width:530px;margin-bottom:28px}
.lander-cta{display:inline-flex;align-items:center;justify-content:center;gap:9px;padding:.82rem 1.55rem;border-radius:var(--r-md);
  background:var(--accent);color:var(--on-accent);font-weight:600;font-size:.95rem;text-decoration:none;box-shadow:var(--e2)}
.lander-cta:hover{filter:brightness(1.08)}
.lander-cta svg{color:var(--on-accent)}
.lander-note{color:var(--text-3);font-size:.8rem;margin-top:14px;max-width:420px}
.lander-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:38px 0 6px;max-width:600px}
.lander-chip{padding:.5rem .9rem;border:1px solid var(--border);border-radius:var(--r-full);background:var(--glass-2);color:var(--text-2);font-size:.845rem}
.lander-feats{display:flex;flex-wrap:wrap;justify-content:center;gap:10px 22px;margin:34px 0 4px;color:var(--text-2);font-size:.86rem}
.lander-feat{display:flex;align-items:center;gap:8px}
.lander-feat svg{width:15px;height:15px;color:var(--text)}
.lander-sec{width:100%;max-width:520px;margin-top:42px}
.lander-sec-h{font-size:.74rem;text-transform:uppercase;letter-spacing:.13em;color:var(--text-3);margin-bottom:12px}
@media(max-width:820px){
  .ask-root{grid-template-columns:1fr}
  .ask-side{position:fixed;inset:0 auto 0 0;width:264px;height:100dvh;z-index:50;transform:translateX(-100%);transition:transform var(--t)}
  .ask-side.open{transform:none;box-shadow:0 0 40px rgba(0,0,0,.5)}
  .side-scrim{position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.5);display:none}
  .side-scrim.open{display:block}
}

/* answer toolbar: copy / share / sources */
.ans-tools{display:flex;align-items:center;gap:4px;margin-left:auto}
.tbtn{display:inline-flex;align-items:center;gap:5px;background:transparent;border:1px solid transparent;
  color:var(--text-3);font-size:.7rem;font-family:var(--font);padding:.22rem .5rem;border-radius:var(--r-full);
  cursor:pointer;transition:all var(--t)}
.tbtn:hover{color:var(--text);background:var(--glass-2);border-color:var(--border)}
.tbtn.ok{color:var(--green)}
.tbtn.bad{color:var(--red)}
.tbtn svg{width:12px;height:12px}
/* sources panel */
.srcpanel{margin-top:10px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--glass-1);overflow:hidden}
.srcpanel>summary{cursor:pointer;list-style:none;padding:.5rem .7rem;font-size:.75rem;color:var(--text-2);
  display:flex;align-items:center;gap:7px}
.srcpanel>summary::-webkit-details-marker{display:none}
.srcpanel>summary:hover{color:var(--text);background:var(--glass-2)}
.srcpanel[open]>summary{border-bottom:1px solid var(--border)}
.srcpanel .chev{transition:transform var(--t)}
.srcpanel[open] .chev{transform:rotate(90deg)}
.srcrow{display:flex;align-items:center;gap:8px;padding:.4rem .7rem;font-size:.74rem;border-top:1px solid var(--border)}
.srcrow:first-of-type{border-top:none}
.srcrow a{font-family:var(--mono);font-size:.72rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srckind{font-size:.62rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3);
  border:1px solid var(--border);border-radius:var(--r-full);padding:.05rem .4rem;flex-shrink:0}
.srckind.code{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 28%,transparent)}
.srckind.wiki{color:var(--amber,#f59e0b);border-color:color-mix(in srgb,var(--amber,#f59e0b) 30%,transparent)}
/* suggested follow-ups */
.sugg{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
.sugg .fchip{display:inline-flex;align-items:center;gap:6px;font-family:var(--font);font-size:.78rem;padding:.38rem .7rem;
  border-radius:var(--r-full);border:1px solid color-mix(in srgb,var(--accent) 24%,transparent);
  background:var(--accent-soft);color:var(--accent);cursor:pointer}
.sugg .fchip svg,.srcpanel>summary .chev{width:13px;height:13px;color:var(--accent)}
/* live-data nudge */
.livehint{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}
.livehint .lh-btn{display:inline-flex;align-items:center;gap:6px;font-size:.76rem;font-weight:600;
  padding:.4rem .75rem;border-radius:var(--r-full);cursor:pointer;color:var(--accent);
  background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 26%,transparent);transition:all var(--t)}
.livehint .lh-btn:hover{filter:brightness(1.08)}
.livehint .lh-btn svg{width:13px;height:13px}
.livehint .lh-note{font-size:.72rem;color:var(--text-3)}
.sugg-lbl{width:100%;font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3);margin-bottom:1px}
/* stop button state */
.ask-send.stopping{background:var(--red);color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3)}
.toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:80;background:var(--surface);
  border:1px solid var(--border);color:var(--text);font-size:.8rem;padding:.5rem .9rem;border-radius:var(--r-full);
  box-shadow:var(--e1);opacity:0;pointer-events:none;transition:opacity var(--t)}
.toast.show{opacity:1}
@media(min-width:821px){.menubtn{display:none}}
/* Every turn renders identically, a conversation, not a tree. */
.thread-cost{display:inline-flex;align-items:center;gap:5px;font-size:.7rem;color:var(--text-3)}
.thread-cost b{color:var(--text-2);font-weight:600}
.comp-foot{align-items:center}
.comp-right{display:inline-flex;align-items:center;gap:10px}
.qcount{font-variant-numeric:tabular-nums;color:var(--text-3);font-size:.7rem}
.qcount.max{color:var(--red)}

/* sidebar history groups + empty state */
.side-group{font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--text-3);padding:14px 8px 5px}
.side-group:first-child{padding-top:6px}
.side-empty{display:flex;flex-direction:column;align-items:center;gap:9px;padding:30px 14px;color:var(--text-3);font-size:.78rem;text-align:center;line-height:1.5}
.side-empty svg{width:18px;height:18px;opacity:.55}
.ask-conv .cx{flex-shrink:0;border-radius:var(--r-xs);transition:opacity var(--t),color var(--t)}
.ask-conv .cx.confirm{opacity:1;color:var(--red);font-size:.66rem;font-weight:700;letter-spacing:.02em}

/* jump-to-latest pill */
.ask-shell{position:relative}
.jumpbtn{position:absolute;left:50%;bottom:118px;z-index:15;display:inline-flex;align-items:center;gap:6px;
  border:1px solid var(--border-2);background:var(--surface);color:var(--text);font-size:.75rem;font-weight:600;font-family:var(--font);
  padding:.44rem .85rem;border-radius:var(--r-full);box-shadow:var(--e2),var(--hi);cursor:pointer;
  opacity:0;pointer-events:none;transform:translateX(-50%) translateY(6px);transition:opacity var(--t),transform var(--t)}
.jumpbtn.show{opacity:1;pointer-events:auto;transform:translateX(-50%)}
.jumpbtn:hover{background:var(--glass-hover)}
.jumpbtn svg{width:12px;height:12px}
@media(max-width:560px){.jumpbtn{bottom:104px}}

/* report-answer dialog + inline form (shared pages) */
.fb-sub{color:var(--text-2);font-size:.82rem;line-height:1.5;margin:-6px 0 0}
.fb-tags{display:flex;flex-wrap:wrap;gap:7px}
.fb-tag{border:1px solid var(--border);background:var(--glass-2);color:var(--text-2);font-size:.76rem;font-family:var(--font);
  padding:.34rem .7rem;border-radius:var(--r-full);cursor:pointer;transition:all var(--t)}
.fb-tag:hover{color:var(--text);border-color:var(--border-2)}
.fb-tag.active{background:var(--accent);color:var(--on-accent);border-color:transparent}
.fb-text{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--r-md);background:var(--field-bg);
  color:var(--text);font-family:var(--font);font-size:.85rem;line-height:1.5;resize:vertical;min-height:64px}
.fb-text:focus{outline:none;border-color:var(--border-2)}
.fb-actions{display:flex;justify-content:flex-end;gap:8px}
.fb-inline{display:flex;flex-direction:column;gap:8px;margin:4px 0 10px;padding:12px;border:1px solid var(--border);
  border-radius:var(--r-md);background:var(--glass-1)}

`;


const SELF_ORIGIN = process.env.SELF_ORIGIN || "https://ask.lakesidegames.net";

// Social-unfurl tags for a shared session or report. Built per session so the
// Discord/Slack/X/iMessage preview shows that conversation's own question and a
// card image generated from it, not a generic logo.
function ogHead({ title, description, image, url }) {
  const t = esc(title || "Ask · A House Divided");
  const d = esc(description || "Answers about how A House Divided actually works, from the game's live code.");
  const img = esc(image || `${SELF_ORIGIN}/og-default.png`);
  const u = esc(url || SELF_ORIGIN);
  return `<meta property="og:type" content="article">
<meta property="og:site_name" content="Ask · A House Divided">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${img}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="${u}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:description" content="${d}">
<meta name="twitter:image" content="${img}">
<meta name="theme-color" content="#000000">`;
}

function shell(inner, extraJs = "", head = "") {
  return `<!doctype html><html lang="en" data-theme="dark"><head>${THEME_HEAD}
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Ask · A House Divided</title>
<meta name="robots" content="noindex">
<meta name="color-scheme" content="dark light">
<link rel="icon" type="image/png" href="/ahd-logo.png">
<link rel="apple-touch-icon" href="/ahd-logo.png">
${head}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}
${TOKENS_CSS}
${ASK_THEME_CSS}
html{-webkit-text-size-adjust:100%}
body{font-family:var(--font);line-height:1.55;letter-spacing:-.011em;-webkit-font-smoothing:antialiased;
  -moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;background:var(--bg-0);color:var(--text)}
body::before{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;background:
  radial-gradient(1100px 520px at 50% -12%,var(--glow-1),transparent 62%),
  radial-gradient(900px 620px at 88% 112%,var(--glow-2),transparent 60%),
  var(--bg-0)}
body::after{content:'';position:fixed;inset:0;z-index:-1;pointer-events:none;mix-blend-mode:overlay;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.05'/%3E%3C/svg%3E")}
::selection{background:var(--accent-soft);color:var(--text)}
a{color:var(--accent);text-decoration:none}
button,input,textarea{font-family:inherit}
:focus-visible{outline:none;box-shadow:var(--ring)}
svg{display:block;width:14px;height:14px;flex-shrink:0}
::-webkit-scrollbar{width:10px}::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--scroll);border-radius:var(--r-full);border:2px solid transparent;background-clip:padding-box}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){*{animation-duration:.001ms!important;transition-duration:.001ms!important}}
${ASK_CSS}</style></head><body>${inner}${extraJs}</body></html>`;
}

function changelogPage() {
  const releases = changelog.releases();
  const body = releases.length
    ? releases.map((r, i) => `<section class="cl-rel${i === 0 ? " cl-latest" : ""}">
      <div class="cl-relhd"><h2>v${esc(r.version)}</h2><span class="cl-date">${esc(r.date)}</span>${i === 0 ? '<span class="cl-badge">Latest</span>' : ""}</div>
      ${r.sections.map(s => `${s.title ? `<h3 class="cl-sec">${esc(s.title)}</h3>` : ""}
      <ul class="cl-items">${s.items.map(it => `<li>${esc(it)}</li>`).join("")}</ul>`).join("")}
    </section>`).join("")
    : `<p class="cl-empty">No release notes yet.</p>`;
  const inner = `<div class="cl-root">
    <header class="cl-head">
      <a class="cl-back" href="/">${icon("arrow-left", 14) || "←"} Ask</a>
      <span class="cl-brand">${mark(20)}Ask <em>· What's new</em></span>
    </header>
    <main class="cl-body">
      <div class="cl-hero"><h1>Changelog</h1><p>What's changed in Ask, newest first.</p></div>
      ${body}
    </main>
  </div>`;
  const css = `<style>
  .cl-root{max-width:720px;margin:0 auto;padding:0 20px 80px}
  .cl-head{display:flex;align-items:center;gap:16px;padding:18px 0;position:sticky;top:0;background:var(--bg-0);border-bottom:1px solid var(--border);margin-bottom:32px;z-index:2}
  .cl-back{display:inline-flex;align-items:center;gap:6px;color:var(--text-2);font-size:.82rem}
  .cl-back:hover{color:var(--text)}
  .cl-brand{display:inline-flex;align-items:center;gap:8px;font-weight:700;color:var(--text)}
  .cl-brand em{font-style:normal;font-weight:500;color:var(--text-2)}
  .cl-brand .av{display:inline-flex;color:var(--accent)}
  .cl-hero{margin-bottom:36px}
  .cl-hero h1{font-size:1.9rem;font-weight:800;letter-spacing:-.02em}
  .cl-hero p{color:var(--text-2);margin-top:6px}
  .cl-rel{padding:22px 0;border-top:1px solid var(--border)}
  .cl-rel:first-of-type{border-top:none}
  .cl-relhd{display:flex;align-items:baseline;gap:12px;margin-bottom:12px}
  .cl-relhd h2{font-size:1.15rem;font-weight:700;font-family:var(--font-mono,monospace)}
  .cl-date{color:var(--text-3,var(--text-2));font-size:.8rem}
  .cl-badge{font-size:.68rem;text-transform:uppercase;letter-spacing:.04em;padding:2px 8px;border-radius:var(--r-full);background:var(--accent-soft);color:var(--accent)}
  .cl-sec{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-2);margin:16px 0 8px}
  .cl-items{list-style:none;display:flex;flex-direction:column;gap:8px}
  .cl-items li{position:relative;padding-left:18px;color:var(--text);font-size:.92rem;line-height:1.5}
  .cl-items li::before{content:'';position:absolute;left:2px;top:.6em;width:5px;height:5px;border-radius:50%;background:var(--accent)}
  .cl-empty{color:var(--text-2)}
  </style>`;
  return shell(inner, "", css);
}

function signedOut({ failed = false, notFound = false } = {}) {
  if (notFound) {
    return shell(`<div class="gate"><div class="gate-card">
      ${mark(52)}
      <h1>Link not found</h1>
      <p>This shared conversation no longer exists, or the link was revoked.</p>
      <a class="gate-btn" href="/">Go to Ask</a>
    </div></div>`);
  }
  const examples = [
    "How is inflation calculated?",
    "Why did my corporation's revenue drop?",
    "What raises approval before an election?",
    "Which bond maturity is best right now?",
    "How do tariffs ripple through the economy?",
  ];
  return shell(`<div class="lander"><div class="lander-in">
    <div class="lander-brand">${mark(38)}Ask <em>· A House Divided</em></div>
    <h1>Answers about how the game actually works.</h1>
    <p class="lander-sub">Ask anything about A House Divided and get an answer taken straight from the game's live code, with citations, honest "the code doesn't show this" notes, and optional live game-state lookups.</p>
    ${failed ? `<div class="gate-err" style="margin-bottom:16px">That sign-in didn't complete. Please try again.</div>` : ""}
    <a class="lander-cta" href="/auth/login">${icon("user", 16)} Sign in with your game account</a>
    <div class="lander-note">Free for every player with a game account. Supporters get a bigger daily budget, plus charts and maps.</div>
    <div class="lander-chips">${examples.map(q => `<span class="lander-chip">${esc(q)}</span>`).join("")}</div>
    <div class="lander-feats">
      <span class="lander-feat">${icon("terminal", 15)} Grounded in the live code</span>
      <span class="lander-feat">${icon("message", 15)} Cites its sources</span>
      <span class="lander-feat">${icon("zap", 15)} Live game-state lookups</span>
    </div>
    <div class="lander-sec">
      <div class="lander-sec-h">Daily budgets</div>
      <div class="gate-tiers" style="margin:0">${tierRows()}</div>
    </div>
  </div></div>`, "", ogHead({
    title: "Ask · A House Divided",
    description: "Answers about how A House Divided actually works, taken from the game's live code, with citations and live game-state lookups.",
    url: SELF_ORIGIN,
  }));
}

// Ask is open to every player, so the only ways to land here are a restricted
// account or a game account we could not confirm, which is also what an ops-dash
// outage looks like from the outside.
function notEntitled({ identity, context, reason }) {
  const name = esc(context?.username || identity?.username || "there");
  const banned = reason === "banned";
  // "private" is a deliberate maintenance/staff-only mode — it must NOT wear the
  // "can't confirm your account" copy, which reads to players as a broken login.
  const isPrivate = reason === "private";
  const heading = banned ? "Account restricted" : isPrivate ? "Ask is in staff-only mode" : "Can't confirm your game account";
  const body = banned
    ? `Ask isn't available on this account.`
    : isPrivate
      ? `Ask is temporarily limited to staff while we work on it, <b>${name}</b>. It'll be back for everyone shortly.`
      : `You're signed in as <b>${name}</b>, but we couldn't load your A House Divided account just now. This is usually temporary, so try again in a minute.`;
  return shell(`<div class="gate"><div class="gate-card">
    <div class="av">${icon("lock", 24) || icon("user", 24)}</div>
    <h1>${heading}</h1>
    <p>${body}</p>
    ${banned || isPrivate ? "" : `<a class="gate-btn" href="/">Try again</a>`}
    <div style="margin-top:18px"><form method="POST" action="/auth/logout"><button class="signout" type="submit">Sign out</button></form></div>
  </div></div>`);
}

function app({ identity, context, entitlement, usage, conversations, model, styles, lengths, game }) {
  const activeGame = game && game.id ? game : gameRegistry.fallback();
  const ch = context?.character;
  const corp = context?.corporation;
  const corpRole = corp?.role === "shareholder" ? "Shareholder in" : "CEO of";
  const contextLine = [
    ch?.name,
    ch?.country,
    ch?.party,
    corp?.name && `${corpRole} ${corp.name}`,
  ].filter(Boolean).map(esc).join(" · ");

  const starterCatalog = starterQuestions.catalog(context, {
    liveAvailable: activeGame.live && usage.mcpRemaining > 0, game: activeGame.id,
  });
  // Vary the first paint: a random 3 from the relevant top of the catalog, so
  // reloading the page doesn't show the same starters every time. The client
  // reshuffles again on "new question" and when the browse panel opens.
  const featuredPool = starterCatalog.slice(0, Math.min(28, starterCatalog.length));
  const initialStarters = [...featuredPool].sort(() => Math.random() - 0.5).slice(0, 3);
  const starterCard = question => `<button class="fchip starter-card" type="button" data-question="${esc(question.text)}" data-live="${question.live ? "true" : "false"}">
    <span class="starter-meta"><span>${esc(question.label)}</span>${question.live ? `<span class="starter-live">${icon("zap", { size: 10 })} Live</span>` : ""}</span>
    <span class="starter-copy">${esc(question.text)}</span>${icon("arrow-right", { size: 15 })}</button>`;
  const starterTabs = [
    ["for-you", corp || ch ? "For you" : "Featured"],
    ...Object.entries(starterQuestions.CATEGORIES).map(([key, value]) => [key, value.label]),
  ].map(([key, label], index) => `<button class="starter-tab${index === 0 ? " active" : ""}" type="button" role="tab" aria-selected="${index === 0 ? "true" : "false"}" data-starter-category="${key}">${esc(label)}</button>`).join("");

  const segBtns = (obj, group, current) => Object.entries(obj).map(([k, v]) =>
    `<button type="button" class="segbtn${k === current ? " active" : ""}" data-opt="${group}" data-val="${k}">${esc(v.label)}</button>`
  ).join("");

  const inner = `<div class="ask-root">
  <aside class="ask-side" id="side">
    <div class="side-top"><button class="ask-newq" id="newq">New question</button></div>
    <div class="side-list" id="convs"></div>
    <div class="side-foot">
      <div class="quota" id="quota"></div>
      ${context?.isAdmin ? `<a class="console-link" href="/console">${icon("terminal", 14) || icon("settings", 14)} Console</a>` : ""}
      <a class="side-ver" href="/changelog" title="What's new">v${esc(changelog.VERSION)}</a>
    </div>
    <div class="side-user">
      ${icon("user", 14)}<b>${esc(context?.username || identity.username || "You")}</b>
      <span class="tierchip">${esc(entitlement.label)}</span>
      <form method="POST" action="/auth/logout"><button class="signout" type="submit">Sign out</button></form>
    </div>
  </aside>
  <div class="side-scrim" id="scrim"></div>

  <div class="ask-shell">
    <header class="ask-head">
      <button class="iconbtn menubtn" id="menu" aria-label="Menu">${icon("menu", 16) || "≡"}</button>
      <span class="ask-brand">${mark(26, activeGame.id)}Ask <span class="gamesw" id="gamesw">
        <button type="button" id="gamesw-btn" aria-haspopup="true" aria-expanded="false" aria-label="Switch game"><span class="dot">·&nbsp;</span><span class="gname" id="gamesw-name">${esc(activeGame.name)}</span><span class="cv"></span></button>
        <span class="gmenu" id="gamesw-menu"></span>
      </span></span>
      <span class="ask-head-right">
        <button class="iconbtn" id="settings" type="button" aria-label="Settings" title="Settings">${icon("settings", 16)}</button>
      </span>
    </header>

    <div class="ask-body" id="body"><div class="ask-col">
      <div class="hero" id="hero">
        <div class="hero-kicker">A House Divided</div>
        <h1>Ask the game.</h1>
        <p>Clear answers, grounded in the code that runs it.</p>
        ${contextLine ? `<div class="ctx">${icon("user", { size: 12 })}<span>${contextLine}</span></div>` : ""}
      </div>
      <section class="starter-explorer" id="starterExplorer" aria-labelledby="starterTitle">
        <div class="starter-head"><div class="starter-heading"><span>Start here</span><h2 id="starterTitle">${corp || ch ? "Picked for your game" : "A few good questions"}</h2></div>
          <button class="starter-browse" id="starterBrowse" type="button">Browse all ${icon("arrow-right", { size: 12 })}</button></div>
        <div class="ask-follow" id="starters">${initialStarters.map(starterCard).join("")}</div>
      </section>
      <div id="out"></div>
    </div></div>

    <button class="jumpbtn" id="jump" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>Jump to latest</button>
    <div class="ask-composer"><div class="ask-comp-inner">
      <form id="f"><div class="ask-comp-box">
        <textarea id="q" rows="1" maxlength="500" placeholder="Ask about any part of the game…"></textarea>
        <button class="ask-send" id="go" type="submit" aria-label="Ask"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg></button>
      </div></form>
      <div class="comp-foot">
        <button class="live-mode" id="liveMode" type="button" aria-pressed="false">${icon("zap", { size: 12 })} <span>Code sources</span></button>
        <span class="comp-right"><span class="qcount" id="qcount" hidden></span><span class="thread-cost" id="costlbl"></span></span>
      </div>
    </div></div>
  </div>
</div>

<div class="sheet" id="settingsPanel" role="dialog" aria-modal="true" aria-labelledby="settingsTitle"><div class="sheet-card">
  <div class="sheet-head" id="settingsTitle">${icon("settings", 16)} Settings <button class="x" id="settingsClose" type="button" aria-label="Close">×</button></div>
  <div class="sheet-body">
    <div class="setting-group"><label>Appearance</label><div class="seg">
      <button type="button" class="segbtn" data-theme-value="light">White</button>
      <button type="button" class="segbtn" data-theme-value="dark">OLED black</button>
    </div></div>
    <label class="setting-live"><input type="checkbox" id="live"><span>Use live game data<small>Include your current character and corporation state.</small></span></label>
    <label class="setting-live${entitlement?.visualizations ? "" : " setting-locked"}"><input type="checkbox" id="visualizations"${entitlement?.visualizations ? "" : " disabled"}><span>Use visualizations<small>${entitlement?.visualizations
      ? "Allow a diagram, chart, or game map when it makes the answer clearer."
      : "Charts, diagrams, and game maps are a supporter feature. Answers stay in prose."}</small></span></label>
    <div class="setting-group"><label>Response style</label><div class="seg">${segBtns(styles, "style", "standard")}</div></div>
    <div class="setting-group"><label>Response length</label><div class="seg">${segBtns(lengths, "length", "standard")}</div></div>
  </div>
</div></div>

<div class="sheet" id="fbPanel" role="dialog" aria-modal="true" aria-labelledby="fbTitle"><div class="sheet-card">
  <div class="sheet-head" id="fbTitle">Report this answer <button class="x" id="fbClose" type="button" aria-label="Close">×</button></div>
  <div class="sheet-body">
    <p class="fb-sub">Tell us what went wrong and staff will review it. The report includes this question and answer.</p>
    <div class="fb-tags" id="fbTags">
      <button class="fb-tag" type="button">Wrong or outdated</button>
      <button class="fb-tag" type="button">Didn't answer the question</button>
      <button class="fb-tag" type="button">Missing sources</button>
      <button class="fb-tag" type="button">Confusing</button>
      <button class="fb-tag" type="button">Other</button>
    </div>
    <textarea class="fb-text" id="fbText" rows="3" maxlength="500" placeholder="Add detail (optional)"></textarea>
    <div class="fb-actions"><button class="signout" id="fbCancel" type="button">Cancel</button><button class="signin" id="fbSend" type="button">Send report</button></div>
  </div>
</div></div><!-- settings:end -->`;

  const questionPanel = `<div class="sheet question-sheet" id="questionPanel" role="dialog" aria-modal="true" aria-labelledby="questionTitle"><div class="sheet-card">
    <div class="sheet-head" id="questionTitle">Question library <button class="x" id="questionClose" type="button" aria-label="Close">×</button></div>
    <div class="sheet-body">
      <div class="starter-tabs" id="starterTabs" role="tablist" aria-label="Question topics">${starterTabs}</div>
      <div class="ask-follow question-library" id="libraryQuestions"></div>
    </div>
  </div></div>`;

  const chartViewer = `<div class="chart-viewer" id="chartViewer" role="dialog" aria-modal="true" aria-label="Full-screen chart" aria-hidden="true">
    <div class="chart-toolbar"><strong>Chart viewer</strong>
      <button class="chart-tool" type="button" data-chart-zoom="out" aria-label="Zoom out">−</button>
      <button class="chart-tool fit" type="button" data-chart-zoom="reset">Fit</button>
      <button class="chart-tool" type="button" data-chart-zoom="in" aria-label="Zoom in">+</button>
      <button class="chart-tool" id="chartClose" type="button" aria-label="Close chart">×</button>
    </div>
    <div class="chart-stage" id="chartStage"><div class="chart-canvas" id="chartCanvas"></div></div>
  </div>`;

  const js = `<script>(function(){
var USAGE=${JSON.stringify(usage)};
var CONVS=${JSON.stringify((conversations || []).map(c => ({ id: c.id, title: c.title, updated: c.updated, created: c.created }))).replace(/</g, "\\u003c")};
var STARTERS=${JSON.stringify(starterCatalog).replace(/</g, "\\u003c")};
var LIVE_ICON=${JSON.stringify(icon("zap", { size: 10 }))},ARROW_ICON=${JSON.stringify(icon("arrow-right", { size: 15 }))};
var MODEL_NAMES=${JSON.stringify(require("./models").displayMap())};
var VIZ_ALLOWED=${entitlement?.visualizations ? "true" : "false"};
var MODEL_URLS=${JSON.stringify(require("./models").urlMap())};
var GAMES=${JSON.stringify(gameRegistry.publicList())};
var ACTIVE_GAME=${JSON.stringify(activeGame.id)};
var f=document.getElementById('f'),q=document.getElementById('q'),go=document.getElementById('go'),
    out=document.getElementById('out'),hero=document.getElementById('hero'),body=document.getElementById('body'),
    live=document.getElementById('live'),visualizations=document.getElementById('visualizations'),convs=document.getElementById('convs'),
    side=document.getElementById('side'),scrim=document.getElementById('scrim'),settingsPanel=document.getElementById('settingsPanel'),
    starters=document.getElementById('starters'),starterExplorer=document.getElementById('starterExplorer'),
    starterTabs=document.getElementById('starterTabs'),libraryQuestions=document.getElementById('libraryQuestions'),
    questionPanel=document.getElementById('questionPanel'),liveMode=document.getElementById('liveMode'),
    chartViewer=document.getElementById('chartViewer'),chartStage=document.getElementById('chartStage'),
    chartCanvas=document.getElementById('chartCanvas'),jump=document.getElementById('jump'),
    qcount=document.getElementById('qcount'),fbPanel=document.getElementById('fbPanel');
var DOC_TITLE=document.title;
var convId=null,turnsInThread=0,nextCost=1,fuLeft=3,busy=false,starterCategory='for-you';
var chartScale=1,chartBaseWidth=900,chartReturnFocus=null;
var S={style:localStorage.getItem('ask.style')||'standard',length:localStorage.getItem('ask.length')||'standard'};

// ---- game switcher ----------------------------------------------------------
// The selection is sticky per browser and can be set by ?game= so the docs Ask
// button lands on the right game. The server still overrides it when a question
// names a different game outright, so this is a default, not a hard filter.
function gameById(id){for(var i=0;i<GAMES.length;i++){if(GAMES[i].id===id)return GAMES[i];}return GAMES[0];}
var GAME=gameById(ACTIVE_GAME);
var gamesw=document.getElementById('gamesw'),gameswBtn=document.getElementById('gamesw-btn'),
    gameswMenu=document.getElementById('gamesw-menu'),gameswName=document.getElementById('gamesw-name');
function renderGameMenu(){
  if(!gameswMenu)return;
  var h='<span class="ghd">Lakeside Games</span>';
  for(var i=0;i<GAMES.length;i++){
    var g=GAMES[i];
    h+='<button type="button" data-game="'+esc(g.id)+'" class="'+(g.id===GAME.id?'on':'')+'">'
      +'<img src="'+(g.id==='ahd'?'/ahd-logo.png':'/game-logo/'+esc(g.id)+'.png')+'" alt="">'
      +esc(g.short)+(g.id===GAME.id?'<span class="gtick">&#10003;</span>':'')+'</button>';
  }
  h+='<span class="gnote">Live game data is available for A House Divided only. The others are answered from their code and docs.</span>';
  gameswMenu.innerHTML=h;
}
function applyGame(){
  if(gameswName)gameswName.textContent=GAME.name;
  var bm=document.getElementById('brand-mark');
  if(bm)bm.src=GAME.id==='ahd'?'/ahd-logo.png':'/game-logo/'+GAME.id+'.png';
  // A single-player game has no world to query, so the live toggle is not a
  // choice the player can meaningfully make. Disable it and say why.
  if(live){
    var row=live.closest('label')||live.parentElement;
    if(!GAME.live){live.checked=false;live.disabled=true;if(row){row.style.opacity='.45';row.title='No live data: '+GAME.name+' is single-player.';}}
    else{live.disabled=false;if(row){row.style.opacity='';row.title='';}}
  }
  document.title=GAME.id==='ahd'?DOC_TITLE:('Ask · '+GAME.name);
  renderGameMenu();
}
if(gameswBtn){
  gameswBtn.addEventListener('click',function(e){
    e.stopPropagation();
    gamesw.classList.toggle('open');
    gameswBtn.setAttribute('aria-expanded',gamesw.classList.contains('open')?'true':'false');
  });
  gameswMenu.addEventListener('click',function(e){
    var b=e.target.closest('button[data-game]');
    if(!b)return;
    var picked=gameById(b.getAttribute('data-game'));
    if(picked.id===GAME.id){gamesw.classList.remove('open');return;}
    localStorage.setItem('ask.game',picked.id);
    // Reload rather than swap in place: the starters, hero copy and brand are
    // rendered server-side per game, so a client-only swap would leave the old
    // game's suggested questions on screen.
    location.href=picked.id==='ahd'?'/':'/?game='+encodeURIComponent(picked.id);
  });
  document.addEventListener('click',function(e){if(gamesw&&!gamesw.contains(e.target))gamesw.classList.remove('open');});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&gamesw)gamesw.classList.remove('open');});
}
applyGame();
localStorage.removeItem('ask.model');
visualizations.checked=VIZ_ALLOWED&&localStorage.getItem('ask.visualizations')==='true';
visualizations.addEventListener('change',function(){localStorage.setItem('ask.visualizations',String(visualizations.checked));});
var replayQuestion=new URLSearchParams(location.search).get('replay');
if(replayQuestion){q.value=replayQuestion.slice(0,500);setTimeout(function(){q.focus();q.dispatchEvent(new Event('input'));},0);}
function esc(s){var d=document.createElement('div');d.textContent=s==null?'':s;return d.innerHTML;}
function modelName(d){var id=d&&d.modelId?d.modelId:(d&&d.model?d.model:'');if(d&&d.modelName)return d.modelName;return MODEL_NAMES[id]||'';}
function setFlags(turn,d){if(!turn)return;var n=turn.querySelector('.flag-model');if(!n)return;var name=modelName(d),url=MODEL_URLS[d.modelId||d.model];if(!name)return;if(url){n.innerHTML='<a href="'+esc(url)+'" target="_blank" rel="noopener" title="About '+esc(name)+'">'+esc(name)+'</a>';}else{n.textContent=name;}}
function mermaidCfg(){var light=document.documentElement.getAttribute('data-theme')==='light';
  var v=light
    ?{background:'#ffffff',primaryColor:'#f2f2f3',primaryTextColor:'#0a0a0a',primaryBorderColor:'#b0b0b0',lineColor:'#8a8a8a',secondaryColor:'#e6e6e7',tertiaryColor:'#f6f6f7',mainBkg:'#f2f2f3',nodeBorder:'#b0b0b0',clusterBkg:'#fafafa',clusterBorder:'#d4d4d4',textColor:'#0a0a0a',fontFamily:'Inter, system-ui, sans-serif'}
    :{background:'#000000',primaryColor:'#181818',primaryTextColor:'#fafafa',primaryBorderColor:'#5a5a5a',lineColor:'#8a8a8a',secondaryColor:'#101010',tertiaryColor:'#0b0b0b',mainBkg:'#181818',nodeBorder:'#4a4a4a',clusterBkg:'#0b0b0b',clusterBorder:'#2a2a2a',textColor:'#e8e8e8',fontFamily:'Inter, system-ui, sans-serif'};
  return{startOnLoad:false,securityLevel:'strict',theme:'base',themeVariables:v,
    xyChart:{plotColorPalette:light?'#111111,#666666,#999999,#444444,#bbbbbb,#333333':'#ffffff,#aaaaaa,#777777,#cccccc,#555555,#e0e0e0'}};}
var mermaidLoading=false,mermaidWait=[];
function ensureMermaid(cb){if(window.mermaid){window.mermaid.initialize(mermaidCfg());cb();return;}mermaidWait.push(cb);if(mermaidLoading)return;mermaidLoading=true;var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';s.onload=function(){window.mermaid.initialize(mermaidCfg());var q=mermaidWait.splice(0);q.forEach(function(f){f();});};s.onerror=function(){mermaidLoading=false;};document.head.appendChild(s);}
function expandMermaidViewBox(svg,done){if(!svg){if(done)done();return;}requestAnimationFrame(function(){try{var vb=svg.viewBox&&svg.viewBox.baseVal,box=svg.getBBox();if(vb&&box&&box.width&&box.height){var pad=20,x=Math.min(vb.x,box.x-pad),y=Math.min(vb.y,box.y-pad),right=Math.max(vb.x+vb.width,box.x+box.width+pad),bottom=Math.max(vb.y+vb.height,box.y+box.height+pad);svg.setAttribute('viewBox',[x,y,right-x,bottom-y].join(' '));}svg.removeAttribute('width');svg.removeAttribute('height');}catch(e){}if(done)done();});}
function applyChartZoom(){var svg=chartCanvas.querySelector('svg');if(!svg)return;svg.style.maxWidth='none';svg.style.width=Math.round(chartBaseWidth*chartScale)+'px';}
function setChartZoom(next){chartScale=Math.max(.55,Math.min(3,next));applyChartZoom();}
function openChartViewer(wrap){var original=wrap&&wrap.querySelector('svg');if(!original)return;chartReturnFocus=wrap;chartCanvas.innerHTML='';var svg=original.cloneNode(true);chartCanvas.appendChild(svg);chartViewer.classList.add('open');chartViewer.setAttribute('aria-hidden','false');expandMermaidViewBox(svg,function(){var vb=svg.viewBox&&svg.viewBox.baseVal;chartBaseWidth=Math.max(900,vb&&vb.width||0);chartScale=1;applyChartZoom();chartStage.scrollLeft=0;chartStage.scrollTop=0;});document.getElementById('chartClose').focus();}
function closeChartViewer(){chartViewer.classList.remove('open');chartViewer.setAttribute('aria-hidden','true');chartCanvas.innerHTML='';if(chartReturnFocus)chartReturnFocus.focus();chartReturnFocus=null;}
function prepareMermaidWrap(wrap){var svg=wrap.querySelector('svg');if(!svg)return;expandMermaidViewBox(svg);wrap.tabIndex=0;wrap.setAttribute('role','button');wrap.setAttribute('aria-label','Open chart full screen');wrap.title='Open chart full screen';wrap.addEventListener('click',function(){openChartViewer(wrap);});wrap.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();openChartViewer(wrap);}});}
// A shimmer placeholder shown while a chart or map is still being built, so the
// answer area never sits blank between "done" and the visualization appearing.
function vizSkeleton(label){
  var hs=[46,72,58,88,52,68,44],bars='';
  for(var i=0;i<hs.length;i++)bars+='<div class="sk-bar" style="height:'+hs[i]+'%"></div>';
  return '<div class="viz-skeleton"><div class="sk-top">'+esc(label)+'</div><div class="sk-row">'+bars+'</div></div>';
}
function renderMermaidIn(el){
  var blocks=el&&el.querySelectorAll('.mermaid-source');if(!blocks||!blocks.length)return;
  // Create the wraps with a skeleton FIRST so the placeholder shows during the
  // mermaid CDN load as well as the render itself.
  var wraps=[];
  blocks.forEach(function(block){var src=block.textContent;if(!src)return;var wrap=document.createElement('div');wrap.className='mermaid-wrap';wrap.setAttribute('data-source',src);wrap.innerHTML=vizSkeleton('Rendering chart…');block.replaceWith(wrap);wraps.push({wrap:wrap,src:src});});
  if(!wraps.length)return;
  ensureMermaid(function(){wraps.forEach(function(w,i){window.mermaid.render('ask-mmd-'+Date.now()+'-'+i,w.src).then(function(r){w.wrap.innerHTML=r.svg;prepareMermaidWrap(w.wrap);}).catch(function(){w.wrap.innerHTML='<div class="mermaid-err">This visualization could not be rendered.</div>';});});});
}
function mapDetails(spec){var rows=(spec&&Array.isArray(spec.regions)?spec.regions:[]).slice().sort(function(a,b){return Number(b.value||0)-Number(a.value||0);});if(!rows.length)return null;var details=document.createElement('details');details.className='map-details';var title=esc(spec.title||'Map details'),unit=spec.unit?' '+esc(spec.unit):'';details.innerHTML='<summary>View '+rows.length+' map entries · '+title+'</summary><div class="map-detail-list">'+rows.map(function(row){var label=esc(row.label||row.id||'Region'),detail=esc(row.detail||''),value=Number.isFinite(Number(row.value))?Number(row.value).toLocaleString()+unit:'';return '<div class="map-detail-row"><b>'+label+'</b><span>'+((detail?detail+(value?' · ':''):'')+value||'No public value')+'</span></div>';}).join('')+'</div>';return details;}
function renderMapsIn(el){var blocks=el&&el.querySelectorAll('.map-source');if(!blocks||!blocks.length)return;blocks.forEach(function(block){var src=block.textContent;if(!src)return;var wrap=document.createElement('div');wrap.className='map-wrap';wrap.innerHTML=vizSkeleton('Rendering map…');block.replaceWith(wrap);var spec;try{spec=JSON.parse(src);}catch(e){wrap.innerHTML='<div class="mermaid-err">This map could not be rendered.</div>';return;}var details=mapDetails(spec);if(details)wrap.after(details);fetch('/api/map/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(spec)}).then(function(r){if(!r.ok)throw new Error();return r.text();}).then(function(svg){wrap.innerHTML=svg;prepareMermaidWrap(wrap);}).catch(function(){wrap.innerHTML='<div class="mermaid-err">This map could not be rendered.</div>';});});}
chartViewer.addEventListener('click',function(e){var zoom=e.target.closest('[data-chart-zoom]');if(!zoom)return;var action=zoom.dataset.chartZoom;if(action==='in')setChartZoom(chartScale*1.25);else if(action==='out')setChartZoom(chartScale/1.25);else setChartZoom(1);});
document.getElementById('chartClose').addEventListener('click',closeChartViewer);
document.addEventListener('keydown',function(e){if(e.key==='Escape'&&chartViewer.classList.contains('open'))closeChartViewer();});

function paintQuota(u){
  if(u)USAGE=u;
  var pct=USAGE.limit?Math.min(100,USAGE.used/USAGE.limit*100):0;
  var mpct=USAGE.mcpLimit?Math.min(100,USAGE.mcpUsed/USAGE.mcpLimit*100):0;
  var mins=Math.max(0,Math.round((USAGE.resetAt-Date.now())/60000));
  var rs=mins>=60?(Math.floor(mins/60)+'h '+(mins%60)+'m'):(mins+'m');
  document.getElementById('quota').innerHTML=
    '<div class="qrow"><span>Questions</span><span><b>'+USAGE.remaining+'</b> / '+USAGE.limit+' left</span></div>'+
    '<div class="qbar"><i style="width:'+pct+'%"></i></div>'+
    '<div class="qrow"><span>Live data</span><span><b>'+USAGE.mcpRemaining+'</b> / '+USAGE.mcpLimit+' left</span></div>'+
    '<div class="qbar mcp"><i style="width:'+mpct+'%"></i></div>'+
    '<div class="qreset">Resets in '+rs+'</div>';
  live.disabled=USAGE.mcpRemaining<=0;
  if(live.disabled)live.checked=false;
  syncLiveMode();
}
paintQuota();setInterval(function(){paintQuota();},60000);
function paintCost(){
  var el=document.getElementById('costlbl');
  if(!turnsInThread){nextCost=1;el.innerHTML='<b>1</b> question';q.placeholder='Ask about any part of the game…';}
  else if(fuLeft>0){nextCost=0.5;el.innerHTML='Follow-up · <b>&frac12;</b> question · '+fuLeft+' left in this thread';
    q.placeholder='Ask a follow-up…';}
  else{nextCost=1;el.innerHTML='<b>1</b> question · follow-ups used up';q.placeholder='Ask a new question…';}
}
paintCost();

// settings
function closeSettings(){if(settingsPanel.classList.contains('open')){settingsPanel.classList.remove('open');document.getElementById('settings').focus();}}
document.getElementById('settings').onclick=function(){settingsPanel.classList.add('open');document.getElementById('settingsClose').focus();};
document.getElementById('settingsClose').onclick=closeSettings;
settingsPanel.addEventListener('click',function(e){if(e.target===settingsPanel)closeSettings();});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){closeSettings();closeQuestions();closeFeedback();}});
settingsPanel.addEventListener('click',function(e){
  var b=e.target.closest('[data-opt]'); if(!b)return;
  var g=b.dataset.opt; S[g]=b.dataset.val; localStorage.setItem('ask.'+g,S[g]);
  b.parentNode.querySelectorAll('[data-opt]').forEach(function(o){o.classList.toggle('active',o===b);});
});
document.querySelectorAll('[data-opt]').forEach(function(o){o.classList.toggle('active',S[o.dataset.opt]===o.dataset.val);});
function syncTheme(){
  var current=document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';
  settingsPanel.querySelectorAll('[data-theme-value]').forEach(function(b){b.classList.toggle('active',b.dataset.themeValue===current);});
}
settingsPanel.addEventListener('click',function(e){
  var b=e.target.closest('[data-theme-value]');if(!b)return;
  document.documentElement.setAttribute('data-theme',b.dataset.themeValue);
  localStorage.setItem('ahd-theme',b.dataset.themeValue);syncTheme();
});
syncTheme();
live.checked=localStorage.getItem('ask.live')==='true'&&!live.disabled;
function syncLiveMode(){
  liveMode.disabled=live.disabled;
  liveMode.setAttribute('aria-pressed',live.checked?'true':'false');
  liveMode.querySelector('span').textContent=live.disabled?'Live data unavailable':(live.checked?'Code + live data':'Code sources');
}
live.addEventListener('change',function(){localStorage.setItem('ask.live',String(live.checked));syncLiveMode();});
liveMode.addEventListener('click',function(){if(live.disabled)return;live.checked=!live.checked;
  localStorage.setItem('ask.live',String(live.checked));syncLiveMode();});
syncLiveMode();

function shuffle(a){a=a.slice();for(var i=a.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=a[i];a[i]=a[j];a[j]=t;}return a;}
// A varied sample from the relevant top of the catalog, so the starters differ
// every time they are shown instead of being a fixed slice.
function featuredSample(n){return shuffle(STARTERS.slice(0,Math.min(28,STARTERS.length))).slice(0,n);}
function starterCardEl(item){
  var card=document.createElement('button');
  card.className='fchip starter-card';card.type='button';card.dataset.question=item.text;card.dataset.live=String(!!item.live);
  card.innerHTML='<span class="starter-meta"><span>'+esc(item.label)+'</span>'+
    (item.live?'<span class="starter-live">'+LIVE_ICON+' Live</span>':'')+'</span><span class="starter-copy">'+esc(item.text)+'</span>'+ARROW_ICON;
  return card;
}
// Refresh the 3 explorer cards with a fresh random pick.
function renderExplorer(){ if(!starters)return;starters.innerHTML='';featuredSample(3).forEach(function(it){starters.appendChild(starterCardEl(it));}); }
function starterPool(){
  return starterCategory==='for-you'?featuredSample(12):shuffle(STARTERS.filter(function(item){return item.category===starterCategory;}));
}
function renderLibrary(){
  var pool=starterPool();libraryQuestions.innerHTML='';for(var i=0;i<pool.length;i++)libraryQuestions.appendChild(starterCardEl(pool[i]));
}
starterTabs.addEventListener('click',function(e){
  var tab=e.target.closest('[data-starter-category]');if(!tab)return;
  starterCategory=tab.dataset.starterCategory;
  starterTabs.querySelectorAll('.starter-tab').forEach(function(other){var active=other===tab;
    other.classList.toggle('active',active);other.setAttribute('aria-selected',active?'true':'false');});
  renderLibrary();
});
function closeQuestions(){if(questionPanel.classList.contains('open')){questionPanel.classList.remove('open');document.getElementById('starterBrowse').focus();}}
document.getElementById('starterBrowse').addEventListener('click',function(){renderLibrary();questionPanel.classList.add('open');document.getElementById('questionClose').focus();});
document.getElementById('questionClose').addEventListener('click',closeQuestions);
questionPanel.addEventListener('click',function(e){if(e.target===questionPanel)closeQuestions();});

// sidebar (mobile)
function closeSide(){side.classList.remove('open');scrim.classList.remove('open');}
document.getElementById('menu').onclick=function(){side.classList.add('open');scrim.classList.add('open');};
scrim.onclick=closeSide;
document.getElementById('newq').onclick=function(){convId=null;turnsInThread=0;fuLeft=3;paintCost();out.innerHTML='';hero.style.display='';starterExplorer.style.display='';renderExplorer();closeSide();document.title=DOC_TITLE;
  convs.querySelectorAll('.ask-conv').forEach(function(c){c.classList.remove('active');});q.focus();};

convs.addEventListener('click',function(e){
  var del=e.target.closest('[data-del]');
  if(del){e.stopPropagation();
    // Two-step delete: the first tap arms the button, the second within a few
    // seconds actually deletes. A mis-tap never costs a conversation.
    if(!del.classList.contains('confirm')){
      del.classList.add('confirm');del.textContent='Delete?';
      clearTimeout(del._t);del._t=setTimeout(function(){del.classList.remove('confirm');del.textContent='\\u00d7';},3000);
      return;}
    fetch('/api/conversation/delete',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:del.dataset.del})}).then(function(r){return r.json();}).then(function(d){
        if(convId===del.dataset.del){convId=null;out.innerHTML='';hero.style.display='';starterExplorer.style.display='';document.title=DOC_TITLE;}
        renderConvs(d.conversations||[]);});
    return;}
  var b=e.target.closest('.ask-conv'); if(!b)return;
  loadConv(b.dataset.conv);
});
function convGroup(ts){
  if(!ts)return 'Earlier';
  var now=new Date(),d=new Date(ts);
  if(d.toDateString()===now.toDateString())return 'Today';
  if(new Date(now.getTime()-86400000).toDateString()===d.toDateString())return 'Yesterday';
  var days=(now.getTime()-d.getTime())/86400000;
  if(days<7)return 'Previous 7 days';
  if(days<30)return 'Previous 30 days';
  return 'Older';
}
function renderConvs(list){
  CONVS=list;
  if(!list.length){
    convs.innerHTML='<div class="side-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>No conversations yet.<br>Your questions will show up here.</span></div>';
    return;}
  var groups={},order=[];
  list.forEach(function(c){var g=convGroup(c.updated||c.created);if(!groups[g]){groups[g]=[];order.push(g);}groups[g].push(c);});
  convs.innerHTML=order.map(function(g){
    return '<div class="side-group">'+g+'</div>'+groups[g].map(function(c){
      var t=c.title||'Untitled';
      return '<button class="ask-conv'+(c.id===convId?' active':'')+'" data-conv="'+esc(c.id)+'" title="'+esc(t)+'"><span class="ct">'+
        esc(t)+'</span><span class="cx" data-del="'+esc(c.id)+'" aria-label="Delete conversation">\\u00d7</span></button>';}).join('');
  }).join('');
}
renderConvs(CONVS);
function loadConv(id){
  convId=id;closeSide();
  convs.querySelectorAll('.ask-conv').forEach(function(c){c.classList.toggle('active',c.dataset.conv===id);});
  for(var i=0;i<CONVS.length;i++)if(CONVS[i].id===id&&CONVS[i].title){document.title=CONVS[i].title+' · Ask';break;}
  out.innerHTML='';hero.style.display='none';starterExplorer.style.display='none';
  fetch('/api/conversation?id='+encodeURIComponent(id)).then(function(r){return r.json();}).then(function(d){
    (d.turns||[]).forEach(function(t){addTurn(t.question,{answer:t.answer,areas:t.areas,citations:t.citations,cached:!!t.cached,model:t.model});});
    turnsInThread=(d.turns||[]).length;fuLeft=Math.max(0,3-Math.max(0,turnsInThread-1));paintCost();
    body.scrollTop=body.scrollHeight;});
}

function inl(s){return s
  .replace(/\`([^\`]+)\`/g,'<code>$1</code>')
  .replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>')
  .replace(/(^|[^*])\\*([^*\\n]+)\\*(?!\\*)/g,'$1<em>$2</em>')
  .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');}
function tbl(block){var lines=block.split('\\n').filter(function(l){return l.trim();});
  if(lines.length<2||!/\\|/.test(lines[0])||!/^\\s*\\|?[\\s:|-]+$/.test(lines[1]))return null;
  var cx=function(l){return l.replace(/^\\s*\\||\\|\\s*$/g,'').split('|').map(function(c){return c.trim();});};
  var h=cx(lines[0]),r=lines.slice(2).filter(function(l){return /\\|/.test(l);}).map(cx);
  return '<div class="tbl-wrap"><table class="md-table"><thead><tr>'+h.map(function(x){return '<th>'+inl(x)+'</th>';}).join('')+'</tr></thead><tbody>'+r.map(function(row){return '<tr>'+row.map(function(c){return '<td>'+inl(c)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>';}
function md(t){
  t=esc(t||'');
  var parts=t.split(/\`\`\`/),o='';
  for(var i=0;i<parts.length;i++){
    if(i%2===1){var seg=parts[i],nl=seg.indexOf('\\n'),lang=nl>0?seg.slice(0,nl).trim().toLowerCase():'',code=nl>0?seg.slice(nl+1):seg;
      if(lang==='mermaid'||lang==='mmd')o+='<pre class="mermaid-source">'+code+'</pre>';
      else if(lang==='ahd-map')o+='<pre class="map-source">'+code+'</pre>';
      else o+='<div class="codeblock"><div class="cb-head"><span class="cb-lang">'+(lang||'code')+
         '</span><button type="button" class="cb-copy">Copy</button></div><pre><code>'+code+'</code></pre></div>';
    }else{
      o+=parts[i].split(/\\n{2,}/).map(function(block){
        var b=block.replace(/^\\n+|\\n+$/g,'');if(!b.trim())return '';
        var tb=tbl(b);if(tb)return tb;
        if(/^\\s*(?:---+|\\*\\*\\*+|___+)\\s*$/.test(b))return '<hr>';
        if(/^\\s*&gt;/.test(b))return '<blockquote>'+inl(b.replace(/^\\s*&gt;\\s?/gm,'')).replace(/\\n/g,'<br>')+'</blockquote>';
        var s=inl(b)
          .replace(/^\\s*#### (.+)$/gm,'<h4>$1</h4>').replace(/^\\s*### (.+)$/gm,'<h3>$1</h3>')
          .replace(/^\\s*## (.+)$/gm,'<h2>$1</h2>').replace(/^\\s*# (.+)$/gm,'<h2>$1</h2>')
          .replace(/^\\s*\\d+[.)] (.+)$/gm,'<oli>$1</oli>').replace(/^\\s*[-*] (.+)$/gm,'<uli>$1</uli>');
        s=s.replace(/(<oli>[\\s\\S]*?<\\/oli>)(?!\\n?<oli>)/g,function(m){return '<ol>'+m.split('\\n').join('')+'</ol>';}).replace(/oli>/g,'li>');
        s=s.replace(/(<uli>[\\s\\S]*?<\\/uli>)(?!\\n?<uli>)/g,function(m){return '<ul>'+m.split('\\n').join('')+'</ul>';}).replace(/uli>/g,'li>');
        return /^<(h[1-6]|ul|ol|blockquote|hr|div|table)/.test(s.trim())?s:'<p>'+s.replace(/\\n/g,'<br>')+'</p>';}).join('');
    }}
  return o;
}
var ICO={copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>',
         share:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13"/></svg>',
         up:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10v12M15 5l-1 5h6a2 2 0 012 2l-2 7a3 3 0 01-3 2H7V10l5-8a3 3 0 013 3z"/></svg>',
         report:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/></svg>',
         chev:'<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>',
         code:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>',
         wiki:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>',
         docs:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>',
         warn:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
         bolt:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>'};

function addTurn(question,res){
  var turn=document.createElement('div');turn.className='ask-turn';
  turn.innerHTML='<div class="ask-q"><span class="qmark">Q</span><div class="qt">'+esc(question)+'</div></div>'+
    '<div><div class="ask-ans-head"><span class="lbl">Answer</span><span class="flag flag-model"></span></div><div class="ask-direct" data-a></div></div>';
  out.appendChild(turn);
  var target=turn.querySelector('[data-a]');
  if(res)fill(turn,target,res);
  return {turn:turn,target:target};
}
function fill(turn,target,d){
  setFlags(turn,d);
  var h=md(d.answer);
  // The question asked for a chart the tier does not include. Answering in prose
  // and saying nothing would read as the model ignoring the request.
  if(d.vizBlocked)h+='<div class="ask-viz-note">Charts, diagrams, and game maps are a supporter feature, so this one is answered in prose.</div>';
  if(d.reportUrl)h+='<div class="ask-viz-note"><a href="'+esc(d.reportUrl)+'" target="_blank" rel="noopener">Open this report as its own shareable page &rarr;</a></div>';
  var cs=(d.citations||[]);
  if(cs.length){
    // Compact chips stay inline; the full list with kinds folds away so a long
    // source list never buries the answer.
    h+='<div class="srcs">'+cs.slice(0,4).map(function(c){
      return '<a class="src '+esc(c.kind)+'" href="'+esc(c.url)+'" target="_blank" rel="noopener">'+
        (ICO[c.kind]||'')+esc(c.label)+'</a>';}).join('')+'</div>';
    h+='<details class="srcpanel"><summary>'+ICO.chev+'Sources used ('+cs.length+')</summary>'+
      cs.map(function(c){
        return '<div class="srcrow"><span class="srckind '+esc(c.kind)+'">'+esc(c.kind)+'</span>'+
          '<a href="'+esc(c.url)+'" target="_blank" rel="noopener">'+esc(c.label)+'</a></div>';
      }).join('')+'</details>';
  }
  (d.conflicts||[]).forEach(function(c){
    h+='<div class="conflict">'+ICO.warn+'<div><b>Documentation may be out of date.</b> The '+esc(c.source)+
       (c.page?' page “'+esc(c.page)+'”':'')+' says '+esc(c.claim)+', but the game code does: '+esc(c.actual)+
       '. This has been flagged for review.</div></div>';});
  var meta='';
  (d.areas||[]).forEach(function(a){meta+='<span class="area">'+ICO.docs+esc(a)+'</span>';});
  if(d.cached)meta+='<span class="cachedtag">from cache</span>';
  if(d.usedMcp)meta+='<span class="cachedtag">live data</span>';
  if((d.followups||[]).length){
    h+='<div class="sugg"><span class="sugg-lbl">Ask next</span>'+
       d.followups.map(function(f){return '<button class="fchip" type="button" data-sugg>'+
         ICO.chev+esc(f)+'</button>';}).join('')+'</div>';
  }
  if(d.liveHint){
    var lh=d.liveHint, lbl=(lh&&lh.label)||'Answer with live game data',
        note=(lh&&lh.note)||'Looks like a question about your current game.';
    h+='<div class="livehint"><button class="lh-btn" type="button" data-livehint>'+ICO.bolt+
       esc(lbl)+'</button>'+
       '<span class="lh-note">'+esc(note)+'</span></div>';
  }
  target.innerHTML=h+(meta?'<div class="ask-meta">'+meta+'</div>':'');
  renderMermaidIn(target);
  renderMapsIn(target);
  if(window.annotateJargon)try{window.annotateJargon(target);}catch(e){}
  // Answer toolbar lives in the header row so it does not move as text streams.
  var head=turn.querySelector('.ask-ans-head');
  if(head&&!head.querySelector('.ans-tools')){
    var answerId=Number(d.answerId||d.id||0);
    var tools=document.createElement('span'); tools.className='ans-tools';
    tools.innerHTML='<button class="tbtn" data-copy>'+ICO.copy+'Copy</button>'+
      '<button class="tbtn" data-share>'+ICO.share+'Share</button>'+
      (answerId?'<button class="tbtn" data-feedback="up">'+ICO.up+'Helpful</button><button class="tbtn" data-feedback="down">'+ICO.report+'Report</button>':'');
    head.appendChild(tools);
    tools.querySelector('[data-copy]').onclick=function(){
      navigator.clipboard.writeText(d.answer||'').then(function(){
        this.classList.add('ok'); this.lastChild.textContent='Copied';
        var b=this; setTimeout(function(){b.classList.remove('ok');b.lastChild.textContent='Copy';},1500);
      }.bind(tools.querySelector('[data-copy]')));
    };
    tools.querySelector('[data-share]').onclick=function(){
      var b=this;
      fetch('/api/conversation/share',{method:'POST',headers:{'Content-Type':'application/json'},
        credentials:'same-origin',body:JSON.stringify({id:convId})})
        .then(function(r){return r.json();})
        .then(function(x){
          if(!x.url){toast('Could not create a link.');return;}
          navigator.clipboard.writeText(x.url).then(function(){toast('Share link copied');});
          b.classList.add('ok'); b.lastChild.textContent='Copied';
          setTimeout(function(){b.classList.remove('ok');b.lastChild.textContent='Share';},1800);
        }).catch(function(){toast('Could not create a link.');});
    };
    tools.querySelectorAll('[data-feedback]').forEach(function(button){
      button.onclick=function(){
        if(button.dataset.feedback==='down'){openFeedback(answerId,button);return;}
        fetch('/api/answer/feedback',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',
          body:JSON.stringify({answerId:answerId,rating:'up',reason:''})})
          .then(function(r){if(!r.ok)throw new Error();button.classList.add('ok');toast('Marked helpful. Thank you.');})
          .catch(function(){toast('Could not save feedback.');});
      };
    });
  }
}

function chooseStarter(e){
  var b=e.target.closest('.starter-card'); if(!b)return;
  if(b.dataset.live==='true'&&!live.disabled){live.checked=true;localStorage.setItem('ask.live','true');syncLiveMode();}
  closeQuestions();q.value=b.dataset.question||'';submit();
}
starters.addEventListener('click',chooseStarter);
libraryQuestions.addEventListener('click',chooseStarter);
q.addEventListener('input',function(){q.style.height='auto';q.style.height=Math.min(q.scrollHeight,160)+'px';go.disabled=q.value.trim().length<5;
  var n=q.value.length;
  if(n>=420){qcount.hidden=false;qcount.textContent=n+' / 500';qcount.classList.toggle('max',n>=500);}
  else{qcount.hidden=true;}});
// Jump-to-latest pill: appears once the reader has scrolled well above the
// bottom of a conversation, so streamed answers are never silently missed.
body.addEventListener('scroll',function(){
  var far=body.scrollHeight-body.scrollTop-body.clientHeight>400;
  jump.classList.toggle('show',far&&out.children.length>0);
},{passive:true});
jump.addEventListener('click',function(){body.scrollTo({top:body.scrollHeight,behavior:'smooth'});});
q.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();submit();}});
f.addEventListener('submit',function(e){e.preventDefault();submit();});
document.addEventListener('keydown',function(e){
  if(e.key==='/'&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)){
    e.preventDefault();q.focus();
  }
});
function toast(msg){
  var el=document.getElementById('toast');
  if(!el){el=document.createElement('div');el.id='toast';el.className='toast';el.setAttribute('role','status');el.setAttribute('aria-live','polite');document.body.appendChild(el);}
  el.textContent=msg; el.classList.add('show');
  clearTimeout(el._t); el._t=setTimeout(function(){el.classList.remove('show');},2200);
}
// Report-answer dialog. Replaces window.prompt: a reason chip plus optional
// detail, sent as one reason string the console already displays.
var fbTarget=null;
function openFeedback(answerId,button){
  fbTarget={answerId:answerId,button:button};
  fbPanel.querySelectorAll('.fb-tag').forEach(function(t){t.classList.remove('active');});
  document.getElementById('fbText').value='';
  fbPanel.classList.add('open');
  document.getElementById('fbText').focus();
}
function closeFeedback(){fbPanel.classList.remove('open');fbTarget=null;}
fbPanel.addEventListener('click',function(e){if(e.target===fbPanel)closeFeedback();});
document.getElementById('fbClose').onclick=closeFeedback;
document.getElementById('fbCancel').onclick=closeFeedback;
document.getElementById('fbTags').addEventListener('click',function(e){
  var tag=e.target.closest('.fb-tag');if(!tag)return;
  var was=tag.classList.contains('active');
  fbPanel.querySelectorAll('.fb-tag').forEach(function(t){t.classList.remove('active');});
  if(!was)tag.classList.add('active');
});
document.getElementById('fbSend').onclick=function(){
  if(!fbTarget)return;
  var t=fbTarget,tag=fbPanel.querySelector('.fb-tag.active');
  var reason=[tag?tag.textContent.trim():'',document.getElementById('fbText').value.trim()].filter(Boolean).join(': ');
  fetch('/api/answer/feedback',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',
    body:JSON.stringify({answerId:t.answerId,rating:'down',reason:reason})})
    .then(function(r){if(!r.ok)throw new Error();t.button.classList.add('bad');toast('Answer reported. Thank you.');})
    .catch(function(){toast('Could not save feedback.');});
  closeFeedback();
};
// The 12-bar classic spinner, built once. Each bar is rotated into place and its
// fade is delayed by a twelfth of the cycle so the lit bar chases around.
var CLASSIC_SPIN=(function(){var b='';for(var i=0;i<12;i++){
  b+='<i style="transform:rotate('+(i*30)+'deg) translate(146%);animation-delay:'+(0.1*(i-12)).toFixed(2)+'s"></i>';}
  return '<span class="classic" role="status" aria-label="Loading"><span class="classic-in">'+b+'</span></span>';})();
function loadingHtml(label){
  return '<div class="ask-loading"><div class="ask-load-row">'+CLASSIC_SPIN
    +'<span class="shimmer lbl">'+esc(label)+'</span>'
    +'<span class="ask-actions-toggle" hidden></span></div>'
    +'<ul class="ask-actions" hidden></ul></div>';
}
// Update the state text WITHOUT re-rendering the spinner, so its animation never
// restarts as the server narrates each phase.
function setLoading(target,label){
  var lbl=target.querySelector('.ask-loading .lbl');
  if(lbl){lbl.textContent=label;} else {target.innerHTML=loadingHtml(label);}
}
// A small monochrome icon per tool call, chosen from the tool name.
var A_ICONS={
  search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/>',
  building:'<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h.01M9 11h.01M9 15h.01M15 7h.01M15 11h.01M15 15h.01"/>',
  ballot:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>',
  chart:'<path d="M3 20h18"/><path d="M6 20V13M12 20V6M18 20V10"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c3 3 3 15 0 18c-3-3-3-15 0-18z"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>',
  tool:'<circle cx="12" cy="12" r="2.5"/>'
};
function actionIcon(name){
  var n=String(name||'').toLowerCase(),k='tool';
  if(/search|code/.test(n))k='search';
  else if(/corp/.test(n))k='building';
  else if(/elect|race|approv|part|vote/.test(n))k='ballot';
  else if(/fx|market|extract|sector|bond/.test(n))k='chart';
  else if(/map|geo|countr|overview|region/.test(n))k='globe';
  else if(/player|character|entity|top_/.test(n))k='user';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+A_ICONS[k]+'</svg>';
}
// The live action log. Tap the status text to reveal the last 5 tool calls.
function renderActions(target,actions){
  var row=target.querySelector('.ask-load-row'), tg=target.querySelector('.ask-actions-toggle'), ul=target.querySelector('.ask-actions');
  if(!row||!tg||!ul||!actions.length)return;
  row.classList.add('has-actions'); tg.hidden=false;
  var open=!ul.hidden;
  tg.textContent=(open?'▾ ':'▸ ')+actions.length+' action'+(actions.length===1?'':'s');
  ul.innerHTML=actions.slice(-5).map(function(a){return '<li>'+actionIcon(a.name)+'<span class="a-lbl">'+esc(a.label||'')+'</span></li>';}).join('');
}
out.addEventListener('click',function(e){
  // Tap the status text to expand/collapse the live action log.
  var ar=e.target.closest('.ask-load-row.has-actions');
  if(ar){ var tg=ar.querySelector('.ask-actions-toggle'), ul=ar.parentNode.querySelector('.ask-actions');
    if(tg&&ul){ ul.hidden=!ul.hidden; tg.textContent=(ul.hidden?'▸':'▾')+tg.textContent.slice(1); } return; }
  var lh=e.target.closest('[data-livehint]');
  if(lh){ var tn=lh.closest('.ask-turn'); var qq=tn&&tn.querySelector('.qt');
    if(qq){ live.checked=true;localStorage.setItem('ask.live','true');syncLiveMode();q.value=qq.textContent.trim();submit(); } return; }
  var sg=e.target.closest('[data-sugg]');
  if(sg){ q.value=sg.textContent.trim(); submit(); return; }
  var b=e.target.closest('.cb-copy'); if(!b)return;
  var c=b.closest('.codeblock').querySelector('code');
  navigator.clipboard.writeText(c.innerText||'').then(function(){b.textContent='Copied';b.classList.add('copied');
    setTimeout(function(){b.textContent='Copy';b.classList.remove('copied');},1400);});});

function submit(){
  var text=q.value.trim(); if(text.length<5||busy)return;
  busy=true;hero.style.display='none';starterExplorer.style.display='none';go.disabled=true;
  var t=addTurn(text,null);
  // The server narrates each phase over its own status events. This client-side
  // cycle is only a fallback for the brief gap before the stream connects; it is
  // retired the moment the first real status arrives.
  var stages=live.checked?['Pulling up the live game state…','Cross-checking what\\'s actually happening…','Weighing the numbers…']
    :['Digging into the rules…','Piecing together how it works…','Double-checking the details…'];
  var stage=0,serverStatus=false;
  var loadingTimer=setInterval(function(){if(serverStatus)return;stage=(stage+1)%stages.length;setLoading(t.target,stages[stage]);},2200);
  t.target.innerHTML=loadingHtml(stages[0]);
  q.value='';q.style.height='auto';qcount.hidden=true;body.scrollTop=body.scrollHeight;
  var acc='', meta0=null, ctrl=new AbortController(),hasDelta=false,terminal=false,actions=[];
  var stopped=false;
  // While generating, the send button IS the stop button: red, square glyph.
  var sendSvg=go.innerHTML;
  go.classList.add('stopping'); go.disabled=false;
  go.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';
  go.setAttribute('aria-label','Stop generating');
  var prevGo=go.onclick;
  // Stop is a deliberate cancel: tell the server to abort THIS generation (so it
  // records nothing and costs no quota) and let it close the stream. Only if the
  // request id has not arrived yet do we fall back to tearing down the fetch.
  go.onclick=function(ev){ ev.preventDefault(); stopped=true;
    var rid=meta0&&meta0.reqId;
    if(rid){ fetch('/api/ask/stop',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({reqId:rid})}).catch(function(){}); }
    else { ctrl.abort(); } };
  fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',
    signal:ctrl.signal,
    body:JSON.stringify({question:text,style:S.style,length:S.length,useMcp:live.checked,visualizations:visualizations.checked,convId:convId,game:GAME.id})})
  .then(function(r){
    // Non-streaming replies (cache hits, quota refusals) still come back as JSON.
    var ct=r.headers.get('content-type')||'';
    if(ct.indexOf('text/event-stream')<0){
      return r.json().then(function(d){
        clearInterval(loadingTimer);
        if(d.usage)paintQuota(d.usage);
        if(!r.ok){ if(d.signedOut){location.href='/auth/login';return;}
          t.target.innerHTML='<div class="ask-err">'+esc(d.error||'Something went wrong.')+'</div>';return; }
        if(!convId)convId=d.convId;
        fill(t.turn,t.target,d); turnsInThread++; paintCost(); body.scrollTop=body.scrollHeight;
      });
    }
    var reader=r.body.getReader(), dec=new TextDecoder(), buf='';
    var stick=true;
    body.addEventListener('scroll',function(){
      stick=(body.scrollHeight-body.scrollTop-body.clientHeight)<80;
    },{passive:true});
    // Coalesce delta rendering onto one animation frame. Tokens arrive faster than
    // a full md(acc) reparse + innerHTML swap can run, and on long (deep-tier)
    // answers rendering on every token is O(n^2) on the main thread — it pins the
    // tab and OOMs mobile to a white page. Render at most once per frame instead.
    var renderQueued=false;
    var raf=window.requestAnimationFrame?window.requestAnimationFrame.bind(window):function(fn){return setTimeout(fn,16);};
    var caf=window.cancelAnimationFrame?window.cancelAnimationFrame.bind(window):clearTimeout;
    var rafId=0;
    function flushRender(){
      renderQueued=false;
      if(terminal||stopped)return;
      t.target.innerHTML=md(acc);
      if(stick)body.scrollTop=body.scrollHeight;
    }
    function scheduleRender(){ if(renderQueued)return; renderQueued=true; rafId=raf(flushRender); }
    function cancelRender(){ if(renderQueued){caf(rafId);renderQueued=false;} }
    function pump(){
      return reader.read().then(function(res){
        if(res.done){if(!terminal)throw new Error('stream ended before completion');return;}
        buf+=dec.decode(res.value,{stream:true});
        var parts=buf.split('\\n\\n'); buf=parts.pop();
        parts.forEach(function(block){
          var ev='message', data='';
          block.split('\\n').forEach(function(line){
            if(line.indexOf('event:')===0)ev=line.slice(6).trim();
            else if(line.indexOf('data:')===0)data+=line.slice(5).trim();
          });
          if(!data)return;
          var d; try{d=JSON.parse(data);}catch(e){return;}
          if(ev==='meta'){ meta0=d; if(!convId)convId=d.convId;
            setFlags(t.turn,d);
            if(!hasDelta&&d.status){serverStatus=true;setLoading(t.target,d.status);} }
          else if(ev==='status'){ if(!hasDelta&&d.label){serverStatus=true;setLoading(t.target,d.label);} }
          else if(ev==='action'){ if(!hasDelta&&d.label){actions.push(d);renderActions(t.target,actions);} }
          else if(ev==='delta'){ if(!hasDelta){hasDelta=true;clearInterval(loadingTimer);} acc+=d; scheduleRender(); }
          else if(ev==='error'){ terminal=true;clearInterval(loadingTimer);cancelRender();t.target.innerHTML='<div class="ask-err">'+esc(d.error)+'</div>'; }
          else if(ev==='done'){
            terminal=true;clearInterval(loadingTimer);cancelRender();
            fill(t.turn,t.target,d);
            if(d.usage)paintQuota(d.usage);
            turnsInThread++;
            fuLeft=(typeof d.followupsLeft==='number')?d.followupsLeft:Math.max(0,3-Math.max(0,turnsInThread-1));
            paintCost();
            fetch('/api/conversations').then(function(r){return r.json();})
              .then(function(x){renderConvs(x.conversations||[]);}).catch(function(){});
            if(stick)body.scrollTop=body.scrollHeight;
          }
        });
        return pump();
      });
    }
    return pump();
  })
  .catch(function(){
    clearInterval(loadingTimer);
    if(stopped){
      t.target.innerHTML=acc?md(acc)+'<div class="ask-meta"><span class="cachedtag">stopped</span></div>'
        :'<div class="ask-err">Stopped.</div>';
      return;
    }
    // The server keeps generating after a dropped stream and saves the FULL
    // answer, so poll the conversation for it — whether the stream dropped before
    // the first token or mid-answer (which was truncating long live answers on
    // mobile). While polling we keep the partial (or a reconnecting spinner)
    // on screen; when the complete answer lands it replaces the partial.
    var hadPartial=!!acc;
    if(hadPartial){ t.target.innerHTML=md(acc)+'<div class="ask-err" style="margin-top:10px">Reconnecting to finish the answer…</div>'; }
    else { setLoading(t.target,'Reconnecting…'); }
    var tries=0, delays=[1500,2500,4000,5000,6000,8000,8000,10000,12000];
    (function poll(){
      fetch('/api/conversation?id='+encodeURIComponent(convId||''),{credentials:'same-origin'})
        .then(function(r){return r.ok?r.json():null;})
        .then(function(d){
          var turns=(d&&d.turns)||[], match=null;
          // Prefer a saved answer at least as complete as what we already streamed.
          for(var i=turns.length-1;i>=0;i--){ if(turns[i].question===text&&turns[i].answer&&(turns[i].answer.length>=acc.length-8)){match=turns[i];break;} }
          if(match){fill(t.turn,t.target,{answer:match.answer,areas:match.areas,citations:match.citations,cached:false,model:match.model});return;}
          if(tries<delays.length){setTimeout(poll,delays[tries++]);}
          else if(hadPartial){ t.target.innerHTML=md(acc)+'<div class="ask-err" style="margin-top:10px">Connection dropped mid-answer. The full version may be in your history shortly.</div>'; }
          else t.target.innerHTML='<div class="ask-err">Connection dropped before the answer arrived. It may still be saved — check your history in a moment, or try again.</div>';
        })
        .catch(function(){ if(tries<delays.length){setTimeout(poll,delays[tries++]);} else if(!hadPartial) t.target.innerHTML='<div class="ask-err">Connection dropped. Try again.</div>'; });
    })();
  })
  .finally(function(){
    clearInterval(loadingTimer);busy=false;go.classList.remove('stopping'); go.onclick=prevGo||null;
    go.innerHTML=sendSvg; go.setAttribute('aria-label','Ask');
    go.disabled=q.value.trim().length<5; q.focus();
  });
}
go.disabled=true;
})();</script>`;
  return shell(inner + questionPanel + chartViewer, jargonScripts() + js);
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function sharedView(conv) {
  const turns = (conv.turns || []).map(t => `
    <div class="ask-turn">
      <div class="ask-q"><span class="qmark">Q</span><div class="qt">${esc(t.question)}</div></div>
      <div><div class="ask-ans-head">${mark(20)}
        <span class="lbl">Answer</span><span class="flag flag-model">${models.urlFor(t.model)
          ? `<a href="${esc(models.urlFor(t.model))}" target="_blank" rel="noopener">${esc(models.displayFor(t.model))}</a>`
          : esc(models.displayFor(t.model))}</span>
        ${t.id ? `<span class="ans-tools"><button class="tbtn" type="button" data-shared-report="${Number(t.id)}">Report</button></span>` : ""}</div>
        <div class="ask-direct" data-md>${esc(t.answer || "")}</div>
        ${(t.citations || []).length ? `<div class="srcs">${t.citations.map(c =>
          `<a class="src ${esc(c.kind)}" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.label)}</a>`).join("")}</div>` : ""}
      </div>
    </div>`).join("");
  const inner = `<div class="ask-shell">
    <header class="ask-head">
      <span class="ask-brand">${mark(26)}Ask <em>· A House Divided</em></span>
      <span class="ask-head-right"><a class="signin" href="/">Ask your own</a></span>
    </header>
    <div class="ask-body"><div class="ask-col">
      <div class="hero" style="padding-bottom:0">
        <h1>${esc(conv.title || "Shared conversation")}</h1>
        <p>A shared Ask conversation. Answers come from the game's live code.</p>
      </div>
      ${turns || '<p style="color:var(--text-3)">This conversation is empty.</p>'}
    </div></div>
  </div>
  <script>
  // Full rich renderer (tables, headings, callouts, code, Mermaid, maps) so a
  // shared transcript looks identical to the live answer.
  if(window.__hydrateShared)window.__hydrateShared();
  var shareToken=${JSON.stringify(conv.shareToken || "")};
  // Inline report form under the answer header, instead of window.prompt.
  document.querySelectorAll('[data-shared-report]').forEach(function(button){
    button.addEventListener('click',function(){
      if(button.disabled)return;
      var head=button.closest('.ask-ans-head');
      var open=head.parentNode.querySelector('.fb-inline');
      if(open){open.remove();return;}
      var box=document.createElement('div');box.className='fb-inline';
      box.innerHTML='<textarea class="fb-text" rows="2" maxlength="500" placeholder="What was wrong with this answer? (optional)"></textarea>'+
        '<div class="fb-actions"><button class="signout" type="button" data-cancel>Cancel</button><button class="signin" type="button" data-send>Send report</button></div>';
      head.after(box);box.querySelector('textarea').focus();
      box.addEventListener('click',function(e){
        if(e.target.closest('[data-cancel]')){box.remove();return;}
        if(!e.target.closest('[data-send]'))return;
        fetch('/api/shared/feedback',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({shareToken:shareToken,answerId:Number(button.dataset.sharedReport),rating:'down',reason:box.querySelector('textarea').value.trim()})})
          .then(function(response){if(!response.ok)throw new Error();button.classList.add('bad');button.textContent='Reported';button.disabled=true;box.remove();})
          .catch(function(){button.textContent='Could not report';box.remove();});
      });
    });
  });
  </script>`;
  const first = (conv.turns || [])[0] || {};
  const snippet = String(first.answer || "").replace(/[*`#>_]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
  return shell(inner, "", ogHead({
    title: conv.title || first.question || "Shared Ask conversation",
    description: snippet || "A shared Ask conversation. Answers come from the game's live code.",
    image: conv.shareToken ? `${SELF_ORIGIN}/s/${conv.shareToken}/og.png` : undefined,
    url: conv.shareToken ? `${SELF_ORIGIN}/s/${conv.shareToken}` : undefined,
  }) + sharedScripts());
}

// A generated report on its own shareable page. The renderer is deliberately
// self-contained rather than sharing the app's md(): reports need tables and
// h1/h2, which chat answers never use, and the app renderer is entangled with
// the chart-viewer DOM. String.raw keeps the client regexes readable.
function reportView(report) {
  const meta = [
    new Date(report.created).toISOString().slice(0, 10),
    report.model ? models.displayFor(report.model) : null,
    "generated from a live Ask question",
  ].filter(Boolean).join(" · ");
  const inner = `<div class="ask-shell">
    <header class="ask-head">
      <span class="ask-brand">${mark(26)}Ask <em>· A House Divided</em></span>
      <span class="ask-head-right"><a class="signin" href="/">Ask your own</a></span>
    </header>
    <div class="ask-body"><div class="ask-col">
      <div class="hero" style="padding-bottom:6px">
        <div class="hero-kicker">Report</div>
        <p style="color:var(--text-3);font-size:.78rem">Asked: ${esc(report.question)}<br>${esc(meta)}</p>
      </div>
      <div class="ask-direct" id="report-body">${esc(report.body)}</div>
    </div></div>
  </div>
  <script>${String.raw`(function(){
  var el=document.getElementById('report-body');
  function esc(s){var d=document.createElement('div');d.textContent=s==null?'':s;return d.innerHTML;}
  function table(block){
    var lines=block.trim().split('\n');
    if(lines.length<2||!/^\s*\|/.test(lines[0])||!/^\s*\|[\s:|-]+\|\s*$/.test(lines[1]))return null;
    var cells=function(line){return line.replace(/^\s*\||\|\s*$/g,'').split('|').map(function(c){return c.trim();});};
    var head=cells(lines[0]),rows=lines.slice(2).filter(function(l){return /\|/.test(l);}).map(cells);
    return '<div style="overflow:auto"><table class="console-table"><thead><tr>'+head.map(function(h){return '<th>'+inline(h)+'</th>';}).join('')+
      '</tr></thead><tbody>'+rows.map(function(r){return '<tr>'+r.map(function(c){return '<td>'+inline(c)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody></table></div>';
  }
  function inline(s){return s.replace(/\`+([^\`]+)\`+/g,'<code>$1</code>').replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');}
  function md(t){
    var parts=t.split(/\`\`\`/),o='';
    for(var i=0;i<parts.length;i++){
      if(i%2===1){var seg=parts[i],nl=seg.indexOf('\n'),lang=nl>0?seg.slice(0,nl).trim().toLowerCase():'',code=nl>0?seg.slice(nl+1):seg;
        if(lang==='mermaid'||lang==='mmd')o+='<pre class="mermaid-source">'+code+'</pre>';
        else if(lang==='ahd-map')o+='<pre class="map-source">'+code+'</pre>';
        else o+='<div class="codeblock"><pre><code>'+code+'</code></pre></div>';
      }else{
        o+=parts[i].split(/\n{2,}/).map(function(block){
          var tb=table(block);if(tb)return tb;
          var s=inline(block)
            .replace(/^# (.+)$/gm,'<h1>$1</h1>')
            .replace(/^## (.+)$/gm,'<h2>$1</h2>')
            .replace(/^### (.+)$/gm,'<h3>$1</h3>')
            .replace(/^\s*[-*] (.+)$/gm,'<li>$1</li>');
          s=s.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g,'<ul>$1</ul>');
          return /^<(h1|h2|h3|ul|div)/.test(s.trim())?s:'<p>'+s.replace(/\n/g,'<br>')+'</p>';
        }).join('');
      }}
    return o;
  }
  el.innerHTML=md(el.textContent||'');
  if(window.annotateJargon)try{window.annotateJargon(el);}catch(e){}
  function fit(svg){requestAnimationFrame(function(){try{var vb=svg.viewBox&&svg.viewBox.baseVal,box=svg.getBBox();
    if(vb&&box&&box.width&&box.height){var pad=20;svg.setAttribute('viewBox',[Math.min(vb.x,box.x-pad),Math.min(vb.y,box.y-pad),Math.max(vb.width,box.width+2*pad),Math.max(vb.height,box.height+2*pad)].join(' '));}
    svg.removeAttribute('width');svg.removeAttribute('height');}catch(e){}});}
  var mmd=el.querySelectorAll('.mermaid-source');
  if(mmd.length){var s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
    s.onload=function(){var light=document.documentElement.getAttribute('data-theme')==='light';
      var v=light?{background:'#ffffff',primaryColor:'#f2f2f3',primaryTextColor:'#0a0a0a',primaryBorderColor:'#b0b0b0',lineColor:'#8a8a8a',secondaryColor:'#e6e6e7',tertiaryColor:'#f6f6f7',mainBkg:'#f2f2f3',nodeBorder:'#b0b0b0',textColor:'#0a0a0a',fontFamily:'Inter, system-ui, sans-serif'}:{background:'#000000',primaryColor:'#181818',primaryTextColor:'#fafafa',primaryBorderColor:'#5a5a5a',lineColor:'#8a8a8a',secondaryColor:'#101010',tertiaryColor:'#0b0b0b',mainBkg:'#181818',nodeBorder:'#4a4a4a',textColor:'#e8e8e8',fontFamily:'Inter, system-ui, sans-serif'};
      window.mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',themeVariables:v,xyChart:{plotColorPalette:light?'#111111,#666666,#999999,#444444,#bbbbbb,#333333':'#ffffff,#aaaaaa,#777777,#cccccc,#555555,#e0e0e0'}});
      mmd.forEach(function(block,i){var src=block.textContent;var wrap=document.createElement('div');wrap.className='mermaid-wrap';block.replaceWith(wrap);
        window.mermaid.render('report-mmd-'+i,src).then(function(r){wrap.innerHTML=r.svg;var svg=wrap.querySelector('svg');if(svg)fit(svg);})
          .catch(function(){wrap.innerHTML='<div class="mermaid-err">This visualization could not be rendered.</div>';});});};
    document.head.appendChild(s);}
  el.querySelectorAll('.map-source').forEach(function(block){var src=block.textContent;var wrap=document.createElement('div');wrap.className='map-wrap';block.replaceWith(wrap);
    var spec;try{spec=JSON.parse(src);}catch(e){wrap.innerHTML='<div class="mermaid-err">This map could not be rendered.</div>';return;}
    fetch('/api/map/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(spec)})
      .then(function(r){if(!r.ok)throw new Error();return r.text();})
      .then(function(svg){wrap.innerHTML=svg;var s2=wrap.querySelector('svg');if(s2)fit(s2);})
      .catch(function(){wrap.innerHTML='<div class="mermaid-err">This map could not be rendered.</div>';});});
  })();`}</script>`;
  const snippet = String(report.body || "").replace(/[*`#>_|-]/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
  return shell(inner, "", ogHead({
    title: report.title || report.question || "Ask report",
    description: snippet || "A generated report from a live Ask question.",
    image: report.token ? `${SELF_ORIGIN}/r/${report.token}/og.png` : undefined,
    url: report.token ? `${SELF_ORIGIN}/r/${report.token}` : undefined,
  }) + jargonScripts());
}

function consolePage({ identity, context, users = [], selected = null, reports = [], modelStats = [], correctionRows = [] }) {
  const models = require("./models");
  const money = n => `$${Number(n || 0).toFixed(Number(n || 0) < 0.01 ? 4 : 2)}`;
  const when = ts => ts ? new Date(ts).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "Never";
  const num = n => Number(n || 0).toLocaleString();
  const ratePct = (up, down) => { const t = Number(up) + Number(down); return t ? `${Math.round((Number(up) / t) * 100)}%` : "—"; };

  // Actual token usage + helpful/unhelpful, per model.
  const modelRows = modelStats.map(m => `<tr>
    <td>${esc(models.displayFor(m.model))}<div class="console-muted">${esc(m.model)}</div></td>
    <td>${esc(models.providerOf(m.model))}</td>
    <td>${num(m.questions)}</td>
    <td>${num(m.tokens_in)} / ${num(m.tokens_out)}</td>
    <td>${num(m.up)} 👍 / ${num(m.down)} 👎<div class="console-muted">${ratePct(m.up, m.down)} helpful</div></td>
    <td>${money(m.cost)}</td>
  </tr>`).join("") || `<tr><td colspan="6" class="console-muted">No answers yet.</td></tr>`;

  // Real cost by provider (free providers = $0), from actual token totals.
  const providerAgg = {};
  for (const m of modelStats) {
    const prov = models.providerOf(m.model);
    const a = providerAgg[prov] || (providerAgg[prov] = { questions: 0, tokens_in: 0, tokens_out: 0, cost: 0 });
    a.questions += Number(m.questions || 0); a.tokens_in += Number(m.tokens_in || 0);
    a.tokens_out += Number(m.tokens_out || 0); a.cost += Number(m.cost || 0);
  }
  const providerRows = Object.entries(providerAgg).sort((a, b) => b[1].cost - a[1].cost).map(([prov, a]) => `<tr>
    <td>${esc(prov)}</td><td>${num(a.questions)}</td><td>${num(a.tokens_in)} / ${num(a.tokens_out)}</td><td>${money(a.cost)}</td>
  </tr>`).join("") || `<tr><td colspan="4" class="console-muted">No answers yet.</td></tr>`;
  const modelUsageSection = `<section class="console-card"><h2>Usage by model</h2>
    <div style="overflow:auto"><table class="console-table"><thead><tr><th>Model</th><th>Provider</th><th>Questions</th><th>Tokens in / out</th><th>Helpful / reported</th><th>Cost</th></tr></thead><tbody>${modelRows}</tbody></table></div>
    <h2 style="margin-top:18px">Cost by provider</h2>
    <div style="overflow:auto"><table class="console-table"><thead><tr><th>Provider</th><th>Questions</th><th>Tokens in / out</th><th>Cost</th></tr></thead><tbody>${providerRows}</tbody></table></div>
  </section>`;
  const totalQuestions = users.reduce((n, u) => n + Number(u.question_count || 0), 0);
  const totalReports = users.reduce((n, u) => n + Number(u.report_count || 0), 0);
  const totalCost = users.reduce((n, u) => n + Number(u.estimated_cost || 0), 0);
  const totalTokens = users.reduce((n, u) => n + Number(u.tokens_in || 0) + Number(u.tokens_out || 0), 0);
  const rows = users.map(u => `<tr>
    <td><a class="console-user" href="/console?user=${encodeURIComponent(u.user_key)}">${esc(u.username || u.user_key)}</a><div class="console-muted">${esc(u.role || u.provider || "player")}</div></td>
    <td>${Number(u.question_count || 0).toLocaleString()}</td>
    <td>${Number(u.live_count || 0).toLocaleString()}</td>
    <td>${Number(u.report_count || 0).toLocaleString()}</td>
    <td>${Number(u.tokens_in || 0).toLocaleString()} / ${Number(u.tokens_out || 0).toLocaleString()}</td>
    <td>${money(u.estimated_cost)}</td>
    <td class="console-muted">${esc(when(u.last_question || u.last_seen))}</td>
  </tr>`).join("");
  let detail = `<div class="console-profile"><h3>Select a user</h3><p class="console-muted">Click a name to see their profile and questions.</p></div>`;
  if (selected) {
    const p = selected.profile;
    const facts = [p.character_name, p.country, p.party, p.corporation_name && `${p.corporation_role || "member"} of ${p.corporation_name}`, p.tier]
      .filter(Boolean).map(x => `<span class="console-fact">${esc(x)}</span>`).join("");
    const questions = selected.questions.map(q => `<div class="console-question">
      <b>${esc(q.question)}</b>
      <small>${esc(when(q.ts))} · ${esc(modelRouter.label(q.model))} ${esc(require("./models").displayFor(q.model))}${q.used_mcp ? " · live data" : ""}${q.cached ? " · cached" : ""} · ${money(q.estimated_cost)}${q.feedback_rating === "down" ? ` · Reported by ${esc(q.feedback_source || "user")}` : q.feedback_rating === "up" ? " · Helpful" : ""}${q.plan?.id ? ` · plan: ${esc(q.plan.id)}` : ""}</small>
      ${q.feedback_rating === "down" ? `<div class="conflict"><div><b>Bad answer report</b>${q.feedback_reason ? `: ${esc(q.feedback_reason)}` : ""}</div></div>` : ""}
      ${q.evidence?.tools?.length ? `<div class="console-muted" style="font-size:.68rem;margin-top:5px">Live tools: ${esc(q.evidence.tools.join(", "))}${q.evidence.visualizations?.length ? ` · visual: ${esc(q.evidence.visualizations.map(v => v.metric || v.recommended).join(", "))}` : ""}</div>` : ""}
      <div class="console-answer">${esc(q.answer || "No answer stored.")}</div>
    </div>`).join("") || `<div class="console-question console-muted">No questions yet.</div>`;
    detail = `<div class="console-profile"><h3>${esc(p.username || p.user_key)}</h3><div class="console-muted">${esc(p.user_key)}</div>
      <div class="console-facts">${facts}</div><div class="console-muted">First seen ${esc(when(p.first_seen))} · Last seen ${esc(when(p.last_seen))} · Estimated cost ${money(selected.estimated_cost)}</div></div>${questions}`;
  }
  const reportQueue = reports.length ? reports.map(cluster => `<div class="console-cluster"><h3>${esc(cluster.category)} <span>· ${Number(cluster.count).toLocaleString()} report${cluster.count === 1 ? "" : "s"}</span></h3>${cluster.reports.map(report => `<div class="console-report"><b>${esc(report.question)}</b>${report.feedback_reason ? `<div>“${esc(report.feedback_reason)}”</div>` : ""}<div class="console-muted">${esc(report.username || report.user_key)} · ${esc(when(report.feedback_ts || report.ts))}${report.plan?.id ? ` · plan: ${esc(report.plan.id)}` : ""}</div><a class="console-replay" href="/?replay=${encodeURIComponent(report.question)}">Open replay</a></div>`).join("")}</div>`).join("") : `<div class="console-question console-muted">No reports yet.</div>`;
  return shell(`<div class="console-shell"><div class="console-wrap">
    <div class="console-top"><div><div class="hero-kicker">Admin</div><h1>Ask console</h1></div><a class="console-link" href="/">Back to Ask</a></div>
    <div class="console-stats">
      <div class="console-stat"><small>Users</small><b>${users.length.toLocaleString()}</b></div>
      <div class="console-stat"><small>Questions</small><b>${totalQuestions.toLocaleString()}</b></div>
      <div class="console-stat"><small>Reports</small><b>${totalReports.toLocaleString()}</b></div>
      <div class="console-stat"><small>Tokens</small><b>${totalTokens.toLocaleString()}</b></div>
      <div class="console-stat"><small>Rough API cost</small><b>${money(totalCost)}</b></div>
    </div>
    <p class="console-muted" style="font-size:.7rem;margin:-8px 0 14px">Cost is actual token usage × provider rate. Google Gemini (free tier) and OpenRouter free/stealth slugs bill nothing, so they are $0 — the real spend is the DeepSeek fallback, priced at its cache-miss list rate. Cached reads carry no tokens or cost.</p>
    ${modelUsageSection}
    <div class="console-grid"><section class="console-card"><h2>Users</h2><div style="overflow:auto"><table class="console-table"><thead><tr><th>User</th><th>Questions</th><th>Live</th><th>Reports</th><th>Tokens in / out</th><th>Cost</th><th>Last active</th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="console-muted">No users yet.</td></tr>`}</tbody></table></div></section>
      <section class="console-card"><h2>User profile and questions</h2>${detail}</section></div>
    <section class="console-card console-reports"><h2>Reported-answer queue</h2>${reportQueue}</section>
    <section class="console-card console-reports"><h2>Corrections (memory)</h2>
      <p class="console-muted" style="font-size:.72rem">Staff-verified lessons. A future question semantically close to the recorded one gets the verified truth injected above the retrieved code.</p>
      <form id="corr-form" style="display:grid;gap:8px;margin:10px 0 16px">
        <input name="question" placeholder="Question this lesson applies to" required style="padding:8px;border:1px solid var(--border);border-radius:6px;background:transparent;color:inherit">
        <textarea name="correction" placeholder="The verified truth, written for the model" required rows="2" style="padding:8px;border:1px solid var(--border);border-radius:6px;background:transparent;color:inherit"></textarea>
        <button class="tbtn" type="submit" style="justify-self:start">Add correction</button>
      </form>
      ${(() => {
        const isDraft = c => !c.active && String(c.correction || "").startsWith("[DRAFT]");
        const drafts = correctionRows.filter(isDraft);
        const settled = correctionRows.filter(c => !isDraft(c));
        const draftBlock = drafts.length ? `<div class="console-drafts"><h3 style="font-size:.9rem;margin:6px 0">Review queue — auto-drafted from reports (${drafts.length})</h3>
        ${drafts.map(c => `<div class="console-question console-draft" data-draft="${c.id}">
          <b>${esc(c.question)}</b>
          <div class="console-answer console-muted" style="font-size:.75rem">${esc(c.correction)}</div>
          <textarea class="draft-body" placeholder="Write the verified truth for the model, then activate." rows="2" style="width:100%;margin:6px 0;padding:8px;border:1px solid var(--border);border-radius:6px;background:transparent;color:inherit"></textarea>
          <small>${esc(when(c.created))} · from answer #${esc(String(c.source_answer_id || "?"))} · <a href="#" class="console-replay draft-activate" data-draft-id="${c.id}">Activate</a> · <a href="#" class="console-replay" data-corr-toggle="${c.id}" data-corr-active="0">Discard</a></small>
        </div>`).join("")}</div>` : "";
        const settledBlock = settled.map(c => `<div class="console-question${c.active ? "" : " console-muted"}">
          <b>${esc(c.question)}</b>
          <div class="console-answer">${esc(c.correction)}</div>
          <small>${esc(when(c.created))} · ${esc(c.added_by || "staff")}${c.active ? "" : " · disabled"} · <a href="#" class="console-replay" data-corr-toggle="${c.id}" data-corr-active="${c.active ? 0 : 1}">${c.active ? "Disable" : "Enable"}</a></small>
        </div>`).join("") || `<div class="console-question console-muted">No corrections yet.</div>`;
        return draftBlock + settledBlock;
      })()}
    </section>
    <script>
    document.getElementById('corr-form').addEventListener('submit',function(e){e.preventDefault();
      var f=e.target;fetch('/api/corrections',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',
        body:JSON.stringify({question:f.question.value,correction:f.correction.value})})
        .then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);else location.reload();});
    });
    document.querySelectorAll('[data-corr-toggle]').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();
      fetch('/api/corrections/toggle',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',
        body:JSON.stringify({id:Number(a.dataset.corrToggle),active:a.dataset.corrActive==='1'})})
        .then(function(){location.reload();});
    });});
    document.querySelectorAll('.draft-activate').forEach(function(a){a.addEventListener('click',function(e){e.preventDefault();
      var card=a.closest('[data-draft]'),ta=card&&card.querySelector('.draft-body'),text=ta?ta.value.trim():'';
      if(text.length<8){alert('Write the verified truth first.');if(ta)ta.focus();return;}
      fetch('/api/corrections/resolve',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',
        body:JSON.stringify({id:Number(a.dataset.draftId),correction:text})})
        .then(function(r){return r.json();}).then(function(d){if(d.error)alert(d.error);else location.reload();});
    });});
    </script>
  </div></div>`);
}

module.exports = { app, signedOut, notEntitled, sharedView, reportView, consolePage, changelogPage, esc };

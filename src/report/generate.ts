import { networkEntryToCurl } from "../export/curl.js";
import { buildReproRecipe } from "../export/repro-recipe.js";
import type { SessionData } from "../shared/types.js";

export function generateReportHtml(data: SessionData): string {
  const payload = {
    session: data.session,
    console: data.console,
    network: data.network,
    userActions: data.userActions,
    timeline: data.timeline,
    diagnostics: data.diagnostics,
    domSnapshots: data.domSnapshots,
    curls: data.network.map((n) => ({ id: n.id, curl: networkEntryToCurl(n) })),
    repro: buildReproRecipe(data.userActions),
  };
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Browser Listener Report</title>
<style>
  :root { font-family: system-ui, sans-serif; color-scheme: light dark; }
  body { margin: 0; padding: 16px; max-width: 1200px; }
  h1,h2 { margin-top: 1.2em; }
  nav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  nav a { padding: 6px 10px; border: 1px solid #8885; border-radius: 6px; text-decoration: none; }
  section { margin-bottom: 24px; }
  pre, code { font-family: ui-monospace, monospace; font-size: 12px; }
  pre { overflow: auto; padding: 12px; border-radius: 8px; background: #8881; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #8884; padding: 6px 8px; text-align: left; }
  .health-warn { color: #c60; }
  button { cursor: pointer; padding: 4px 8px; }
</style>
</head>
<body>
<h1>Browser Listener — Investigation Report</h1>
<p>Offline report. No remote telemetry. Data redacted before export.</p>
<nav>
  <a href="#summary">Summary</a>
  <a href="#health">Health</a>
  <a href="#network">Network</a>
  <a href="#console">Console</a>
  <a href="#actions">User actions</a>
  <a href="#repro">Repro recipe</a>
  <a href="#diagnostics">Diagnostics</a>
</nav>
<section id="summary"></section>
<section id="health"></section>
<section id="network"></section>
<section id="console"></section>
<section id="actions"></section>
<section id="repro"><h2>Repro recipe</h2><pre id="repro-pre"></pre></section>
<section id="diagnostics"></section>
<script>
const DATA = ${json};
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
document.getElementById('summary').innerHTML = '<h2>Summary</h2><pre>'+esc(JSON.stringify(DATA.session,null,2))+'</pre>';
const h = DATA.session?.health;
const gaps = h?.partialGaps?.length ?? 0;
document.getElementById('health').innerHTML = '<h2>Capture health</h2><pre class="'+(gaps?'health-warn':'')+'">'+esc(JSON.stringify(h,null,2))+'</pre>';
let net = '<h2>Network explorer</h2><table><tr><th>Method</th><th>URL</th><th>Status</th><th>cURL</th></tr>';
DATA.network.forEach((n,i)=>{const c=DATA.curls.find(x=>x.id===n.id);net+='<tr><td>'+esc(n.method)+'</td><td>'+esc(n.url)+'</td><td>'+esc(String(n.statusCode??''))+'</td><td><button data-i="'+i+'">Copy cURL</button></td></tr>';});
net+='</table>';
document.getElementById('network').innerHTML=net;
document.querySelectorAll('#network button').forEach(btn=>btn.onclick=()=>{const c=DATA.curls[+btn.dataset.i];navigator.clipboard.writeText(c.curl);btn.textContent='Copied';});
let con = '<h2>Console explorer</h2><table><tr><th>Time</th><th>Level</th><th>Message</th></tr>';
DATA.console.forEach(e=>{con+='<tr><td>'+new Date(e.timestamp).toISOString()+'</td><td>'+esc(e.level)+'</td><td>'+esc(e.args.join(' '))+'</td></tr>';});
con+='</table>';
document.getElementById('console').innerHTML=con;
let act = '<h2>User actions</h2><table><tr><th>Time</th><th>Type</th><th>Target</th><th>URL</th></tr>';
DATA.userActions.forEach(a=>{act+='<tr><td>'+new Date(a.timestamp).toISOString()+'</td><td>'+esc(a.type)+'</td><td>'+esc(a.target||'')+'</td><td>'+esc(a.url)+'</td></tr>';});
act+='</table>';
document.getElementById('actions').innerHTML=act;
document.getElementById('repro-pre').textContent=DATA.repro;
document.getElementById('diagnostics').innerHTML='<h2>Diagnostics</h2><pre>'+esc(JSON.stringify(DATA.diagnostics,null,2))+'</pre>';
</script>
</body>
</html>`;
}

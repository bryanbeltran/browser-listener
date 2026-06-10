import { networkEntryToCurl } from "../export/curl.js";
import type { SessionData } from "../shared/types.js";

export function generateReportHtml(data: SessionData): string {
  const fb = data.enrichments?.facebookGroups;
  const payload = {
    session: data.session,
    console: data.console,
    network: data.network,
    timeline: data.timeline,
    diagnostics: data.diagnostics,
    domSnapshots: data.domSnapshots,
    facebookGroups: fb ?? null,
    curls: data.network.map((n) => ({ id: n.id, curl: networkEntryToCurl(n) })),
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
  h1,h2,h3 { margin-top: 1.2em; }
  nav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  nav a { padding: 6px 10px; border: 1px solid #8885; border-radius: 6px; text-decoration: none; }
  section { margin-bottom: 24px; }
  pre, code { font-family: ui-monospace, monospace; font-size: 12px; }
  pre { overflow: auto; padding: 12px; border-radius: 8px; background: #8881; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #8884; padding: 6px 8px; text-align: left; vertical-align: top; }
  .health-warn { color: #c60; }
  .muted { opacity: 0.7; font-size: 12px; }
  .post-block { margin: 16px 0; padding: 12px; border: 1px solid #8884; border-radius: 8px; }
  .post-block h4 { margin: 0 0 8px; font-size: 14px; }
  button { cursor: pointer; padding: 4px 8px; }
</style>
</head>
<body>
<h1>Browser Listener — Investigation Report</h1>
<p>Offline report. No remote telemetry. Data redacted before export.</p>
<p><label>Filter tables <input type="search" id="filter" placeholder="Search events…" style="width:100%;max-width:320px;padding:6px" /></label></p>
<nav>
  <a href="#summary">Summary</a>
  <a href="#health">Health</a>
  <a href="#facebook">Facebook</a>
  <a href="#network">Network</a>
  <a href="#console">Console</a>
  <a href="#diagnostics">Diagnostics</a>
</nav>
<section id="summary"></section>
<section id="health"></section>
<section id="facebook"></section>
<section id="network"></section>
<section id="console"></section>
<section id="diagnostics"></section>
<script>
const DATA = ${json};
function esc(s){const d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML;}
function table(headers, rows){
  let h='<table><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr>';
  for(const row of rows) h+='<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>';
  return h+'</table>';
}
document.getElementById('summary').innerHTML = '<h2>Summary</h2><pre>'+esc(JSON.stringify(DATA.session,null,2))+'</pre>';
const h = DATA.session?.health;
const gaps = h?.partialGaps?.length ?? 0;
document.getElementById('health').innerHTML = '<h2>Capture health</h2><pre class="'+(gaps?'health-warn':'')+'">'+esc(JSON.stringify(h,null,2))+'</pre>';
const fb = DATA.facebookGroups;
let fbHtml = '<h2>Facebook group activity</h2>';
if(!fb){ fbHtml += '<p class="muted">No Facebook GraphQL activity parsed for this session.</p>'; }
else {
  if(fb.parseWarnings?.length) fbHtml += '<p class="health-warn"><strong>Parse warnings:</strong> '+fb.parseWarnings.map(esc).join(' · ')+'</p>';
  if(fb.sessionPermalink) fbHtml += '<p class="muted">Session permalink: <a href="'+esc(fb.sessionPermalink)+'">'+esc(fb.sessionPermalink)+'</a></p>';
  if(fb.groups.length) fbHtml += '<h3>Groups ('+fb.groups.length+')</h3>'+table(['Name','ID','URL'], fb.groups.map(g=>[esc(g.name||''), esc(g.id), g.url?'<a href="'+esc(g.url)+'">'+esc(g.url)+'</a>':'']));
  if(fb.graphqlQueryHints?.length) fbHtml += '<h3>GraphQL queries</h3>'+table(['Friendly name','doc_id','Count'], fb.graphqlQueryHints.map(q=>[esc(q.friendlyName||''), esc(q.docId), esc(q.count)]));
  if(fb.people.length) fbHtml += '<h3>People ('+fb.people.length+')</h3>'+table(['Name','ID','Source'], fb.people.map(p=>[esc(p.name), esc(p.id), esc(p.source)]));
  if(fb.posts.length) {
    fbHtml += '<h3>Posts ('+fb.posts.length+')</h3>';
    for (const p of fb.posts) {
      const bits = [];
      if (p.commentCount) bits.push(p.commentCount+' comment'+(p.commentCount===1?'':'s'));
      if (p.reactionCount) bits.push(p.reactionCount+' reaction'+(p.reactionCount===1?'':'s'));
      fbHtml += '<div class="post-block"><h4>'+esc(p.authorName||'Post')+' <span class="muted">'+esc(p.postId||'')+'</span></h4>';
      if (bits.length) fbHtml += '<p class="muted">'+esc(bits.join(' · '))+'</p>';
      if (p.text) fbHtml += '<p>'+esc(p.text.slice(0,500))+'</p>';
      if (p.url) fbHtml += '<p><a href="'+esc(p.url)+'">Open post</a></p>';
      if (p.partialParse) fbHtml += '<p class="health-warn">Partial parse</p>';
      if (p.linkedComments?.length) {
        fbHtml += '<p><strong>Comments</strong></p>'+table(['Author','Text'], p.linkedComments.map(c=>[esc(c.authorName||''), esc((c.text||'').slice(0,200))]));
      }
      if (p.linkedReactions?.length) {
        fbHtml += '<p><strong>Reactions</strong></p>'+table(['User'], p.linkedReactions.map(r=>[esc(r.userName)]));
      }
      fbHtml += '</div>';
    }
  }
  if(fb.reactions.length) fbHtml += '<h3>All reactions ('+fb.reactions.length+')</h3>'+table(['User','Post ID','Total','Source'], fb.reactions.map(r=>[esc(r.userName), esc(r.postId||''), esc(r.reactionCount??''), esc(r.source)]));
  if(!fb.groups.length && !fb.people.length && !fb.posts.length && !fb.reactions.length && !fb.comments.length) fbHtml += '<p class="muted">GraphQL captured but no group entities extracted yet.</p>';
}
document.getElementById('facebook').innerHTML = fbHtml;
let net = '<h2>Network explorer</h2><table><tr><th>Method</th><th>URL</th><th>Status</th><th>cURL</th></tr>';
DATA.network.forEach((n,i)=>{const c=DATA.curls.find(x=>x.id===n.id);net+='<tr><td>'+esc(n.method)+'</td><td>'+esc(n.url)+'</td><td>'+esc(String(n.statusCode??''))+'</td><td><button data-i="'+i+'">Copy cURL</button></td></tr>';});
net+='</table>';
document.getElementById('network').innerHTML=net;
document.querySelectorAll('#network button').forEach(btn=>btn.onclick=()=>{const c=DATA.curls[+btn.dataset.i];navigator.clipboard.writeText(c.curl);btn.textContent='Copied';});
let con = '<h2>Console explorer</h2>';
if(!DATA.console.length) con += '<p class="muted">Console capture was off or no messages recorded.</p>';
else {
  con += '<table><tr><th>Time</th><th>Level</th><th>Message</th><th>Stack</th></tr>';
  DATA.console.forEach(e=>{con+='<tr><td>'+new Date(e.timestamp).toISOString()+'</td><td>'+esc(e.level)+'</td><td>'+esc(e.args.join(' '))+'</td><td><pre>'+esc(e.stack||'')+'</pre></td></tr>';});
  con+='</table>';
}
document.getElementById('console').innerHTML=con;
document.getElementById('diagnostics').innerHTML='<h2>Diagnostics</h2><pre>'+esc(JSON.stringify(DATA.diagnostics,null,2))+'</pre>';
document.getElementById('filter').oninput=(e)=>{const q=e.target.value.toLowerCase();document.querySelectorAll('table tr').forEach((row,i)=>{if(i===0)return;row.style.display=!q||row.textContent.toLowerCase().includes(q)?'':'none';});};
</script>
</body>
</html>`;
}

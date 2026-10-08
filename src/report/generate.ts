import { buildCoverageReport } from "../export/coverage.js";
import type { CoverageReport, SessionData } from "../shared/types.js";

export function generateReportHtml(
  data: SessionData,
  coverage: CoverageReport = buildCoverageReport(data),
): string {
  const reportNetwork = data.network.map((entry) => {
    const copy = { ...entry };
    delete copy.requestBody;
    delete copy.responseBody;
    return copy;
  });
  const reportConsole = data.console.map((entry) => {
    const copy = { ...entry };
    delete copy.args;
    delete copy.stackTrace;
    return copy;
  });
  const summary = {
    session: data.session,
    coverage,
    navigation: data.navigation,
    console: reportConsole,
    network: reportNetwork,
  };
  const json = JSON.stringify(summary).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Browser Listener — Local Session Report</title>
<style>
  :root { font-family: system-ui, sans-serif; color-scheme: light dark; }
  body { margin: 0; padding: 16px; max-width: 1280px; }
  h1,h2,h3 { margin-top: 1.2em; }
  nav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  nav a { padding: 6px 10px; border: 1px solid #8885; border-radius: 6px; text-decoration: none; }
  section { margin-bottom: 24px; }
  pre { font: 12px ui-monospace, monospace; overflow: auto; padding: 12px; border-radius: 8px; background: #8881; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #8884; padding: 6px 8px; text-align: left; vertical-align: top; }
  .health-warn { color: #c60; }
  .muted { opacity: 0.7; font-size: 12px; }
  .stat-grid { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0; }
  .stat { padding: 8px 12px; border: 1px solid #8884; border-radius: 8px; }
  .search-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
  .search-controls input { min-width: 280px; max-width: 100%; padding: 7px 9px; border: 1px solid #8886; border-radius: 6px; font: inherit; }
  .event-row[hidden] { display: none; }
  .action-button { padding: 7px 10px; border: 1px solid #8886; border-radius: 6px; cursor: pointer; font: inherit; }
  .citation-status { margin-left: 8px; }
</style>
</head>
<body>
<h1>Browser Listener — Local Session Report</h1>
<p class="muted">Local export only. No remote telemetry. Capture only pages and data you are authorized to collect.</p>
<nav>
  <a href="#summary">Summary</a>
  <a href="#coverage">Coverage</a>
  <a href="#timeline">Timeline</a>
  <a href="#health">Health</a>
</nav>
<section id="summary"></section>
<section id="coverage"></section>
<section id="timeline"></section>
<section id="health"></section>
<script>
const DATA = ${json};
function esc(s){const d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML;}
function formatDate(value){return value?new Date(value).toLocaleString():'—';}
function safeLink(url){
  if(!url) return '—';
  try { const parsed=new URL(url); if(!['http:','https:'].includes(parsed.protocol)) return esc(url); return '<a href="'+esc(parsed.toString())+'">'+esc(parsed.toString())+'</a>'; }
  catch { return esc(url); }
}
function table(headers, rows){
  let h='<table><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr>';
  for(const row of rows) h+='<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>';
  return h+'</table>';
}
function metricText(metric){return metric && metric.total ? esc(metric.present+'/'+metric.total+' ('+metric.percent+'%)') : '—';}

const s=DATA.session, c=DATA.coverage;
const source=c.source.tabUrl;
let summaryHtml='<h2>Session summary</h2>';
if(s){
  summaryHtml+='<p><strong>Source:</strong> '+safeLink(source)+'</p>';
  summaryHtml+='<p><strong>Captured:</strong> '+formatDate(s.startedAt)+' — '+formatDate(s.stoppedAt)+'</p>';
  summaryHtml+='<p class="muted"><strong>Session:</strong> '+esc(s.id)+'</p>';
}
summaryHtml+='<div class="stat-grid">';
for(const [key,value] of Object.entries(c.totals)) summaryHtml+='<div class="stat"><strong>'+esc(value)+'</strong><br><span class="muted">'+esc(key)+'</span></div>';
summaryHtml+='</div><p><button type="button" class="action-button" id="copy-citation">Copy citation</button><span class="muted citation-status" id="citation-status" aria-live="polite"></span></p>';
document.getElementById('summary').innerHTML=summaryHtml;

let coverageHtml='<h2>Coverage &amp; provenance</h2><p class="muted">Generated '+formatDate(c.generatedAt)+' · schema v'+esc(c.schemaVersion)+'</p>';
coverageHtml+='<h3>Evidence totals</h3>'+table(['Evidence','Count'],Object.entries(c.totals).map(([key,value])=>[esc(key),esc(value)]));
coverageHtml+='<h3>Field coverage</h3>'+table(['Field','Present'],[
  ['Network · status',metricText(c.fields.network.statusCode)],
  ['Network · response headers',metricText(c.fields.network.responseHeaders)],
  ['Network · response body',metricText(c.fields.network.responseBody)],
  ['Navigation · title',metricText(c.fields.navigation.title)],
  ['Navigation · URL',metricText(c.fields.navigation.url)],
  ['Console · text',metricText(c.fields.console.text)],
  ['Console · source',metricText(c.fields.console.source)],
]);
coverageHtml+='<h3>Quality signals</h3>'+table(['Signal','Count'],Object.entries(c.quality).map(([key,value])=>[esc(key),esc(value)]));
document.getElementById('coverage').innerHTML=coverageHtml;

const events=[
  ...DATA.navigation.map(entry=>({time:entry.timestamp,type:'navigation',label:entry.title||entry.url,detail:entry.url})),
  ...DATA.console.map(entry=>({time:entry.timestamp,type:'console '+entry.level,label:entry.text,detail:entry.url||entry.source||''})),
  ...DATA.network.map(entry=>({time:entry.timestamp,type:'network',label:entry.method+' '+entry.type,detail:entry.statusCode+' '+entry.url})),
].sort((a,b)=>a.time-b.time);
let timelineHtml='<h2>Evidence timeline</h2><div class="search-controls"><label for="timeline-search"><strong>Filter evidence</strong></label><input id="timeline-search" type="search" placeholder="Search URL, console text, or event type" /><span id="search-count" class="muted" aria-live="polite"></span></div>';
timelineHtml+='<table><thead><tr><th>Time</th><th>Type</th><th>Evidence</th><th>Source</th></tr></thead><tbody>';
for(const event of events) timelineHtml+='<tr class="event-row"><td>'+esc(formatDate(event.time))+'</td><td>'+esc(event.type)+'</td><td>'+esc(event.label)+'</td><td>'+safeLink(event.detail)+'</td></tr>';
timelineHtml+='</tbody></table>';
document.getElementById('timeline').innerHTML=timelineHtml;

const h=DATA.session?.health, gaps=h?.partialGaps?.length??0;
document.getElementById('health').innerHTML='<h2>Capture health</h2><pre class="'+(gaps?'health-warn':'')+'">'+esc(JSON.stringify(h,null,2))+'</pre>';

const copyButton=document.getElementById('copy-citation'), citationStatus=document.getElementById('citation-status');
async function copyText(value){
  if(navigator.clipboard){await navigator.clipboard.writeText(value);return;}
  const area=document.createElement('textarea');area.value=value;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();const copied=document.execCommand('copy');area.remove();if(!copied)throw new Error('clipboard unavailable');
}
copyButton?.addEventListener('click',async()=>{
  const citation=['Browser Listener capture','Source: '+(source||'unknown'),'Captured: '+formatDate(c.source.startedAt)+' — '+formatDate(c.source.stoppedAt),'Session: '+(s?.id||'unknown')].join('\\n');
  try{await copyText(citation);if(citationStatus)citationStatus.textContent='Copied';}catch{if(citationStatus)citationStatus.textContent='Clipboard unavailable — use export-manifest.json';}
});

const searchInput=document.getElementById('timeline-search'), searchCount=document.getElementById('search-count');
if(searchInput){
  const rows=[...document.querySelectorAll('.event-row')];
  const updateSearch=()=>{const query=searchInput.value.trim().toLowerCase();let visible=0;for(const row of rows){const matches=!query||row.textContent.toLowerCase().includes(query);row.hidden=!matches;if(matches)visible++;}if(searchCount)searchCount.textContent=query?visible+' of '+rows.length+' events':rows.length+' events';};
  searchInput.addEventListener('input',updateSearch);updateSearch();
}
</script>
</body>
</html>`;
}

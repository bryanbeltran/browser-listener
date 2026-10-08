import { buildCoverageReport } from "../export/coverage.js";
import { buildBundleCitation, buildEvidenceCitation } from "../export/citations.js";
import { buildReproductionSnippets } from "../export/reproduction.js";
import { buildCorrelationGraph } from "../export/correlation.js";
import { redactSensitiveString } from "../redaction/engine.js";
import type { CoverageReport, SessionData } from "../shared/types.js";
import { buildPrivacyReceipt } from "../export/privacy-receipt.js";

export function generateReportHtml(
  data: SessionData,
  coverage: CoverageReport = buildCoverageReport(data),
): string {
  const bundleId = data.session?.id ?? "none";
  const redactionEnabled = data.session?.options?.redactionEnabled !== false;
  const reportNetwork = data.network.map((entry) => {
    const copy = { ...entry };
    delete copy.requestBody;
    delete copy.responseBody;
    return {
      ...copy,
      citation: buildEvidenceCitation(bundleId, "raw.har", entry.id, coverage.schemaVersion),
      reproduction: buildReproductionSnippets(entry, {
        bundleId,
        schemaVersion: coverage.schemaVersion,
        redactionEnabled,
      }),
    };
  });
  const reportConsole = data.console.map((entry) => {
    const copy = { ...entry };
    delete copy.args;
    delete copy.stackTrace;
    return {
      ...copy,
      citation: buildEvidenceCitation(bundleId, "raw-console.json", entry.id, coverage.schemaVersion),
    };
  });
  const reportNavigation = data.navigation.map((entry) => ({
    ...entry,
    citation: buildEvidenceCitation(bundleId, "raw.har", entry.id, coverage.schemaVersion),
  }));
  const reportMarkers = (data.markers ?? []).map((entry) => ({
    ...entry,
    citation: buildEvidenceCitation(bundleId, "report.html", entry.id, coverage.schemaVersion),
  }));
  const reportContext = (data.contextSnapshots ?? []).map((entry) => ({
    ...entry,
    citation: buildEvidenceCitation(bundleId, "report.html", entry.id, coverage.schemaVersion),
  }));
  const reportPerformance = (data.performanceSignals ?? []).map((entry) => ({
    ...entry,
    citation: buildEvidenceCitation(bundleId, "report.html", entry.id, coverage.schemaVersion),
  }));
  const reportScreenshots = (data.screenshots ?? []).map((entry) => ({
    id: entry.id,
    sessionId: entry.sessionId,
    timestamp: entry.timestamp,
    tabId: entry.tabId,
    format: entry.format,
    state: entry.state,
    ...(entry.data ? { artifact: `screenshots/${entry.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.png` } : {}),
    ...(entry.reason ? { reason: redactSensitiveString(entry.reason) } : {}),
  }));
  const correlation = buildCorrelationGraph(data);
  const privacy = buildPrivacyReceipt(data, coverage);
  const summary = {
    session: data.session,
    bundleCitation: buildBundleCitation(bundleId, coverage.schemaVersion),
    coverage,
    privacy,
    navigation: reportNavigation,
    console: reportConsole,
    network: reportNetwork,
    markers: reportMarkers,
    contextSnapshots: reportContext,
    performanceSignals: reportPerformance,
    visualEvidence: reportScreenshots,
    correlation,
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
  select { padding: 6px 8px; border: 1px solid #8886; border-radius: 6px; font: inherit; }
  .visual-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
  .visual-grid figure { margin: 0; padding: 8px; border: 1px solid #8884; border-radius: 8px; }
  .visual-grid img { display: block; width: 100%; height: auto; margin-top: 8px; border-radius: 4px; }
</style>
</head>
<body>
<h1>Browser Listener — Local Session Report</h1>
<p class="muted">Local export only. No remote telemetry. Capture only pages and data you are authorized to collect.</p>
<nav>
  <a href="#summary">Summary</a>
  <a href="#coverage">Coverage</a>
  <a href="#timeline">Timeline</a>
  <a href="#correlation">Correlations</a>
  <a href="#context">Context</a>
  <a href="#visual">Visual evidence</a>
  <a href="#health">Health</a>
</nav>
<section id="summary"></section>
<section id="coverage"></section>
<section id="timeline"></section>
<section id="correlation"></section>
<section id="context"></section>
<section id="visual"></section>
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
summaryHtml+='<p class="muted"><strong>Redaction:</strong> '+(DATA.privacy.redactionEnabled?'enabled':'disabled — treat this export as sensitive')+' · '+esc(DATA.privacy.audit.redactedValues)+' value(s) replaced across '+esc(DATA.privacy.audit.redactedRecords)+' record(s)</p>';
summaryHtml+='<h3>Privacy receipt</h3>'+table(['Field','Captured','Excluded','Redacted','Truncated','Dropped','Unavailable'],Object.entries(DATA.privacy.fields||{}).map(([key,value])=>[esc(key),esc(value.captured),esc(value.excluded),esc(value.redacted),esc(value.truncated),esc(value.dropped),esc(value.unavailable)]));
summaryHtml+='<p class="muted"><strong>Export destination:</strong> '+esc(DATA.privacy.exportDestination||'local-device')+' · <strong>Policy epochs:</strong> '+esc(DATA.privacy.policyEpochs?.length||0)+'</p>';
if((DATA.privacy.warnings||[]).length) summaryHtml+='<ul>'+DATA.privacy.warnings.map(warning=>'<li>'+esc(warning)+'</li>').join('')+'</ul>';
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
  ['Markers · label',metricText(c.fields.markers?.label)],
  ['Markers · note',metricText(c.fields.markers?.note)],
]);
coverageHtml+='<h3>Quality signals</h3>'+table(['Signal','Value'],Object.entries(c.quality).map(([key,value])=>[esc(key),esc(value)]));
coverageHtml+='<p class="'+(c.quality.partial?'health-warn':'muted')+'"><strong>Completeness:</strong> '+(c.quality.partial?'Partial capture — review gaps before relying on absence.':'No recorded completeness gaps')+'</p>';
coverageHtml+='<h3>Capture policy</h3>'+table(['Setting','Value'],[
  ['Profile',c.policy?.profile||'unknown'],
  ['Redaction',c.policy?.redactionEnabled?'enabled':'disabled'],
  ['Request/response bodies',c.policy?.captureBodies?'enabled':'disabled'],
  ['Console capture',c.policy?.captureConsole?'enabled':'disabled'],
  ['Allowed origins',c.policy?.allowedOrigins?.length?c.policy.allowedOrigins.join(', '):'page and dependencies'],
  ['Target tabs',c.policy?.targetTabIds?.length?c.policy.targetTabIds.join(', '):'active tab'],
  ['Frame IDs',c.policy?.frameIds?.length?c.policy.frameIds.join(', '):'all frames'],
  ['Duration',c.policy?.durationMs?String(c.policy.durationMs)+' ms':'unlimited'],
  ['Field consent',c.policy?.fields?Object.entries(c.policy.fields).filter(([,enabled])=>enabled).map(([field])=>field).join(', ')||'none':'unknown'],
]);
const pauses=c.capture?.pauseIntervals||[];
coverageHtml+='<h3>Pause intervals</h3>'+(pauses.length?table(['Started','Ended','Duration'],pauses.map(interval=>[
  esc(formatDate(interval.startedAt)),
  esc(formatDate(interval.endedAt)),
  esc(interval.durationMs==null?'—':String(interval.durationMs)+' ms'),
])):'<p class="muted">No pause intervals recorded</p>');
document.getElementById('coverage').innerHTML=coverageHtml;

const events=[
  ...DATA.navigation.map(entry=>({id:entry.id,time:entry.timestamp,type:'navigation',label:entry.title||entry.url,detail:entry.url,citation:entry.citation})),
  ...DATA.console.map(entry=>({id:entry.id,time:entry.timestamp,type:'console '+entry.level,label:entry.text,detail:entry.url||entry.source||'',citation:entry.citation})),
  ...(DATA.markers||[]).map(entry=>({id:entry.id,time:entry.timestamp,type:'marker',label:entry.note||entry.label,detail:entry.url||'',citation:entry.citation})),
  ...DATA.network.map(entry=>({id:entry.id,time:entry.timestamp,type:'network',label:entry.method+' '+entry.type,detail:entry.statusCode+' '+entry.url,citation:entry.citation,reproduction:entry.reproduction})),
].sort((a,b)=>a.time-b.time);
let timelineHtml='<h2>Evidence timeline</h2><div class="search-controls"><label for="timeline-search"><strong>Filter evidence</strong></label><input id="timeline-search" type="search" placeholder="Search URL, console text, or event type" /><span id="search-count" class="muted" aria-live="polite"></span></div>';
timelineHtml+='<table><thead><tr><th>Time</th><th>Type</th><th>Evidence</th><th>Source</th><th>Actions</th></tr></thead><tbody>';
for(const event of events){
  const citationButton=event.citation?'<button type="button" class="action-button citation-button" data-citation="'+esc(event.citation.address)+'">Copy citation</button>':'';
  const reproductionButtons=event.reproduction?['curl','fetch','httpie'].map(kind=>'<button type="button" class="action-button reproduction-button" data-repro-id="'+esc(event.id)+'" data-repro-kind="'+kind+'">Copy '+kind+'</button>').join(' '):'';
  timelineHtml+='<tr class="event-row"><td>'+esc(formatDate(event.time))+'</td><td>'+esc(event.type)+'</td><td>'+esc(event.label)+'</td><td>'+safeLink(event.detail)+'</td><td>'+citationButton+' '+reproductionButtons+'</td></tr>';
}
timelineHtml+='</tbody></table>';
document.getElementById('timeline').innerHTML=timelineHtml;

const h=DATA.session?.health, gaps=h?.partialGaps?.length??0;
document.getElementById('health').innerHTML='<h2>Capture health</h2><pre class="'+(gaps?'health-warn':'')+'">'+esc(JSON.stringify(h,null,2))+'</pre>';

const correlationSection=document.getElementById('correlation');
if(correlationSection){
  const graph=DATA.correlation||{nodes:[],edges:[]};
  const options=graph.nodes.map(node=>'<option value="'+esc(node.id)+'">'+esc(node.type+' · '+node.eventId)+'</option>').join('');
  correlationSection.innerHTML='<h2>Evidence correlations</h2><p class="muted">Edges are derived from browser IDs or bounded heuristics. An ambiguous edge is a lead for review, not proof of causality.</p><label for="correlation-focus">Focus event</label> <select id="correlation-focus"><option value="">All relationships</option>'+options+'</select><div id="correlation-table"></div>';
  const tableNode=document.getElementById('correlation-table'), focus=document.getElementById('correlation-focus');
  const nodeLabel=(id)=>{const node=graph.nodes.find(candidate=>candidate.id===id);return node?node.type+' · '+node.eventId:id;};
  const renderCorrelations=()=>{const selected=focus.value;const edges=graph.edges.filter(edge=>!selected||edge.from===selected||edge.to===selected);let html='<table><thead><tr><th>From</th><th>Relationship</th><th>To</th><th>Confidence</th><th>Why connected</th></tr></thead><tbody>';for(const edge of edges){html+='<tr><td>'+esc(nodeLabel(edge.from))+'</td><td>'+esc(edge.type)+'</td><td>'+esc(nodeLabel(edge.to))+'</td><td>'+esc(edge.confidence+(edge.ambiguous?' · ambiguous':''))+'</td><td>'+esc(edge.provenance.source+' — '+edge.provenance.rule)+'</td></tr>';}html+='</tbody></table>';if(!edges.length)html+='<p class="muted">No bounded relationships were found.</p>';if(tableNode)tableNode.innerHTML=html;};
  focus.addEventListener('change',renderCorrelations);renderCorrelations();
}

const contextSection=document.getElementById('context');
if(contextSection){
  const snapshots=DATA.contextSnapshots||[], performance=DATA.performanceSignals||[];
  let html='<h2>Browser context and performance</h2><p class="muted">Metadata and aggregate signals only; no DOM, form, clipboard, microphone, or camera content is captured.</p>';
  html+='<h3>Context snapshots</h3>';
  html+=snapshots.length?'<table><thead><tr><th>Time</th><th>Tab</th><th>URL</th><th>Viewport</th><th>Frames</th><th>Navigation timing</th><th>Resources</th><th>Long tasks</th><th>Visibility</th><th>Focus</th><th>Online</th></tr></thead><tbody>'+snapshots.map(entry=>'<tr><td>'+esc(formatDate(entry.timestamp))+'</td><td>'+esc(entry.tabId)+'</td><td>'+safeLink(entry.url)+'</td><td>'+esc(entry.viewport?entry.viewport.width+' × '+entry.viewport.height:'—')+'</td><td>'+esc(entry.frameTree?entry.frameTree.frames.length+(entry.frameTree.truncated?'+':''):'—')+'</td><td>'+esc(entry.navigationTiming?JSON.stringify(entry.navigationTiming):'—')+'</td><td>'+esc(entry.resourceTiming?JSON.stringify(entry.resourceTiming):'—')+'</td><td>'+esc(entry.longTaskSummary?JSON.stringify(entry.longTaskSummary):'—')+'</td><td>'+esc(entry.visibilityState||'—')+'</td><td>'+esc(entry.focused==null?'—':entry.focused)+'</td><td>'+esc(entry.online==null?'—':entry.online)+'</td></tr>').join('')+'</tbody></table>':'<p class="muted">No context snapshot was captured.</p>';
  const capabilities=c.source?.capabilities;
  if(capabilities){
    const capabilityRows=[];
    for(const [name,status] of Object.entries({
      ...capabilities.debuggerDomains,
      bodyRetrieval:capabilities.bodyRetrieval,
      workerTargets:capabilities.workerTargets,
      screenshots:capabilities.screenshots,
      downloads:capabilities.downloads,
      storage:capabilities.storage,
      lifecycleRecovery:capabilities.lifecycleRecovery,
    })) capabilityRows.push([esc(name),esc(status.supported?'supported':'unsupported'),esc(status.reason||'')]);
    html+='<h3>Adapter capabilities</h3><p class="muted">Unsupported capabilities are reported explicitly and are not inferred from missing evidence.</p>'+table(['Capability','Status','Reason'],capabilityRows);
  }
  html+='<h3>Performance samples</h3>';
  html+=performance.length?'<table><thead><tr><th>Time</th><th>Tab</th><th>Support</th><th>Metrics</th></tr></thead><tbody>'+performance.map(entry=>'<tr><td>'+esc(formatDate(entry.timestamp))+'</td><td>'+esc(entry.tabId)+'</td><td>'+esc(entry.browserSupport)+'</td><td><pre>'+esc(JSON.stringify(entry.metrics))+'</pre></td></tr>').join('')+'</tbody></table>':'<p class="muted">No performance sample was captured.</p>';
  contextSection.innerHTML=html;
}

const visualSection=document.getElementById('visual');
if(visualSection){
  const screenshots=DATA.visualEvidence||[];
  let html='<h2>Visual evidence</h2><p class="muted">Screenshots are captured only after an explicit request. Image bytes are opaque and are not text-redacted.</p>';
  html+=screenshots.length?'<div class="visual-grid">'+screenshots.map(entry=>'<figure><figcaption>'+esc(formatDate(entry.timestamp))+' · tab '+esc(entry.tabId)+' · '+esc(entry.state)+'</figcaption>'+(entry.artifact?'<img loading="lazy" alt="Captured browser view" src="'+esc(entry.artifact)+'" />':'<p class="muted">'+esc(entry.reason||'Screenshot unavailable')+'</p>')+'</figure>').join('')+'</div>':'<p class="muted">No explicit screenshots were captured.</p>';
  visualSection.innerHTML=html;
}

const copyButton=document.getElementById('copy-citation'), citationStatus=document.getElementById('citation-status');
async function copyText(value){
  if(navigator.clipboard){await navigator.clipboard.writeText(value);return;}
  const area=document.createElement('textarea');area.value=value;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();const copied=document.execCommand('copy');area.remove();if(!copied)throw new Error('clipboard unavailable');
}
for(const button of document.querySelectorAll('.citation-button')){
  button.addEventListener('click',async()=>{
    const value=button.getAttribute('data-citation')||'';
    try{await copyText(value);button.textContent='Copied';}catch{button.textContent='Unavailable';}
  });
}
for(const button of document.querySelectorAll('.reproduction-button')){
  button.addEventListener('click',async()=>{
    const id=button.getAttribute('data-repro-id'),kind=button.getAttribute('data-repro-kind')||'curl';
    const entry=(DATA.network||[]).find(candidate=>candidate.id===id),snippet=entry?.reproduction;
    if(!snippet)return;
    const notes=snippet.context.omitted?.length?'\\n\\nNotes:\\n- '+snippet.context.omitted.join('\\n- '):'';
    if(!window.confirm('Copy a safe, reviewable '+kind+' snippet? It will not replay automatically.'+notes))return;
    try{await copyText(snippet[kind]);button.textContent='Copied';}catch{button.textContent='Unavailable';}
  });
}
copyButton?.addEventListener('click',async()=>{
  const citation=DATA.bundleCitation||['Browser Listener capture','Source: '+(source||'unknown'),'Captured: '+formatDate(c.source.startedAt)+' — '+formatDate(c.source.stoppedAt),'Session: '+(s?.id||'unknown')].join('\\n');
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

import { buildCoverageReport } from "../export/coverage.js";
import type { CoverageReport, SessionData } from "../shared/types.js";

export function generateReportHtml(
  data: SessionData,
  coverage: CoverageReport = buildCoverageReport(data),
): string {
  const fb = data.enrichments?.facebookGroups;
  const summary = {
    session: data.session,
    coverage,
    counts: {
      network: data.network.length,
      posts: fb?.posts.length ?? 0,
      comments: fb?.comments.length ?? 0,
      reactions: fb?.reactions.length ?? 0,
      people: fb?.people.length ?? 0,
    },
    facebookGroups: fb ?? null,
  };
  const json = JSON.stringify(summary).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Browser Listener — Local Session Archive</title>
<style>
  :root { font-family: system-ui, sans-serif; color-scheme: light dark; }
  body { margin: 0; padding: 16px; max-width: 1200px; }
  h1,h2,h3 { margin-top: 1.2em; }
  nav { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  nav a { padding: 6px 10px; border: 1px solid #8885; border-radius: 6px; text-decoration: none; }
  section { margin-bottom: 24px; }
  pre { font-family: ui-monospace, monospace; font-size: 12px; overflow: auto; padding: 12px; border-radius: 8px; background: #8881; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #8884; padding: 6px 8px; text-align: left; vertical-align: top; }
  .health-warn { color: #c60; }
  .muted { opacity: 0.7; font-size: 12px; }
  .post-block { margin: 16px 0; padding: 12px; border: 1px solid #8884; border-radius: 8px; }
  .post-block[hidden] { display: none; }
  .post-block h4 { margin: 0 0 8px; font-size: 14px; }
  .stat-grid { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0; }
  .stat { padding: 8px 12px; border: 1px solid #8884; border-radius: 8px; }
  .search-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 12px 0; }
  .search-controls input { min-width: 260px; max-width: 100%; padding: 7px 9px; border: 1px solid #8886; border-radius: 6px; font: inherit; }
  .action-button { padding: 7px 10px; border: 1px solid #8886; border-radius: 6px; cursor: pointer; font: inherit; }
  .citation-status { margin-left: 8px; }
</style>
</head>
<body>
<h1>Browser Listener — Local Session Archive</h1>
<p class="muted">Local export only. No remote telemetry. Use only for pages and data you are authorized to capture.</p>
<nav>
  <a href="#summary">Summary</a>
  <a href="#coverage">Coverage</a>
  <a href="#health">Health</a>
  <a href="#facebook">Facebook</a>
</nav>
<section id="summary"></section>
<section id="coverage"></section>
<section id="health"></section>
<section id="facebook"></section>
<script>
const DATA = ${json};
function esc(s){const d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML;}
function formatDate(value){return value?new Date(value).toLocaleString():'—';}
function safeLink(url){
  if(!url) return '—';
  try {
    const parsed = new URL(url);
    if(parsed.protocol !== 'https:') return esc(url);
    return '<a href="'+esc(parsed.toString())+'">'+esc(parsed.toString())+'</a>';
  } catch { return esc(url); }
}
function table(headers, rows){
  let h='<table><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr>';
  for(const row of rows) h+='<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>';
  return h+'</table>';
}
function metricText(metric){
  if(!metric || !metric.total) return '—';
  return esc(metric.present+'/'+metric.total+' ('+metric.percent+'%)');
}

const s = DATA.session;
const c = DATA.counts;
const source = DATA.coverage.source.sessionPermalink || DATA.coverage.source.tabUrl;
let sum = '<h2>Session summary</h2>';
if (s) {
  sum += '<p><strong>Source:</strong> '+safeLink(source)+'</p>';
  sum += '<p><strong>Captured:</strong> '+formatDate(s.startedAt)+' → '+formatDate(s.stoppedAt)+'</p>';
  sum += '<p class="muted"><strong>Session:</strong> '+esc(s.id)+'</p>';
}
sum += '<div class="stat-grid">';
for (const [k,v] of Object.entries(c)) sum += '<div class="stat"><strong>'+esc(v)+'</strong><br><span class="muted">'+esc(k)+'</span></div>';
sum += '</div>';
sum += '<p><button type="button" class="action-button" id="copy-citation">Copy citation</button><span class="muted citation-status" id="citation-status" aria-live="polite"></span></p>';
document.getElementById('summary').innerHTML = sum;

const cov = DATA.coverage;
let coverageHtml = '<h2>Coverage &amp; provenance</h2>';
coverageHtml += '<p class="muted">Generated '+formatDate(cov.generatedAt)+' · schema v'+esc(cov.schemaVersion)+'</p>';
coverageHtml += '<h3>Captured entities</h3>'+table(['Entity','Count'], Object.entries(cov.totals).map(([k,v])=>[esc(k),esc(v)]));
coverageHtml += '<h3>Field coverage</h3>'+table(
  ['Entity field','Present'],
  [
    ['Posts · text', metricText(cov.fields.posts.text)],
    ['Posts · author ID', metricText(cov.fields.posts.authorId)],
    ['Posts · URL', metricText(cov.fields.posts.url)],
    ['Comments · text', metricText(cov.fields.comments.text)],
    ['Comments · author ID', metricText(cov.fields.comments.authorId)],
    ['Comments · parent post', metricText(cov.fields.comments.postId)],
    ['Reactions · user ID', metricText(cov.fields.reactions.userId)],
    ['Reactions · target ID', metricText(cov.fields.reactions.targetId)],
    ['Reactions · target text', metricText(cov.fields.reactions.targetText)],
    ['Reactions · type', metricText(cov.fields.reactions.reactionType)],
  ],
);
coverageHtml += '<h3>Quality signals</h3>'+table(
  ['Signal','Count'],
  Object.entries(cov.quality).map(([k,v])=>[esc(k),esc(v)]),
);
document.getElementById('coverage').innerHTML = coverageHtml;

const h = DATA.session?.health;
const gaps = h?.partialGaps?.length ?? 0;
document.getElementById('health').innerHTML = '<h2>Capture health</h2><pre class="'+(gaps?'health-warn':'')+'">'+esc(JSON.stringify(h,null,2))+'</pre>';

let fbHtml = '<h2>Facebook activity</h2>';
if(!DATA.facebookGroups){
  fbHtml += '<p class="muted">No Facebook GraphQL activity parsed for this session.</p>';
} else {
  const fb = DATA.facebookGroups;
  fbHtml += '<div class="search-controls"><label for="activity-search"><strong>Filter activity</strong></label><input id="activity-search" type="search" placeholder="Search posts, comments, or reactions" /><span id="search-count" class="muted" aria-live="polite"></span></div>';
  if(fb.parseWarnings?.length) fbHtml += '<p class="health-warn"><strong>Parse warnings:</strong> '+fb.parseWarnings.map(esc).join(' · ')+'</p>';
  if(fb.sessionPermalink) fbHtml += '<p class="muted">Session permalink: '+safeLink(fb.sessionPermalink)+'</p>';
  if(fb.groups.length) fbHtml += '<h3>Groups ('+fb.groups.length+')</h3>'+table(['Name','ID','Members','URL'], fb.groups.map(g=>[esc(g.name||''), esc(g.id), esc(g.memberCountText||''), safeLink(g.url)]));
  if(fb.members?.length) fbHtml += '<h3>Group members ('+fb.members.length+')</h3>'+table(['Name','User ID','Group','Role'], fb.members.map(m=>[esc(m.name), esc(m.userId), esc(m.groupName||m.groupId||''), esc(m.role||'')]));
  if(fb.people.length) fbHtml += '<h3>People ('+fb.people.length+')</h3>'+table(['Name','ID','Source'], fb.people.map(p=>[esc(p.name), esc(p.id), esc(p.source)]));
  if(fb.posts.length) {
    fbHtml += '<h3>Posts ('+fb.posts.length+')</h3>';
    for (const p of fb.posts) {
      const bits = [];
      if (p.surface) bits.push(p.surface);
      if (p.groupName) bits.push(p.groupName);
      if (p.commentCount) bits.push(p.commentCount+' comment'+(p.commentCount===1?'':'s'));
      if (p.reactionCount) bits.push(p.reactionCount+' reaction'+(p.reactionCount===1?'':'s'));
      fbHtml += '<div class="post-block"><h4>'+esc(p.authorName||'Post')+' <span class="muted">'+esc(p.postId||'')+'</span></h4>';
      if (bits.length) fbHtml += '<p class="muted">'+esc(bits.join(' · '))+'</p>';
      if (p.text) fbHtml += '<p>'+esc(p.text.slice(0,500))+'</p>';
      if (p.media?.length) {
        fbHtml += '<p><strong>Media</strong></p>'+table(['Type','Caption','Size'], p.media.map(m=>[esc(m.type), esc((m.caption||'').slice(0,120)), esc(m.width && m.height ? m.width+'×'+m.height : '')]));
      }
      if (p.share) {
        const sh = p.share;
        fbHtml += '<p><strong>Share</strong> '+esc(sh.originalAuthorName||'')+(sh.originalText ? ': '+esc(sh.originalText.slice(0,200)) : '')+'</p>';
      }
      if (p.url) fbHtml += '<p>'+safeLink(p.url)+'</p>';
      if (p.partialParse) fbHtml += '<p class="health-warn">Partial parse</p>';
      if (p.linkedComments?.length) {
        fbHtml += '<p><strong>Comments</strong></p>'+table(['Author','Text','Reactions'], p.linkedComments.map(cm=>{
          const rx = cm.linkedReactions?.length
            ? cm.linkedReactions.map(r=>esc(r.userName)+(r.reactionType?(' ('+esc(r.reactionType)+')'):'')).join(', ')
            : (cm.reactionCount ? esc(String(cm.reactionCount)) : '');
          return [esc(cm.authorName||''), esc((cm.text||'').slice(0,200)), rx];
        }));
      }
      if (p.linkedReactions?.length) {
        fbHtml += '<p><strong>Reactions</strong></p>'+table(['User','Type'], p.linkedReactions.map(r=>[esc(r.userName), esc(r.reactionType||'')]));
      }
      fbHtml += '</div>';
    }
  }
  if(fb.reactions.length) fbHtml += '<h3>All reactions ('+fb.reactions.length+')</h3>'+table(['User','Type','Target','Post ID','Comment ID','Source'], fb.reactions.map(r=>[esc(r.userName), esc(r.reactionType||''), esc(r.target||'post'), esc(r.postId||''), esc(r.commentId||''), esc(r.source)]));
  if(!fb.groups.length && !fb.people.length && !fb.posts.length && !fb.reactions.length && !fb.comments.length) fbHtml += '<p class="muted">GraphQL captured but no entities extracted yet.</p>';
}
document.getElementById('facebook').innerHTML = fbHtml;

const copyButton = document.getElementById('copy-citation');
const citationStatus = document.getElementById('citation-status');
async function copyText(value){
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('clipboard unavailable');
}
copyButton?.addEventListener('click', async () => {
  const citation = [
    'Browser Listener capture',
    'Source: '+(source || 'unknown'),
    'Captured: '+formatDate(DATA.coverage.source.startedAt)+' → '+formatDate(DATA.coverage.source.stoppedAt),
    'Session: '+(s?.id || 'unknown'),
  ].join('\\n');
  try {
    await copyText(citation);
    if (citationStatus) citationStatus.textContent = 'Copied';
  } catch {
    if (citationStatus) citationStatus.textContent = 'Clipboard unavailable — use coverage-report.json';
  }
});

const searchInput = document.getElementById('activity-search');
const searchCount = document.getElementById('search-count');
if (searchInput) {
  const cards = [...document.querySelectorAll('.post-block')];
  const updateSearch = () => {
    const query = searchInput.value.trim().toLowerCase();
    let visible = 0;
    for (const card of cards) {
      const matches = !query || card.textContent.toLowerCase().includes(query);
      card.hidden = !matches;
      if (matches) visible++;
    }
    if (searchCount) searchCount.textContent = query ? visible+' of '+cards.length+' post cards' : cards.length+' post cards';
  };
  searchInput.addEventListener('input', updateSearch);
  updateSearch();
}
</script>
</body>
</html>`;
}

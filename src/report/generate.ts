import type { SessionData } from "../shared/types.js";

export function generateReportHtml(data: SessionData): string {
  const fb = data.enrichments?.facebookGroups;
  const summary = {
    session: data.session,
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
<title>Browser Listener — Facebook Session</title>
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
  .post-block h4 { margin: 0 0 8px; font-size: 14px; }
  .stat-grid { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0; }
  .stat { padding: 8px 12px; border: 1px solid #8884; border-radius: 8px; }
</style>
</head>
<body>
<h1>Browser Listener — Facebook Session</h1>
<p class="muted">Local export only. No remote telemetry.</p>
<nav>
  <a href="#summary">Summary</a>
  <a href="#health">Health</a>
  <a href="#facebook">Facebook</a>
</nav>
<section id="summary"></section>
<section id="health"></section>
<section id="facebook"></section>
<script>
const DATA = ${json};
function esc(s){const d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML;}
function table(headers, rows){
  let h='<table><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr>';
  for(const row of rows) h+='<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>';
  return h+'</table>';
}
const s = DATA.session;
const c = DATA.counts;
let sum = '<h2>Session summary</h2>';
if (s) {
  sum += '<p><strong>Tab:</strong> '+(s.tabUrl?'<a href="'+esc(s.tabUrl)+'">'+esc(s.tabUrl)+'</a>':'—')+'</p>';
  sum += '<p class="muted">'+new Date(s.startedAt).toLocaleString()+(s.stoppedAt?' → '+new Date(s.stoppedAt).toLocaleString():'')+'</p>';
}
sum += '<div class="stat-grid">';
for (const [k,v] of Object.entries(c)) sum += '<div class="stat"><strong>'+esc(v)+'</strong><br><span class="muted">'+esc(k)+'</span></div>';
sum += '</div>';
document.getElementById('summary').innerHTML = sum;
const h = DATA.session?.health;
const gaps = h?.partialGaps?.length ?? 0;
document.getElementById('health').innerHTML = '<h2>Capture health</h2><pre class="'+(gaps?'health-warn':'')+'">'+esc(JSON.stringify(h,null,2))+'</pre>';
const fb = DATA.facebookGroups;
let fbHtml = '<h2>Facebook activity</h2>';
if(!fb){ fbHtml += '<p class="muted">No Facebook GraphQL activity parsed for this session.</p>'; }
else {
  if(fb.parseWarnings?.length) fbHtml += '<p class="health-warn"><strong>Parse warnings:</strong> '+fb.parseWarnings.map(esc).join(' · ')+'</p>';
  if(fb.sessionPermalink) fbHtml += '<p class="muted">Session permalink: <a href="'+esc(fb.sessionPermalink)+'">'+esc(fb.sessionPermalink)+'</a></p>';
  if(fb.groups.length) fbHtml += '<h3>Groups ('+fb.groups.length+')</h3>'+table(['Name','ID','Members','URL'], fb.groups.map(g=>[esc(g.name||''), esc(g.id), esc(g.memberCountText||''), g.url?'<a href="'+esc(g.url)+'">'+esc(g.url)+'</a>':'']));
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
      if (p.url) fbHtml += '<p><a href="'+esc(p.url)+'">Open post</a></p>';
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
</script>
</body>
</html>`;
}

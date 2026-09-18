(() => {
  const authorId = new URLSearchParams(location.search).get('id');
  const worksHeading = document.querySelector('main > h2');
  if (!authorId || !worksHeading || !window.supabase) return;
  const client = supabase.createClient('https://fiepaguycecrredwrcwx.supabase.co', 'sb_publishable_8CnbGjZ-P8PYPNLhJ7igAg_XVonmJRE');
  client.rpc('novelight_public_author_notes', { p_author_user_id: authorId, p_limit: 5 }).then(({ data, error }) => {
    if (error || !Array.isArray(data) || data.length === 0) return;
    const section = document.createElement('section'); section.className = 'author-notes';
    const heading = document.createElement('h2'); heading.textContent = '近況ノート';
    const list = document.createElement('div'); list.className = 'author-notes-list';
    data.forEach(note => {
      const article = document.createElement('article'); article.className = 'card author-note';
      const title = document.createElement('strong'); title.textContent = note.title || '';
      const body = document.createElement('div'); body.className = 'author-note-body'; body.textContent = note.body || '';
      article.append(title, body);
      if (note.linked_novel) {
        const link = document.createElement('a'); link.className = 'author-note-link';
        link.href = `novel.html?id=${encodeURIComponent(note.linked_novel.id)}`;
        link.textContent = `関連作品：${note.linked_novel.title} →`; article.appendChild(link);
      }
      list.appendChild(article);
    });
    section.append(heading, list); worksHeading.before(section);
  }).catch(() => {});
})();

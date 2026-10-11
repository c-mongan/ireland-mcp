const form = document.querySelector('#chat-form');
const question = document.querySelector('#question');
const status = document.querySelector('#status');
const results = document.querySelector('#results');
const token = document.querySelector('#token');
const headers = () => ({ 'content-type': 'application/json', ...(token.value ? { authorization: `Bearer ${token.value}` } : {}) });
const element = (tag, content, className) => { const node = document.createElement(tag); if (content) node.textContent = content; if (className) node.className = className; return node; };

async function coverage() {
  try {
    const response = await fetch(new URL('api/status', import.meta.url), { headers: headers() });
    if (!response.ok) throw new Error(response.status === 401 ? 'Enter an access token to use this server.' : 'Coverage could not be loaded.');
    const data = await response.json();
    status.textContent = data.document_count ? `${data.document_count} indexed documents. Results include source dates and coverage limits.` : 'No source pages are indexed yet. Run source sync before asking a question.';
  } catch (error) { status.textContent = error.message; }
}
token.addEventListener('change', coverage);
document.querySelectorAll('[data-question]').forEach(button => button.addEventListener('click', () => { question.value = button.dataset.question; question.focus(); }));
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = document.querySelector('#ask');
  button.disabled = true;
  results.setAttribute('aria-busy', 'true');
  status.textContent = 'Finding matching source evidence…';
  try {
    const data = new FormData(form);
    const request = { question: data.get('question'), mode: data.get('mode'), ...(data.get('as_of') ? { as_of: data.get('as_of') } : {}) };
    const response = await fetch(new URL('api/chat', import.meta.url), { method: 'POST', headers: headers(), body: JSON.stringify(request), signal: AbortSignal.timeout(30000) });
    const answer = await response.json();
    if (!response.ok) throw new Error(answer.error ?? 'Unable to retrieve evidence.');
    document.querySelector('#answer').textContent = answer.answer;
    document.querySelector('#answer-kind').textContent = answer.generation === 'model' ? 'Generated summary' : 'Source excerpts';
    const warnings = document.querySelector('#warnings');
    warnings.replaceChildren(...answer.warnings.map(warning => element('p', warning)));
    warnings.hidden = !answer.warnings.length;
    const citations = document.querySelector('#citations');
    citations.replaceChildren();
    for (const [index, citation] of answer.citations.entries()) {
      const card = element('article', '', 'citation');
      const heading = element('h4');
      const link = element('a', `[${index+1}] ${citation.title}`);
      const url = new URL(citation.url);
      if (url.protocol === 'https:') { link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
      heading.append(link);
      card.append(heading, element('p', `${citation.source_type} · ${citation.publisher} · ${citation.currentness}`, 'metadata'));
      for (const quote of answer.supporting_quotes.filter(q => q.citation_id === citation.id)) card.append(element('blockquote', quote.quote));
      card.append(element('p', `Publisher update: ${citation.publisher_updated_at ?? 'unknown'} · Consolidated to: ${citation.consolidated_to ?? 'unknown'} · Fetched: ${citation.source_fetched_at} · Checked: ${citation.source_checked_at}`, 'metadata'),
        element('p', `${citation.licence} · ${citation.attribution}`, 'metadata'), element('p', `Version: ${citation.version}`, 'metadata'));
      citations.append(card);
    }
    results.hidden = false;
    status.textContent = `${answer.citations.length} cited sources. Current law has not been fully verified.`;
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { status.textContent = error.name === 'TimeoutError' ? 'The request timed out. Try again.' : error.message; }
  finally { button.disabled = false; results.setAttribute('aria-busy', 'false'); }
});
await coverage();

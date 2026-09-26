const form = document.querySelector('#scan-form');
const button = form.querySelector('button');
const status = document.querySelector('#status');

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'İstek başarısız oldu.');
  return data;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = 'Site taranıyor...';
  try {
    const { id } = await request('/api/scans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: form.elements.url.value }),
    });
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      const job = await request(`/api/scans/${id}`);
      if (job.status === 'failed') throw new Error('Tarama tamamlanamadı. Lütfen yeniden deneyin.');
      if (job.status === 'completed') {
        window.location.assign(job.reportUrl);
        return;
      }
    }
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
  }
});

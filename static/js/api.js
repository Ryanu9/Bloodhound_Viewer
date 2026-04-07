export async function api(url, options) {
  const response = await fetch(`/api${url}`, options);

  if (!response.ok) {
    let detail = `API ${response.status}`;
    try {
      const payload = await response.json();
      if (payload && payload.detail) {
        detail = payload.detail;
      }
    } catch {
    }
    throw new Error(detail);
  }

  return response.json();
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

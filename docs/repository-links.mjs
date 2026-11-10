export function repositoryBase(href) {
  const url = new URL(href);
  if (!url.hostname.endsWith('.github.io')) return null;
  const owner = url.hostname.slice(0, -'.github.io'.length);
  const repo = url.pathname.split('/').filter(Boolean)[0];
  if (!owner || !repo || !/^[a-zA-Z0-9._-]+$/.test(repo)) return null;
  return `https://github.com/${owner}/${repo}/blob/main/`;
}
if (typeof document !== 'undefined') {
  const base = repositoryBase(window.location.href);
  if (base) for (const link of document.querySelectorAll('a[data-repository-path]')) {
    link.href = base + link.dataset.repositoryPath;
  }
}

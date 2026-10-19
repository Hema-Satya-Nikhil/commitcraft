/** Parse an owner/repository identifier or an HTTP(S) GitHub repository URL. */
export function validateRepository(input) {
  const invalid = { valid: false, repository: null, error: 'Enter owner/repository or a GitHub repository URL.' };
  if (typeof input !== 'string') return invalid;

  let identifier = input.trim();
  const url = /^https?:\/\/(?:www\.)?github\.com\/([^?#]+)$/i.exec(identifier);
  if (url) identifier = url[1].replace(/\/$/, '');
  identifier = identifier.replace(/\.git$/, '');
  if (/\s/.test(identifier)) return invalid;
  const parts = identifier.split('/');
  if (parts.length !== 2) return invalid;
  const [owner, name] = parts;
  if (!/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(owner) || owner.includes('--')) return invalid;
  if (!/^[a-z\d_.-]{1,100}$/i.test(name) || name === '.' || name === '..') return invalid;

  return {
    valid: true,
    repository: { owner, name, fullName: `${owner}/${name}`, url: `https://github.com/${owner}/${name}` },
    error: null,
  };
}

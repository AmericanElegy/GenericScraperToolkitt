// Shared URL/address validation for the Worker and optional local browser lane.
export class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function publicURL(input) {
  if (!input || input.length > 2048) throw new InputError('Enter a public HTTPS URL (up to 2048 characters).');
  let url;
  try { url = new URL(input); } catch { throw new InputError('Enter a valid public HTTPS URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      host.length > 253 || host.endsWith('.') || !host.includes('.') || !/^[a-z0-9.-]+$/.test(host) ||
      host.split('.').some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
      /^[0-9.]+$/.test(host) || /(?:^|\.)(localhost|local|internal|test|invalid|example|onion|home|lan)$/.test(host)) {
    throw new InputError('Use a public HTTPS hostname without credentials, IP addresses, or custom ports.');
  }
  url.hash = '';
  return url;
}
export function publicAddress(ip) {
  if (ip.includes(':')) {
    // Conservative global-unicast policy: also exclude transition and special-use ranges.
    return /^[23][0-9a-f]{3}:/i.test(ip) && !/^200[12]:|^3fff:/i.test(ip);
  }
  const octets = ip.split('.').map(Number);
  if (octets.length !== 4 || octets.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b,c] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

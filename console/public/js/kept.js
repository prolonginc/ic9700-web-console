// Things kept on the console's own computer rather than in this browser, so a
// phone and a laptop see the same favorites, repeater list and logbook.

export class ApiError extends Error {}

// Calls the console's small web API. Resolves with the JSON answer.
export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError('The console program isn’t answering.');
  }
  if (res.status === 401) {
    location.href = 'login.html'; // signed out (phone access)
    throw new ApiError('Sign in first.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `The console answered with an error (${res.status}).`);
  return data;
}

// One saved value. Reads come from memory; `load` fetches it once, `save`
// stores it. A copy in this browser covers the moments the console is away.
export class Kept {
  constructor(name, fallback) {
    this.name = name;
    this.fallback = fallback;
    this.value = this.local(fallback);
    this.loaded = false;
  }

  local(fallback) {
    try {
      const raw = localStorage.getItem(`console.${this.name}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  remember() {
    try {
      localStorage.setItem(`console.${this.name}`, JSON.stringify(this.value));
    } catch {
      /* private browsing: the console's copy is the one that matters */
    }
  }

  async load() {
    try {
      const { value } = await api('GET', `api/data/${this.name}`);
      if (value === null) {
        // Nothing on the console yet. If this browser has some from before
        // (favorites used to live only here), hand them over.
        if (localStorage.getItem(`console.${this.name}`) !== null) await this.save(this.value);
      } else {
        this.value = value;
        this.remember();
      }
      this.loaded = true;
    } catch {
      /* keep working from this browser's copy */
    }
    return this.value;
  }

  async save(value) {
    this.value = value;
    this.remember();
    await api('PUT', `api/data/${this.name}`, { value });
  }
}

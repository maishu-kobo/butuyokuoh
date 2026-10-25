function createJar() {
  const data = new Map();
  const events = [];
  return {
    events,
    get(name) {
      const entry = data.get(name);
      return entry ? { name, value: entry.value } : undefined;
    },
    set(name, value, options) {
      if (name && typeof name === 'object') {
        data.set(name.name, { value: name.value, options: name });
        events.push({ op: 'set', name: name.name, value: name.value, options: name });
        return;
      }
      data.set(name, { value, options });
      events.push({ op: 'set', name, value, options });
    },
    delete(name, options) {
      const key = name && typeof name === 'object' ? name.name : name;
      data.delete(key);
      events.push({
        op: 'delete',
        name: key,
        options: name && typeof name === 'object' ? name : options,
      });
    },
  };
}

globalThis.__DIFF_COOKIE_JAR = createJar();

export async function cookies() {
  return globalThis.__DIFF_COOKIE_JAR;
}

export async function headers() {
  return new Headers();
}

export function draftMode() {
  return { isEnabled: false, enable() {}, disable() {} };
}

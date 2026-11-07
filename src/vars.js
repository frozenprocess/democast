// Variables in scene strings: {{name}} for values captured during the run,
// {{env.NAME}} for the environment.

// interp replaces {{name}} in v with values from vars, recursively through
// arrays and objects. A name with dots looks into nested values.
export function interp(v, vars) {
  if (typeof v === 'string') return v.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => lookup(vars, k));
  if (Array.isArray(v)) return v.map((x) => interp(x, vars));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, interp(x, vars)]));
  return v;
}

export function lookup(vars, k) {
  const v = k.split('.').reduce((o, p) => (o == null ? undefined : o[p]), vars);
  if (v === undefined) throw new Error(`undefined variable {{${k}}}`);
  return String(v);
}

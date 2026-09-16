// D1 exports/imports and dynamically created working databases require the REST
// API. Original production traffic continues to use its native D1 binding.
export async function cloudApi<T>(env: CloudflareEnv, path: string, body?: unknown, method = "POST"): Promise<T> {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.BACKUP_ACCOUNT_ID}/d1/database${path}`, {
    method, headers: { Authorization: `Bearer ${env.BACKUP_API_TOKEN}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000),
  });
  const data = await response.json() as { success: boolean; result: T };
  // Do not return provider errors or signed URLs to the browser/logs.
  if (!response.ok || !data.success) throw new Error(`Cloudflare database operation failed (${response.status}).`);
  return data.result;
}
class Statement implements D1PreparedStatement {
  constructor(readonly env: CloudflareEnv, readonly database: string, readonly sql: string, readonly params: unknown[] = []) {}
  bind(...params: unknown[]) { return new Statement(this.env, this.database, this.sql, params); }
  async all<T = Record<string, unknown>>() { return (await query<T>(this.env, this.database, [this]))[0]; }
  run<T = Record<string, unknown>>() { return this.all<T>(); }
  async first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const result = await this.all<Record<string, unknown>>();
    const row = result.results[0];
    if (!row) return null;
    if (column !== undefined && !(column in row)) throw new Error("Column not found.");
    return (column === undefined ? row : row[column]) as T;
  }
  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const { results } = await this.all<Record<string, unknown>>();
    const rows = results.map(row => Object.values(row) as T);
    return options?.columnNames ? [Object.keys(results[0] ?? {}), ...rows] : rows;
  }
}
async function query<T>(env: CloudflareEnv, id: string, statements: Statement[]): Promise<D1Result<T>[]> {
  // D1's REST endpoint accepts either one query object or a `{ batch }` object;
  // it does not accept an array as the top-level JSON value.
  const results = await cloudApi<D1Result<T>[]>(env, `/${id}/query`, { batch: statements.map(s => ({ sql: s.sql, params: s.params })) });
  if (results.length !== statements.length || results.some(r => !r.success)) throw new Error("Working database query failed.");
  return results;
}
export function workingDatabase(env: CloudflareEnv, id: string): D1Database {
  return {
    prepare: sql => new Statement(env, id, sql),
    batch: <T>(statements: D1PreparedStatement[]) => {
      if (statements.some(s => !(s instanceof Statement) || s.database !== id)) throw new Error("Mixed database batch rejected.");
      return query<T>(env, id, statements as Statement[]);
    },
    exec: async () => { throw new Error("Use prepared statements for working databases."); },
    dump: async () => { throw new Error("Use production backups to export databases."); },
    withSession: () => { throw new Error("Working database sessions are not supported."); },
  };
}
export function prefixedImages(bucket: R2Bucket, prefix: string): R2Bucket {
  const key = (value: string) => {
    if (!value || value.startsWith("/") || value.split("/").includes("..")) throw new Error("Invalid image key.");
    return prefix + value;
  };
  return new Proxy(bucket, { get(target, property) {
    if (property === 'then') return undefined;
    if (property === "list") return async (options?: R2ListOptions) => {
      const result = await target.list({ ...options, prefix: prefix + (options?.prefix ?? ''),
        ...(options?.startAfter ? { startAfter: key(options.startAfter) } : {}) });
      return { ...result, objects: result.objects.filter(object => object.key.startsWith(prefix)).map(object => ({
        key: object.key.slice(prefix.length), size: object.size, uploaded: object.uploaded,
        httpMetadata: object.httpMetadata, customMetadata: object.customMetadata,
        version: object.version, etag: object.etag, httpEtag: object.httpEtag,
        checksums: object.checksums, storageClass: object.storageClass,
        writeHttpMetadata: object.writeHttpMetadata.bind(object),
      })), delimitedPrefixes: result.delimitedPrefixes.filter(value => value.startsWith(prefix)).map(value => value.slice(prefix.length)) };
    };
    if (property === "get") return (name: string, options?: R2GetOptions) => target.get(key(name), options);
    if (property === "head") return (name: string) => target.head(key(name));
    if (property === "put") return (name: string, value: Parameters<R2Bucket["put"]>[1], options?: R2PutOptions) => target.put(key(name), value, options);
    if (property === "delete") return (names: string | string[]) => target.delete(Array.isArray(names) ? names.map(key) : key(names));
    // Do not accidentally expose the entire backup bucket through an unsupported operation.
    return () => { throw new Error(`Unsupported working-image operation: ${String(property)}`); };
  } });
}

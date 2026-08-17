import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

/*
 * Lazy connection.
 *
 * `pool` and `db` used to be constructed at module load, with a hard throw if
 * DATABASE_URL was absent. Because route modules import this file at the top,
 * merely importing a route — to unit-test a pure function inside it — demanded
 * a live database. A test for a string-sanitising helper could not run without
 * Postgres, purely because a sibling function in the same file needed it.
 *
 * Both exports are now proxies that construct the real pool/drizzle instance
 * on first property access. Importing this module is free; the DATABASE_URL
 * check still fires — with the same message — the moment anything actually
 * touches the database. Behaviour for the running server is unchanged, since
 * it queries immediately on the first request either way.
 */

let realPool: pg.Pool | undefined;
let realDb: NodePgDatabase<typeof schema> | undefined;

function getPool(): pg.Pool {
  if (!realPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL must be set. Did you forget to provision a database?",
      );
    }
    realPool = new Pool({ connectionString });
  }
  return realPool;
}

function getDb(): NodePgDatabase<typeof schema> {
  if (!realDb) realDb = drizzle(getPool(), { schema });
  return realDb;
}

/** Forwards every access to the underlying instance, building it on demand. */
function lazyProxy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop, receiver) {
      const target = resolve();
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(_target, prop, value) {
      return Reflect.set(resolve(), prop, value);
    },
    has(_target, prop) {
      return Reflect.has(resolve(), prop);
    },
    ownKeys(_target) {
      return Reflect.ownKeys(resolve());
    },
    getOwnPropertyDescriptor(_target, prop) {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), prop);
      /* Proxy invariant: reported descriptors must be configurable, because
         the dummy target has no matching non-configurable property. */
      return descriptor ? { ...descriptor, configurable: true } : undefined;
    },
    getPrototypeOf(_target) {
      return Reflect.getPrototypeOf(resolve());
    },
  });
}

export const pool: pg.Pool = lazyProxy(getPool);
export const db: NodePgDatabase<typeof schema> = lazyProxy(getDb);

export * from "./schema";

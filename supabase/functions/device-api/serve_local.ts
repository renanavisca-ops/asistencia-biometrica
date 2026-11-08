// Solo desarrollo: sirve el handler real contra una base local (DATABASE_URL) en http://127.0.0.1:8787/device-api/*
import { createDb } from './db.ts';
import { createHandler } from './handler.ts';
const handler = createHandler(createDb(Deno.env.get('DATABASE_URL')!), (m, e) => console.error(m, JSON.stringify(e)));
Deno.serve({ port: 8787, hostname: '127.0.0.1' }, handler);

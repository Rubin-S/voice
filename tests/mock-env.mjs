import {DatabaseSync} from 'node:sqlite';
const database=new DatabaseSync(':memory:');
database.exec('CREATE TABLE game_sessions(id TEXT PRIMARY KEY,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL)');
export const env={DB:{prepare(sql){let args=[];return{bind(...values){args=values;return this;},async first(){return database.prepare(sql).get(...args)||null;},async run(){const r=database.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};}}};
export function clear(){database.exec('DELETE FROM game_sessions');delete env.SARVAM_API_KEY;}

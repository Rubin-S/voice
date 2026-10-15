import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const sessions=sqliteTable('game_sessions',{
 id:text('id').primaryKey(),
 payload:text('payload').notNull(),
 version:integer('version').notNull().default(0),
 updatedAt:integer('updated_at').notNull(),
});

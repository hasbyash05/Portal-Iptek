const { sqliteTable, integer, text, real } = require('drizzle-orm/sqlite-core');

const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  password_hash: text('password_hash').notNull(),
  nama_lengkap: text('nama_lengkap').notNull(),
  role: text('role').notNull(),
  divisi: text('divisi'),
  created_at: text('created_at').notNull(),
});

const weeklyReports = sqliteTable('weekly_reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  week_number: integer('week_number').notNull(),
  year: integer('year').notNull(),
  activity: text('activity').notNull(),
  attachment_path: text('attachment_path'),
  submitted_at: text('submitted_at').notNull(),
});

const teachingMaterials = sqliteTable('teaching_materials', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  file_path: text('file_path').notNull(),
  week_number: integer('week_number').notNull(),
  year: integer('year').notNull(),
  created_at: text('created_at').notNull(),
});

const attendances = sqliteTable('attendances', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  status: text('status').notNull(),
  created_at: text('created_at').notNull(),
});

const payments = sqliteTable('payments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  user_id: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  amount: real('amount').notNull().default(10000),
  month: integer('month').notNull(),
  year: integer('year').notNull(),
  proof_path: text('proof_path'),
  status: text('status').default('pending'),
  confirmed_by: integer('confirmed_by').references(() => users.id, { onDelete: 'set null' }),
  confirmed_at: text('confirmed_at'),
  created_at: text('created_at').notNull(),
});

module.exports = {
  users,
  weeklyReports,
  teachingMaterials,
  attendances,
  payments,
};

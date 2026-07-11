module.exports = {
  schema: './src/drizzle/schema.js',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: './database.sqlite',
  },
};

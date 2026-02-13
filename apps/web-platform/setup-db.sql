-- Setup script for Korean SEC database
-- Run this as: sudo -u postgres psql -f setup-db.sql

-- Create user if not exists
DO
$$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = 'koreansec') THEN
      CREATE USER koreansec WITH PASSWORD 'koreansec123' CREATEDB;
   ELSE
      ALTER USER koreansec CREATEDB;
   END IF;
END
$$;

-- Create database if not exists
SELECT 'CREATE DATABASE koreansec_db OWNER koreansec'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'koreansec_db')\gexec

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE koreansec_db TO koreansec;

-- Connect to the database and grant schema privileges
\c koreansec_db
GRANT ALL ON SCHEMA public TO koreansec;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO koreansec;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO koreansec;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO koreansec;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO koreansec;

\echo 'Database setup complete!'
\echo 'User: koreansec'
\echo 'Database: koreansec_db'
\echo 'You can now run: npm install && cd backend && npx prisma migrate dev'

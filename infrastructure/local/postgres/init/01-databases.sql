SELECT 'CREATE DATABASE rp_gant_project'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'rp_gant_project')\gexec

SELECT 'CREATE DATABASE rp_gant_notification'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'rp_gant_notification')\gexec

SELECT 'CREATE DATABASE rp_gant_audit'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'rp_gant_audit')\gexec

SELECT 'CREATE DATABASE rp_gant_sync'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'rp_gant_sync')\gexec

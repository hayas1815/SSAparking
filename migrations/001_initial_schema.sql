-- Migration 001: Initial Schema Setup for SSA Two-Wheeler Parking System

CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE SEQUENCE IF NOT EXISTS parking_token_seq START WITH 500;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  role VARCHAR(50) NOT NULL DEFAULT 'owner',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parking_entries (
  id SERIAL PRIMARY KEY,
  token_no INTEGER UNIQUE NOT NULL,
  barcode VARCHAR(255),
  veh_type VARCHAR(50) NOT NULL DEFAULT 'BIKE 15',
  veh_no VARCHAR(50) NOT NULL,
  cust_name VARCHAR(255),
  mobile_no VARCHAR(50),
  rate NUMERIC(10,2) DEFAULT 15,
  payment_mode VARCHAR(50) DEFAULT 'CASH',
  in_date VARCHAR(50) NOT NULL,
  entry_time VARCHAR(50) NOT NULL,
  status VARCHAR(50) DEFAULT 'ACTIVE',
  exit_time VARCHAR(50),
  total_hours INTEGER DEFAULT 1,
  total_amount NUMERIC(10,2),
  created_by INTEGER,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exit_history (
  id SERIAL PRIMARY KEY,
  token_no INTEGER NOT NULL,
  barcode VARCHAR(255),
  veh_type VARCHAR(50) NOT NULL,
  veh_no VARCHAR(50) NOT NULL,
  cust_name VARCHAR(255),
  mobile_no VARCHAR(50),
  rate NUMERIC(10,2),
  payment_mode VARCHAR(50),
  in_date VARCHAR(50) NOT NULL,
  entry_time VARCHAR(50) NOT NULL,
  exit_date VARCHAR(50) NOT NULL,
  exit_time VARCHAR(50) NOT NULL,
  fine_amount NUMERIC(10,2) DEFAULT 0,
  total_amount NUMERIC(10,2),
  created_by INTEGER,
  exited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  username VARCHAR(255),
  role VARCHAR(50),
  action VARCHAR(100) NOT NULL,
  ip_address VARCHAR(100),
  user_agent TEXT,
  details TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Foreign keys
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_pe_created_by') THEN
    ALTER TABLE parking_entries ADD CONSTRAINT fk_pe_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_eh_created_by') THEN
    ALTER TABLE exit_history ADD CONSTRAINT fk_eh_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_al_user_id') THEN
    ALTER TABLE audit_logs ADD CONSTRAINT fk_al_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_pe_veh_no ON parking_entries (UPPER(veh_no));
CREATE INDEX IF NOT EXISTS idx_pe_token_no ON parking_entries (token_no);
CREATE INDEX IF NOT EXISTS idx_pe_barcode ON parking_entries (barcode);
CREATE INDEX IF NOT EXISTS idx_pe_status ON parking_entries (status);
CREATE INDEX IF NOT EXISTS idx_pe_created_at ON parking_entries (created_at);
CREATE INDEX IF NOT EXISTS idx_pe_mobile_no ON parking_entries (mobile_no);
CREATE INDEX IF NOT EXISTS idx_eh_veh_no ON exit_history (UPPER(veh_no));
CREATE INDEX IF NOT EXISTS idx_eh_token_no ON exit_history (token_no);
CREATE INDEX IF NOT EXISTS idx_eh_barcode ON exit_history (barcode);
CREATE INDEX IF NOT EXISTS idx_eh_mobile_no ON exit_history (mobile_no);
CREATE INDEX IF NOT EXISTS idx_eh_exited_at ON exit_history (exited_at);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (LOWER(username));
CREATE INDEX IF NOT EXISTS idx_al_user_id ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_al_created_at ON audit_logs (created_at);

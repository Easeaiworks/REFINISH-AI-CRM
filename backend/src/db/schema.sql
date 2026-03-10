-- CRM Database Schema (PostgreSQL / Supabase)
-- CHC Paint & Auto Body Supplies

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'rep' CHECK(role IN ('rep', 'manager', 'admin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  shop_name TEXT NOT NULL,
  address TEXT,
  city TEXT,
  area TEXT,
  province TEXT DEFAULT 'ON',
  contact_names TEXT,
  phone TEXT,
  email TEXT,
  account_type TEXT DEFAULT 'collision',
  assigned_rep_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'prospect' CHECK(status IN ('prospect', 'active', 'cold', 'dnc', 'churned')),
  suppliers TEXT,
  paint_line TEXT,
  allied_products TEXT,
  sundries TEXT,
  has_contract BOOLEAN DEFAULT false,
  mpo TEXT,
  num_techs INTEGER,
  sq_footage TEXT,
  annual_revenue REAL,
  former_sherwin_client BOOLEAN DEFAULT false,
  follow_up_date TEXT,
  last_contacted_at TIMESTAMPTZ,
  tags JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notes (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  created_by_id INTEGER NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  is_voice_transcribed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  rep_id INTEGER NOT NULL REFERENCES users(id),
  activity_type TEXT NOT NULL CHECK(activity_type IN ('call', 'email', 'meeting', 'visit', 'other')),
  description TEXT,
  scheduled_date TIMESTAMPTZ,
  completed_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales_data (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id),
  rep_id INTEGER REFERENCES users(id),
  sale_amount REAL NOT NULL,
  sale_date TEXT NOT NULL,
  month TEXT NOT NULL,
  memo TEXT,
  customer_name TEXT,
  imported_from_accountedge BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  action TEXT NOT NULL CHECK(action IN ('create', 'update', 'delete', 'import', 'login', 'logout')),
  changes JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS duplicate_flags (
  id SERIAL PRIMARY KEY,
  account_1_id INTEGER NOT NULL REFERENCES accounts(id),
  account_2_id INTEGER NOT NULL REFERENCES accounts(id),
  similarity_score REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'merged', 'dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_accounts_shop_name ON accounts(shop_name);
CREATE INDEX IF NOT EXISTS idx_accounts_city ON accounts(city);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_assigned_rep ON accounts(assigned_rep_id);
CREATE INDEX IF NOT EXISTS idx_accounts_last_contacted ON accounts(last_contacted_at);
CREATE INDEX IF NOT EXISTS idx_notes_account ON notes(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activities_account ON activities(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_account ON sales_data(account_id);
CREATE INDEX IF NOT EXISTS idx_sales_month ON sales_data(month);
CREATE INDEX IF NOT EXISTS idx_sales_rep ON sales_data(rep_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);

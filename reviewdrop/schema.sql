-- Run this in your Supabase SQL Editor (Database > SQL Editor > New Query)

-- Projects table
create table if not exists projects (
  key text primary key,
  name text not null,
  type text not null default 'image',
  page_count integer not null default 1,
  thumbnail_url text,
  open_count integer not null default 0,
  resolved_count integer not null default 0,
  uploaded_at timestamp with time zone default now()
);

-- Comments table
create table if not exists comments (
  id uuid default gen_random_uuid() primary key,
  project_key text not null references projects(key) on delete cascade,
  page integer not null default 0,
  x float not null,
  y float not null,
  author text not null,
  text text not null,
  color text not null default '#3B82F6',
  resolved boolean not null default false,
  created_at timestamp with time zone default now()
);

-- Indexes for fast lookups
create index if not exists comments_project_page on comments(project_key, page);

-- Enable Row Level Security (allow public read/write for simplicity)
alter table projects enable row level security;
alter table comments enable row level security;

create policy "Public read projects" on projects for select using (true);
create policy "Public insert projects" on projects for insert with check (true);
create policy "Public update projects" on projects for update using (true);
create policy "Public delete projects" on projects for delete using (true);

create policy "Public read comments" on comments for select using (true);
create policy "Public insert comments" on comments for insert with check (true);
create policy "Public update comments" on comments for update using (true);
create policy "Public delete comments" on comments for delete using (true);

-- Enable Realtime on comments table
alter publication supabase_realtime add table comments;

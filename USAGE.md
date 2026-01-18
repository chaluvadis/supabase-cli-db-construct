# Usage Example

This example shows how to use the Supabase Database Extractor tool.

## Step 1: Set up your environment

Create a `.env` file with your Supabase credentials:

```bash
cp .env.example .env
```

Edit the `.env` file:

```env
SUPABASE_URL=https://xxxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
DATABASE_URL=postgresql://postgres:your-password@db.xxxxxxxxxxxxx.supabase.co:5432/postgres
```

## Step 2: Run the extraction

```bash
npm start
```

## Step 3: Check the output

The tool will create an `output/` directory with two files:

```
output/
├── database_reconstruction.sql  # SQL script to recreate the database
└── database_data.json          # JSON file with all the data
```

## Step 4: Reconstruct the database

To recreate the database elsewhere:

```bash
# Using psql
psql -U postgres -d your_database < output/database_reconstruction.sql

# Or using Docker
docker run -i postgres:15 psql -U postgres -d your_database < output/database_reconstruction.sql
```

## Example Output

```
🚀 Supabase Database Extractor

📊 Discovering tables...
✅ Found 5 tables

📥 Extracting data from tables...
  📥 Extracting: users
     ✓ 150 rows
  📥 Extracting: posts
     ✓ 300 rows
  📥 Extracting: comments
     ✓ 1200 rows
  📥 Extracting: categories
     ✓ 10 rows
  📥 Extracting: tags
     ✓ 25 rows
✅ Extracted data from 5 tables

📝 Generating SQL reconstruction script...
✅ SQL script saved to: /path/to/output/database_reconstruction.sql

✅ JSON data saved to: /path/to/output/database_data.json

🎉 Database extraction complete!

To reconstruct the database offline:
  psql your_database < /path/to/output/database_reconstruction.sql
```

## Troubleshooting

### Permission Denied

If you see "Error fetching data from table", make sure you're using the **service role key**, not the anon key. The service role key has full database access.

### Cannot Discover Tables

If the tool cannot find tables automatically, make sure you've set the `DATABASE_URL` in your `.env` file. This enables direct PostgreSQL access for schema introspection.

### Connection Timeout

If you're extracting a large database, the process may take several minutes. Be patient and watch the progress in the console.

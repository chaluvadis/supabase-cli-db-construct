# Supabase CLI Database Construct

A command-line tool to extract all tables and data from a Supabase database and reconstruct it for offline use.

## Features

- 🔍 **Automatic Table Discovery**: Discovers all tables in your Supabase database
- 📥 **Complete Data Extraction**: Extracts all data from all tables
- 📝 **SQL Generation**: Generates complete SQL reconstruction scripts
- 💾 **Multiple Output Formats**: Saves data in both SQL and JSON formats
- 🔄 **Batch Processing**: Handles large datasets efficiently with pagination
- 🛡️ **Error Handling**: Robust error handling and progress reporting

## Prerequisites

- Node.js 16 or higher
- Access to a Supabase project
- Database credentials (URL and service role key)

## Installation

1. Clone this repository:
```bash
git clone https://github.com/chaluvadis/supabase-cli-db-construct.git
cd supabase-cli-db-construct
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Configure your environment variables in `.env`:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.your-project.supabase.co:5432/postgres
```

## Usage

### Build the project

```bash
npm run build
```

### Run the extraction

```bash
npm start
```

Or during development:

```bash
npm run dev
```

## Output

The tool generates two files in the `output/` directory:

1. **database_reconstruction.sql**: Complete SQL script with schema and data
   - Contains CREATE TABLE statements (when DATABASE_URL is provided)
   - Contains INSERT statements for all data
   - Can be run directly with `psql` to reconstruct the database

2. **database_data.json**: JSON file with all extracted data
   - Useful for programmatic access to the data
   - Easy to parse and manipulate

## Reconstructing the Database

To reconstruct your database offline using the generated SQL file:

```bash
psql your_local_database < output/database_reconstruction.sql
```

Or using Docker with PostgreSQL:

```bash
docker run -i postgres:15 psql -U postgres < output/database_reconstruction.sql
```

## Configuration

### Environment Variables

- **SUPABASE_URL** (required): Your Supabase project URL
- **SUPABASE_SERVICE_ROLE_KEY** (required): Service role key for full database access
- **DATABASE_URL** (optional): Direct PostgreSQL connection string for schema extraction

**Note**: For best results, provide the `DATABASE_URL`. This enables full schema extraction including table structures, constraints, and indexes. Without it, only data INSERT statements will be generated.

## How It Works

1. **Connection**: Connects to your Supabase database using the provided credentials
2. **Discovery**: Queries the `information_schema` to discover all tables
3. **Extraction**: Iterates through each table and extracts all rows (in batches of 1000)
4. **Schema Generation**: Extracts table schemas, columns, data types, and constraints
5. **SQL Generation**: Creates a complete SQL reconstruction script
6. **Export**: Saves both SQL and JSON files to the output directory

## Limitations

- Currently supports the `public` schema only
- Large databases may take time to extract (progress is shown in console)
- Binary data (BLOBs) may need special handling
- Custom PostgreSQL types may require manual adjustment

## Troubleshooting

### "Missing required environment variables"
Make sure your `.env` file exists and contains valid `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

### "Cannot discover tables automatically"
Provide the `DATABASE_URL` in your `.env` file for automatic table discovery.

### "Error fetching data from table"
Ensure your service role key has sufficient permissions to read all tables.

## Security Notes

- Never commit your `.env` file to version control
- Keep your service role key secure
- Use environment variables or secure vaults in production
- The service role key bypasses Row Level Security (RLS)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
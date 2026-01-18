import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';

export interface TableInfo {
  name: string;
  schema: string;
}

export interface SupabaseExtractorConfig {
  supabaseUrl: string;
  supabaseKey: string;
  databaseUrl?: string;
}

export class SupabaseExtractor {
  private supabase: SupabaseClient;
  private config: SupabaseExtractorConfig;

  constructor(config: SupabaseExtractorConfig) {
    this.config = config;
    this.supabase = createClient(config.supabaseUrl, config.supabaseKey);
  }

  /**
   * Discover all tables in the public schema
   */
  async discoverTables(): Promise<TableInfo[]> {
    if (this.config.databaseUrl) {
      return this.discoverTablesViaPg();
    } else {
      return this.discoverTablesViaSupabase();
    }
  }

  /**
   * Discover tables using direct PostgreSQL connection
   */
  private async discoverTablesViaPg(): Promise<TableInfo[]> {
    const client = new PgClient({ connectionString: this.config.databaseUrl });
    
    try {
      await client.connect();
      
      const query = `
        SELECT table_name, table_schema
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `;
      
      const result = await client.query(query);
      
      return result.rows.map(row => ({
        name: row.table_name,
        schema: row.table_schema
      }));
    } finally {
      await client.end();
    }
  }

  /**
   * Discover tables using Supabase client (fallback method)
   * This tries to query information_schema through RPC or uses a predefined list
   */
  private async discoverTablesViaSupabase(): Promise<TableInfo[]> {
    // Try to use a custom RPC function if available
    // Otherwise, user needs to provide table names or use DATABASE_URL
    console.warn('⚠️  Using Supabase client for table discovery. For better results, set DATABASE_URL.');
    
    // Try to query via stored procedure if it exists
    try {
      const { data, error } = await this.supabase.rpc('get_all_tables');
      if (!error && data) {
        return data.map((table: any) => ({
          name: table.table_name,
          schema: table.table_schema || 'public'
        }));
      }
    } catch (e) {
      // RPC function doesn't exist, continue with alternative
    }

    // Fallback: Return empty array and suggest using DATABASE_URL
    console.error('Cannot discover tables automatically. Please set DATABASE_URL or use PostgreSQL connection.');
    return [];
  }

  /**
   * Extract all data from specified tables
   */
  async extractAllData(tables: TableInfo[]): Promise<Record<string, any[]>> {
    const allData: Record<string, any[]> = {};

    for (const table of tables) {
      try {
        console.log(`  📥 Extracting: ${table.name}`);
        const data = await this.extractTableData(table.name);
        allData[table.name] = data;
        console.log(`     ✓ ${data.length} rows`);
      } catch (error) {
        console.error(`     ✗ Error extracting ${table.name}:`, error);
        allData[table.name] = [];
      }
    }

    return allData;
  }

  /**
   * Extract data from a single table
   */
  private async extractTableData(tableName: string): Promise<any[]> {
    const allRows: any[] = [];
    let offset = 0;
    const limit = 1000; // Fetch in batches
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await this.supabase
        .from(tableName)
        .select('*')
        .range(offset, offset + limit - 1);

      if (error) {
        throw new Error(`Error fetching data from ${tableName}: ${error.message}`);
      }

      if (data && data.length > 0) {
        allRows.push(...data);
        offset += limit;
        hasMore = data.length === limit;
      } else {
        hasMore = false;
      }
    }

    return allRows;
  }

  /**
   * Generate SQL script for database reconstruction
   */
  async generateReconstructionSQL(tables: TableInfo[], data: Record<string, any[]>): Promise<string> {
    let sql = '-- Database Reconstruction Script\n';
    sql += `-- Generated: ${new Date().toISOString()}\n\n`;
    sql += '-- Disable triggers and constraints during import\n';
    sql += 'SET session_replication_role = replica;\n\n';

    // Get schema information if DATABASE_URL is available
    if (this.config.databaseUrl) {
      const schemaSQL = await this.extractSchema(tables);
      sql += schemaSQL;
    } else {
      sql += '-- Note: Schema extraction requires DATABASE_URL to be set.\n';
      sql += '-- Only data INSERT statements are included below.\n\n';
    }

    // Generate INSERT statements for each table
    for (const table of tables) {
      const tableData = data[table.name];
      
      if (!tableData || tableData.length === 0) {
        sql += `-- No data for table: ${table.name}\n\n`;
        continue;
      }

      sql += `-- Data for table: ${table.name}\n`;
      sql += `-- Rows: ${tableData.length}\n\n`;

      for (const row of tableData) {
        const columns = Object.keys(row);
        const values = columns.map(col => this.formatValue(row[col]));
        
        sql += `INSERT INTO ${table.schema}.${table.name} (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${values.join(', ')});\n`;
      }

      sql += '\n';
    }

    sql += '\n-- Re-enable triggers and constraints\n';
    sql += 'SET session_replication_role = DEFAULT;\n';

    return sql;
  }

  /**
   * Extract database schema (tables, columns, constraints)
   */
  private async extractSchema(tables: TableInfo[]): Promise<string> {
    const client = new PgClient({ connectionString: this.config.databaseUrl });
    let sql = '-- Database Schema\n\n';

    try {
      await client.connect();

      for (const table of tables) {
        // Get CREATE TABLE statement
        const createTableQuery = `
          SELECT 
            'CREATE TABLE IF NOT EXISTS ' || quote_ident(table_schema) || '.' || quote_ident(table_name) || ' (' ||
            string_agg(
              quote_ident(column_name) || ' ' || 
              data_type ||
              CASE 
                WHEN character_maximum_length IS NOT NULL 
                THEN '(' || character_maximum_length || ')'
                ELSE ''
              END ||
              CASE 
                WHEN is_nullable = 'NO' THEN ' NOT NULL'
                ELSE ''
              END ||
              CASE 
                WHEN column_default IS NOT NULL THEN ' DEFAULT ' || column_default
                ELSE ''
              END,
              ', '
            ) || ');' as create_statement
          FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2
          GROUP BY table_schema, table_name;
        `;

        const result = await client.query(createTableQuery, [table.schema, table.name]);
        
        if (result.rows.length > 0) {
          sql += `-- Table: ${table.schema}.${table.name}\n`;
          sql += result.rows[0].create_statement + '\n\n';
        }
      }

      // Get indexes
      const indexQuery = `
        SELECT 
          schemaname,
          tablename,
          indexname,
          indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname;
      `;

      const indexResult = await client.query(indexQuery);
      
      if (indexResult.rows.length > 0) {
        sql += '-- Indexes\n\n';
        for (const row of indexResult.rows) {
          sql += `${row.indexdef};\n`;
        }
        sql += '\n';
      }

    } finally {
      await client.end();
    }

    return sql;
  }

  /**
   * Format a value for SQL INSERT statement
   */
  private formatValue(value: any): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }

    if (typeof value === 'string') {
      // Escape single quotes
      return `'${value.replace(/'/g, "''")}'`;
    }

    if (typeof value === 'boolean') {
      return value ? 'TRUE' : 'FALSE';
    }

    if (typeof value === 'number') {
      return value.toString();
    }

    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }

    if (typeof value === 'object') {
      // Handle JSON objects
      return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
    }

    return `'${String(value).replace(/'/g, "''")}'`;
  }
}

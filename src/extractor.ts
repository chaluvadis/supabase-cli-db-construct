import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";

export interface TableInfo {
	name: string;
	schema: string;
}

export interface SupabaseExtractorConfig {
	supabaseUrl: string;
	supabaseKey: string;
	databaseUrl?: string;
	verbose?: boolean;
}

export class SupabaseExtractor {
	private supabase: SupabaseClient;
	private config: SupabaseExtractorConfig;
	private columnTypes: Map<string, Map<string, string>> = new Map();

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

			return result.rows.map((row) => ({
				name: row.table_name,
				schema: row.table_schema,
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
		console.warn(
			"⚠️  Using Supabase client for table discovery. For better results, set DATABASE_URL.",
		);

		// Try to query via stored procedure if it exists
		try {
			const { data, error } = await this.supabase.rpc("get_all_tables");
			if (!error && data) {
				return data.map((table: any) => ({
					name: table.table_name,
					schema: table.table_schema || "public",
				}));
			}
		} catch (e) {
			// RPC function doesn't exist, continue with alternative
		}

		// Fallback: Return empty array and suggest using DATABASE_URL
		console.error(
			"Cannot discover tables automatically. Please set DATABASE_URL or use PostgreSQL connection.",
		);
		return [];
	}

	/**
	 * Fetch column type information for a table
	 */
	private async fetchColumnTypes(tableName: string, schema: string = 'public'): Promise<Map<string, string>> {
		if (!this.config.databaseUrl) {
			return new Map();
		}

		const client = new PgClient({ connectionString: this.config.databaseUrl });

		try {
			await client.connect();

			const query = `
				SELECT column_name, data_type
				FROM information_schema.columns
				WHERE table_schema = $1 AND table_name = $2;
			`;

			const result = await client.query(query, [schema, tableName]);
			const typeMap = new Map<string, string>();

			for (const row of result.rows) {
				typeMap.set(row.column_name, row.data_type);
			}

			return typeMap;
		} finally {
			await client.end();
		}
	}

	/**
	 * Extract all data from specified tables
	 */
	async extractAllData(tables: TableInfo[]): Promise<Record<string, any[]>> {
		const allData: Record<string, any[]> = {};

		// Fetch column types for all tables if DATABASE_URL is available
		if (this.config.databaseUrl) {
			for (const table of tables) {
				try {
					const types = await this.fetchColumnTypes(table.name, table.schema);
					this.columnTypes.set(table.name, types);
				} catch (error) {
					console.warn(`Warning: Could not fetch column types for ${table.name}`);
				}
			}
		}

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

		if (this.config.verbose) {
			console.log(`🔍 Starting data extraction for table: ${tableName}`);
		}

		while (hasMore) {
			if (this.config.verbose) {
				console.log(`📊 Fetching batch: offset=${offset}, limit=${limit}`);
			}

			// Only request count on the first batch for performance
			const { data, error } = await this.supabase
				.from(tableName)
				.select("*")
				.range(offset, offset + limit - 1);

			if (error) {
				console.error(`❌ Error fetching data from ${tableName}:`, error);
				throw new Error(
					`Error fetching data from ${tableName}: ${error.message}`,
				);
			}

			if (this.config.verbose) {
				console.log(`📥 Received ${data?.length || 0} rows in this batch`);
			}

			if (data && data.length > 0) {
				allRows.push(...data);
				offset += limit;
				hasMore = data.length === limit;
				if (this.config.verbose) {
					console.log(`📈 Total rows collected so far: ${allRows.length}`);
				}
			} else {
				hasMore = false;
				if (this.config.verbose) {
					console.log(`🛑 No more data to fetch for ${tableName}`);
				}
			}
		}

		if (this.config.verbose) {
			console.log(
				`✅ Completed extraction for ${tableName}: ${allRows.length} total rows`,
			);
		}
		return allRows;
	}

	/**
	 * Generate SQL script for database reconstruction
	 */
	async generateReconstructionSQL(
		tables: TableInfo[],
		data: Record<string, any[]>,
	): Promise<string> {
		let sql = "-- Database Reconstruction Script\n";
		sql += `-- Generated: ${new Date().toISOString()}\n\n`;
		sql +=
			"-- Note: The following session_replication_role commands require superuser privileges\n";
		sql +=
			"-- and have been commented out. Uncomment if you have appropriate permissions.\n";
		sql += "-- SET session_replication_role = replica;\n\n";

		// Get schema information if DATABASE_URL is available
		if (this.config.databaseUrl) {
			const schemaSQL = await this.extractSchema(tables);
			sql += schemaSQL;
		} else {
			sql += "-- Note: Schema extraction requires DATABASE_URL to be set.\n";
			sql += "-- Only data INSERT statements are included below.\n\n";
		}

		// Generate INSERT statements for each table
		const insertSQL = await this.generateInsertStatements(tables, data);
		sql += insertSQL;

		sql += "\n-- Re-enable triggers and constraints\n";
		sql += "-- SET session_replication_role = DEFAULT;\n";

		return sql;
	}

	/**
	 * Extract database schema (tables, columns, constraints)
	 */
	private async extractSchema(tables: TableInfo[]): Promise<string> {
		const client = new PgClient({ connectionString: this.config.databaseUrl });
		let sql = "-- Database Schema\n\n";

		try {
			await client.connect();

			// First, extract enum types
			const enumQuery = `
	      SELECT
	        quote_ident(typname) as type_name,
	        'CREATE TYPE ' || quote_ident(typname) || ' AS ENUM (' ||
	        string_agg(quote_literal(enumlabel), ', ' ORDER BY pg_enum.enumsortorder) || ');' as create_enum
	      FROM pg_type
	      JOIN pg_enum ON pg_type.oid = pg_enum.enumtypid
	      JOIN pg_catalog.pg_namespace ON pg_type.typnamespace = pg_namespace.oid
	      WHERE pg_namespace.nspname = 'public'
	      GROUP BY typname, pg_type.oid;
	    `;

			const enumResult = await client.query(enumQuery);
			if (enumResult.rows.length > 0) {
				sql += "-- Enum Types\n\n";
				for (const row of enumResult.rows) {
					sql += `DROP TYPE IF EXISTS ${row.type_name} CASCADE;\n`;
					sql += `${row.create_enum}\n\n`;
				}
			}

			for (const table of tables) {
				// Get CREATE TABLE statement
				// Note: PostgreSQL 13+ includes gen_random_uuid() by default.
				// For older versions, you may need the uuid-ossp extension and uuid_generate_v4().
				const createTableQuery = `
			    SELECT
			      'CREATE TABLE IF NOT EXISTS ' || quote_ident(table_schema) || '.' || quote_ident(table_name) || ' (' ||
			      string_agg(
			        quote_ident(column_name) || ' ' ||
			        CASE
			          WHEN data_type = 'ARRAY' THEN 'text[]'
			          WHEN data_type = 'USER-DEFINED' THEN COALESCE(quote_ident(udt_schema) || '.', '') || quote_ident(udt_name)
			          ELSE data_type ||
			            CASE
			              WHEN character_maximum_length IS NOT NULL
			              THEN '(' || character_maximum_length || ')'
			              ELSE ''
			            END
			        END ||
			        CASE
			          WHEN is_nullable = 'NO' THEN ' NOT NULL'
			          ELSE ''
			        END ||
			        CASE
			          WHEN column_default IS NOT NULL THEN
			            CASE
			              WHEN column_default LIKE '%uuid_generate_v4()%' THEN ' DEFAULT gen_random_uuid()'
			              ELSE ' DEFAULT ' || column_default
			            END
			          ELSE ''
			        END,
			        ', '
			      ) || ');' as create_statement
			    FROM information_schema.columns
			    WHERE table_schema = $1 AND table_name = $2
			    GROUP BY table_schema, table_name;
			  `;

				const result = await client.query(createTableQuery, [
					table.schema,
					table.name,
				]);

				if (result.rows.length > 0) {
					sql += `-- Table: ${table.schema}.${table.name}\n`;
					sql += `${result.rows[0].create_statement}\n\n`;
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
				sql += "-- Indexes\n\n";
				for (const row of indexResult.rows) {
					sql += `${row.indexdef};\n`;
				}
				sql += "\n";
			}
		} finally {
			await client.end();
		}

		return sql;
	}

	/**
	 * Format a value for SQL INSERT statement
	 */
	private formatValue(value: any, tableName?: string, columnName?: string): string {
		if (value === null || value === undefined) {
			return "NULL";
		}

		if (typeof value === "string") {
			// Escape single quotes by doubling them (standard SQL escaping)
			return `'${value.replace(/'/g, "''")}'`;
		}

		if (typeof value === "boolean") {
			return value ? "TRUE" : "FALSE";
		}

		if (typeof value === "number") {
			// Check for valid numbers
			if (!Number.isFinite(value)) {
				return "NULL";
			}
			return value.toString();
		}

		if (value instanceof Date) {
			return `'${value.toISOString()}'`;
		}

		if (typeof value === "object") {
			// Check if this is an array column based on column type information
			const columnType = tableName && columnName && 
				this.columnTypes.get(tableName)?.get(columnName);
			const isArrayColumn = columnType?.endsWith('[]');

			if (isArrayColumn && Array.isArray(value)) {
				// Format as PostgreSQL array literal
				const escapedItems = value.map(
					(item: any) => `'${String(item).replace(/'/g, "''")}'`,
				);
				return `ARRAY[${escapedItems.join(",")}]::${columnType}`;
			}

			// Handle JSON objects - validate before stringifying
			try {
				const jsonStr = JSON.stringify(value);
				// Escape single quotes in JSON
				const escapedJson = jsonStr.replace(/'/g, "''");
				return `'${escapedJson}'::jsonb`;
			} catch (e) {
				console.warn("Warning: Could not serialize object to JSON, using NULL");
				return "NULL";
			}
		}

		// Fallback for other types
		return `'${String(value).replace(/'/g, "''")}'`;
	}

	/**
	 * Properly quote SQL identifiers to prevent injection
	 */
	private quoteIdentifier(identifier: string): string {
		// PostgreSQL identifier quoting: double quotes and escape any double quotes inside
		return `"${identifier.replace(/"/g, '""')}"`;
	}

	/**
	 * Generate INSERT statements for each table
	 */
	public async generateInsertStatements(
		tables: TableInfo[],
		data: Record<string, any[]>,
		includeDropStatements: boolean = false,
	): Promise<string> {
		let sql = "";

		for (const table of tables) {
			const tableData = data[table.name];

			if (!tableData || tableData.length === 0) {
				sql += `-- No data for table: ${table.name}\n\n`;
				continue;
			}

			if (includeDropStatements) {
				sql += `DROP TABLE IF EXISTS ${this.quoteIdentifier(table.schema)}.${this.quoteIdentifier(table.name)} CASCADE;\n`;
				sql += `-- Table: ${table.schema}.${table.name}\n`;
			}

			sql += `-- Data for table: ${table.name}\n`;
			sql += `-- Rows: ${tableData.length}\n\n`;

			for (const row of tableData) {
				const columns = Object.keys(row);
				const values = columns.map((col) => this.formatValue(row[col], table.name, col));

				sql += `INSERT INTO ${this.quoteIdentifier(table.schema)}.${this.quoteIdentifier(table.name)} (`;
				sql += columns.map((c) => this.quoteIdentifier(c)).join(", ");
				sql += `) VALUES (${values.join(", ")});\n`;
			}

			sql += "\n";
		}

		return sql;
	}
}

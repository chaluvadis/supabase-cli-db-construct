#!/usr/bin/env node

import { SupabaseExtractor } from "./extractor";
import * as dotenv from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";

dotenv.config();

async function main() {
	console.log("🚀 Supabase Database Extractor\n");

	// Validate environment variables
	const supabaseUrl = process.env.SUPABASE_URL;
	const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
	const databaseUrl = process.env.DATABASE_URL;

	if (!supabaseUrl || !supabaseKey) {
		console.error("❌ Error: Missing required environment variables.");
		console.error(
			"Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your .env file",
		);
		console.error(
			"Note: SUPABASE_SERVICE_ROLE_KEY (not ANON_KEY) is required for full database access",
		);
		console.error("See .env.example for reference");
		process.exit(1);
	}

	if (!databaseUrl) {
		console.warn(
			"⚠️  Warning: DATABASE_URL not set. Schema extraction may be limited.",
		);
	}

	try {
		const extractor = new SupabaseExtractor({
			supabaseUrl,
			supabaseKey,
			databaseUrl,
		});

		// Create output directory
		const outputDir = path.join(process.cwd(), "output");
		if (!fs.existsSync(outputDir)) {
			fs.mkdirSync(outputDir, { recursive: true });
		}

		console.log("📊 Discovering tables...");
		const tables = await extractor.discoverTables();
		console.log(`✅ Found ${tables.length} tables\n`);

		if (tables.length === 0) {
			console.log("No tables found in the database.");
			return;
		}

		console.log("📥 Extracting data from tables...");
		const extractedData = await extractor.extractAllData(tables);
		console.log(
			`✅ Extracted data from ${Object.keys(extractedData).length} tables\n`,
		);

		console.log("📝 Generating SQL reconstruction script...");
		const sqlScript = await extractor.generateReconstructionSQL(
			tables,
			extractedData,
		);

		// Write SQL file
		const sqlFilePath = path.join(outputDir, "database_reconstruction.sql");
		fs.writeFileSync(sqlFilePath, sqlScript);
		console.log(`✅ SQL script saved to: ${sqlFilePath}\n`);

		// Write SQL INSERT statements file with DROP TABLE statements
		const insertStatements = await extractor.generateInsertStatements(
			tables,
			extractedData,
			true,
		);
		const insertFilePath = path.join(outputDir, "database_inserts.sql");
		fs.writeFileSync(insertFilePath, insertStatements);
		console.log(
			`✅ SQL INSERT statements with DROP TABLE saved to: ${insertFilePath}\n`,
		);

		console.log("🎉 Database extraction complete!");
		console.log("\nTo reconstruct the database offline:");
		console.log(`  psql your_database < ${sqlFilePath}`);
	} catch (error) {
		console.error("❌ Error during extraction:", error);
		process.exit(1);
	}
}

main();

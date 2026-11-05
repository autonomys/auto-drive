package xyz.autonomys.auth;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.flywaydb.core.api.configuration.FluentConfiguration;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

/** A deployment boundary around Flyway; SQL execution and history belong to Flyway. */
public final class Migrations {
    static final String BASELINE = "20261027120000.2";
    static final String HISTORY = "auth_flyway_schema_history";
    static final Set<String> LEGACY = Set.of(
        "20250120110354-init-schema", "20250429134858-add-username",
        "20250620112629-indexes", "20260331000000-deletion-requests",
        "20260424120000-api-keys-name-expiry", "20261027120000-wallet-nonces");

    public static void main(String[] args) throws Exception {
        if (args.length != 1 || !Set.of("plan", "adopt", "migrate", "verify").contains(args[0])) {
            throw new IllegalArgumentException("Usage: java -jar auth-migrations.jar plan|adopt|migrate|verify");
        }
        var env = System.getenv();
        var config = configuration(jdbcUrl(env));
        execute(config, args[0], env.get("AUTH_MIGRATION_PLAN"));
    }

    static String jdbcUrl(Map<String, String> env) {
        String host = env.getOrDefault("DSQL_CLUSTER_ENDPOINT", "");
        String region = env.getOrDefault("AWS_REGION", "");
        if (!host.matches("[a-z0-9]+\\.dsql\\.[a-z0-9-]+\\.on\\.aws") || region.isBlank()
                || !host.endsWith(".dsql." + region + ".on.aws")) {
            throw new IllegalArgumentException("DSQL_CLUSTER_ENDPOINT must be an AWS DSQL hostname in AWS_REGION");
        }
        // Explicit auth target; never fall back to DATABASE_URL or the backend's config.
        return "jdbc:aws-dsql:postgresql://" + host + ":5432/postgres?sslmode=verify-full";
    }

    static FluentConfiguration configuration(String url) {
        var config = Flyway.configure()
            .dataSource(url, "admin", null)
            .defaultSchema("public")
            .schemas("public", "users")
            .createSchemas(false)
            .table(HISTORY)
            .locations("classpath:db/migration")
            .cleanDisabled(true)
            .baselineOnMigrate(false)
            .outOfOrder(false)
            .ignoreMigrationPatterns("*:pending")
            .validateMigrationNaming(true)
            .failOnMissingLocations(true);
        config.configuration(Map.of(
            "flyway.dsql.awaitAsyncIndexes", "true",
            "flyway.dsql.occMaxRetries", "3"));
        return config;
    }

    static void execute(FluentConfiguration config, String command, String planPath) throws Exception {
        var flyway = config.load();
        try (var connection = config.getDataSource().getConnection()) {
            boolean history = exists(connection, "public", HISTORY);
            boolean legacy = exists(connection, "public", "auth_migrations");
            boolean populated = !rows(connection,
                "SELECT table_name FROM information_schema.tables WHERE table_schema = 'users'").isEmpty();
            boolean adoptionRequired = !history && (legacy || populated);

            if (command.equals("plan")) {
                if (history) flyway.validate();
                // Never baseline or create history during a plan. An adoption mismatch fails closed.
                if (adoptionRequired) verifyBaseline(connection);
                var pending = flyway.info().pending();
                for (var migration : pending) {
                    System.out.println("Pending: " + migration.getVersion() + " " + migration.getDescription());
                }
                System.out.println("Baseline adoption required: " + adoptionRequired);
                if (planPath != null) {
                    Files.writeString(Path.of(planPath), "{\"pending\":" + pending.length
                        + ",\"adoptionRequired\":" + adoptionRequired + "}\n");
                }
                return;
            }

            if (command.equals("adopt")) {
                if (history || !adoptionRequired) {
                    throw new IllegalStateException("Adoption requires the legacy auth database without Flyway history");
                }
                verifyBaseline(connection);
                // Only record the verified legacy baseline; never apply later migrations in this mode.
                config.baselineOnMigrate(true).baselineVersion(BASELINE)
                    .baselineDescription("Verified legacy auth schema")
                    .target(MigrationVersion.fromVersion(BASELINE)).load().migrate();
                if (!rows(connection, "SELECT version FROM public." + HISTORY
                        + " WHERE type = 'BASELINE' AND success = true").equals(Set.of(BASELINE))) {
                    throw new IllegalStateException("Flyway did not record the expected baseline");
                }
                System.out.println("Adopted baseline " + BASELINE + "; legacy auth_migrations was preserved");
                return;
            }

            if (adoptionRequired) {
                throw new IllegalStateException("Existing auth schema requires the explicit adopt operation first");
            }
            if (command.equals("migrate")) flyway.migrate();
            if (!exists(connection, "public", HISTORY)) {
                throw new IllegalStateException("Flyway history is missing");
            }
            flyway.validate();
            if (flyway.info().pending().length != 0) {
                throw new IllegalStateException("Pending migrations remain");
            }
            var invalid = rows(connection, "SELECT c.relname FROM pg_index i "
                + "JOIN pg_class c ON c.oid = i.indexrelid "
                + "JOIN pg_namespace n ON n.oid = c.relnamespace "
                + "WHERE n.nspname = 'users' AND NOT i.indisvalid");
            if (!invalid.isEmpty()) throw new IllegalStateException("Invalid auth indexes: " + invalid);
            verifySchema(connection, "expected-schema.txt");
            System.out.println("Auth schema, migration history and index validity verified");
        }
    }

    static void verifyBaseline(Connection connection) throws Exception {
        if (!exists(connection, "public", "auth_migrations")) {
            throw new IllegalStateException("Legacy auth_migrations is missing; cannot adopt this database");
        }
        var names = rows(connection, "SELECT name FROM public.auth_migrations").stream()
            .map(name -> name.startsWith("/") ? name.substring(1) : name)
            .collect(Collectors.toSet());
        if (!names.equals(LEGACY)) {
            throw new IllegalStateException("Legacy migration names do not match the baseline: " + names);
        }
        verifySchema(connection, "baseline-schema.txt");
    }

    static void verifySchema(Connection connection, String snapshot) throws Exception {
        // Compare definitions, not only migration names: history is not proof that DDL committed.
        var expected = new TreeSet<>(resource(snapshot).lines()
            .filter(line -> !line.isBlank()).toList());
        var actual = rows(connection, resource("schema-inventory.sql"));
        var missing = new TreeSet<>(expected);
        missing.removeAll(actual);
        var unexpected = new TreeSet<>(actual);
        unexpected.removeAll(expected);
        if (!missing.isEmpty() || !unexpected.isEmpty()) {
            throw new IllegalStateException("Schema mismatch against " + snapshot + ". Missing/changed: " + missing
                + "; unexpected: " + unexpected + ". Reconcile definitions before continuing.");
        }
    }

    static boolean exists(Connection connection, String schema, String table) throws Exception {
        try (var statement = connection.prepareStatement(
                "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?")) {
            statement.setString(1, schema);
            statement.setString(2, table);
            try (var result = statement.executeQuery()) { return result.next(); }
        }
    }

    static Set<String> rows(Connection connection, String sql) throws Exception {
        var rows = new TreeSet<String>();
        try (var statement = connection.createStatement(); var result = statement.executeQuery(sql)) {
            while (result.next()) rows.add(result.getString(1));
        }
        return rows;
    }

    static String resource(String name) throws Exception {
        try (var stream = Migrations.class.getResourceAsStream("/" + name)) {
            if (stream == null) throw new IllegalStateException("Missing migration resource " + name);
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}

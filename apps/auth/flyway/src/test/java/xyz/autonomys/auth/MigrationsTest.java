package xyz.autonomys.auth;

import org.flywaydb.core.api.configuration.FluentConfiguration;
import org.flywaydb.community.database.dsql.DSQLConfigurationExtension;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

class MigrationsTest {
    @TempDir Path temporary;

    @Test void requiresAnExplicitDsqlTargetInTheSelectedRegion() {
        assertThrows(IllegalArgumentException.class, () -> Migrations.jdbcUrl(Map.of(
            "DATABASE_URL", "postgres://backend.example.com/postgres")));
        assertThrows(IllegalArgumentException.class, () -> Migrations.jdbcUrl(Map.of(
            "DSQL_CLUSTER_ENDPOINT", "example.dsql.us-east-2.on.aws", "AWS_REGION", "us-east-1")));
        assertTrue(Migrations.jdbcUrl(Map.of("DSQL_CLUSTER_ENDPOINT", "example.dsql.us-east-2.on.aws",
            "AWS_REGION", "us-east-2")).endsWith("?sslmode=verify-full"));
    }

    @Test void publishedAdapterRecognizesTheRequiredOptions() {
        var config = Migrations.configuration("jdbc:aws-dsql:postgresql://example.dsql.us-east-2.on.aws/postgres");
        var dsql = config.getPluginRegister().getPlugin(DSQLConfigurationExtension.class);
        assertTrue(dsql.isAwaitAsyncIndexes());
        assertEquals(3, dsql.getOccMaxRetries());
    }

    @Test void migrationsContainOneStatementWithoutTransactionWrappers() throws Exception {
        try (var paths = Files.list(Path.of("src/main/resources/db/migration"))) {
            for (var path : paths.toList()) {
                String sql = Files.readString(path);
                var statements = org.postgresql.core.Parser.parseJdbcSql(sql, true, false, true, false, false);
                assertEquals(1, statements.size(), path.toString());
                assertFalse(statements.get(0).nativeSql.strip().toUpperCase()
                    .matches("(?s)^(BEGIN|COMMIT|START TRANSACTION|ROLLBACK)\\b.*"), path.toString());
            }
        }
    }

    // PostgreSQL validates lifecycle/history logic. DSQL transaction/index behavior needs live staging.
    FluentConfiguration database() throws Exception {
        String url = System.getenv("TEST_DATABASE_URL");
        assumeTrue(url != null, "Set TEST_DATABASE_URL to run database integration tests");
        if (!url.startsWith("jdbc:postgresql://") || !url.endsWith("/auth_migrations_test")) {
            throw new IllegalArgumentException("Tests require a disposable auth_migrations_test PostgreSQL database");
        }
        var config = Migrations.configuration(url).dataSource(url, "postgres", "migration-test");
        try (var connection = config.getDataSource().getConnection(); var statement = connection.createStatement()) {
            statement.execute("DROP SCHEMA IF EXISTS users CASCADE");
            statement.execute("DROP TABLE IF EXISTS public." + Migrations.HISTORY);
            statement.execute("DROP TABLE IF EXISTS public.auth_migrations");
        }
        Path migrations = temporary.resolve("migrations");
        Files.createDirectories(migrations);
        try (var paths = Files.list(Path.of("src/main/resources/db/migration"))) {
            for (var path : paths.toList()) {
                Files.writeString(migrations.resolve(path.getFileName()),
                    Files.readString(path).replace("INDEX ASYNC", "INDEX"));
            }
        }
        return config.locations("filesystem:" + migrations);
    }

    void legacyHistory(Connection connection) throws Exception {
        try (var statement = connection.createStatement()) {
            statement.execute("CREATE TABLE public.auth_migrations (name text PRIMARY KEY, run_on timestamp)");
        }
        for (String name : Migrations.LEGACY) {
            try (var statement = connection.prepareStatement(
                    "INSERT INTO public.auth_migrations VALUES (?, '2026-10-29 12:00:00.123456')")) {
                statement.setString(1, "/" + name);
                statement.executeUpdate();
            }
        }
    }

    @Test void freshInstallThenNoOpAndReadOnlyPlan() throws Exception {
        var config = database();
        Path plan = temporary.resolve("plan.json");
        Migrations.execute(config, "plan", plan.toString());
        try (var connection = config.getDataSource().getConnection()) {
            assertFalse(Migrations.exists(connection, "public", Migrations.HISTORY));
            assertFalse(Migrations.exists(connection, "users", "users"));
        }
        assertTrue(Files.readString(plan).contains("\"pending\":18"));
        Migrations.execute(config, "migrate", null);
        Migrations.execute(config, "migrate", null);
        Migrations.execute(config, "verify", null);
        try (var connection = config.getDataSource().getConnection()) {
            assertEquals("18", Migrations.rows(connection,
                "SELECT count(*)::text FROM public." + Migrations.HISTORY).iterator().next());
            legacyHistory(connection);
            Migrations.verifyBaseline(connection);
        }
    }

    @Test void adoptionVerifiesSchemaAndPreservesLegacyTimestamps() throws Exception {
        var config = database();
        Migrations.execute(config, "migrate", null);
        try (var connection = config.getDataSource().getConnection(); var statement = connection.createStatement()) {
            statement.execute("DROP TABLE public." + Migrations.HISTORY);
            legacyHistory(connection);
        }
        // Later migrations must not run as a side effect of baseline adoption.
        Files.writeString(temporary.resolve("migrations/V20261102000000_1__later.sql"),
            "ALTER TABLE users.users ADD COLUMN later text;");
        assertThrows(IllegalStateException.class, () -> Migrations.execute(config, "migrate", null));
        Migrations.execute(config, "plan", temporary.resolve("plan.json").toString());
        Migrations.execute(config, "adopt", null);
        try (var connection = config.getDataSource().getConnection()) {
            Migrations.verifyBaseline(connection);
            assertEquals(1, Migrations.rows(connection, "SELECT version FROM public." + Migrations.HISTORY).size());
            assertEquals("123456", Migrations.rows(connection,
                "SELECT to_char(run_on, 'US') FROM public.auth_migrations").iterator().next());
        }
        assertThrows(IllegalStateException.class, () -> Migrations.execute(config, "adopt", null));
    }

    @Test void driftAndMissingHistoryBlockAdoption() throws Exception {
        var config = database();
        Migrations.execute(config, "migrate", null);
        try (var connection = config.getDataSource().getConnection(); var statement = connection.createStatement()) {
            statement.execute("DROP TABLE public." + Migrations.HISTORY);
            assertThrows(IllegalStateException.class, () -> Migrations.verifyBaseline(connection));
            legacyHistory(connection);
            statement.execute("ALTER TABLE users.api_keys DROP COLUMN expires_at");
            assertThrows(IllegalStateException.class, () -> Migrations.verifyBaseline(connection));
        }
        assertThrows(IllegalStateException.class, () -> Migrations.execute(config, "adopt", null));
    }

    @Test void failedDdlNeverPassesVerificationAndChecksumChangesAreRejected() throws Exception {
        var config = database();
        Migrations.execute(config, "migrate", null);
        Path next = temporary.resolve("migrations/V20261102000000_1__broken.sql");
        Files.writeString(next, "ALTER TABLE users.missing_table ADD COLUMN broken text;");
        assertThrows(Exception.class, () -> Migrations.execute(config, "migrate", null));
        assertThrows(Exception.class, () -> Migrations.execute(config, "verify", null));
        Files.delete(next);
        Path applied = temporary.resolve("migrations/V20250429134858_1__add_username.sql");
        Files.writeString(applied, "ALTER TABLE users.users ADD COLUMN different text;");
        assertThrows(Exception.class, () -> Migrations.execute(config, "plan", null));
    }

    @Test void upgradePlansPendingChangesAndRejectsAnOlderCheckout() throws Exception {
        var config = database();
        Migrations.execute(config, "migrate", null);
        Path next = temporary.resolve("migrations/V20261102000000_1__new_column.sql");
        Files.writeString(next, "COMMENT ON TABLE users.users IS 'Next release';");
        Path plan = temporary.resolve("upgrade.json");
        Migrations.execute(config, "plan", plan.toString());
        assertTrue(Files.readString(plan).contains("\"pending\":1"));
        Migrations.execute(config, "migrate", null);
        Files.delete(next);
        assertThrows(Exception.class, () -> Migrations.execute(config, "plan", null));
    }

    @Test void appliedButUnrecordedDdlStopsInsteadOfBeingSilentlySkipped() throws Exception {
        var config = database();
        Migrations.execute(config, "migrate", null);
        try (var connection = config.getDataSource().getConnection(); var statement = connection.createStatement()) {
            // Simulate the DSQL crash window after DDL commits but before history is written.
            statement.execute("DELETE FROM public." + Migrations.HISTORY
                + " WHERE version = '20261027120000.2'");
        }
        assertThrows(Exception.class, () -> Migrations.execute(config, "migrate", null));
        assertThrows(Exception.class, () -> Migrations.execute(config, "verify", null));
    }

    @Test void historyAloneDoesNotHideMissingSchemaChanges() throws Exception {
        var config = database();
        Migrations.execute(config, "migrate", null);
        try (var connection = config.getDataSource().getConnection(); var statement = connection.createStatement()) {
            statement.execute("ALTER TABLE users.api_keys DROP COLUMN expires_at");
        }
        assertThrows(IllegalStateException.class, () -> Migrations.execute(config, "verify", null));
    }
}

using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CleanSweep.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "users",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    email = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    display_name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    first_seen_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    last_seen_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_users", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "media_items",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(128)", nullable: false),
                    file_name = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    media_type = table.Column<int>(type: "integer", nullable: false),
                    original_blob_path = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    playback_blob_path = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    thumbnail_blob_path = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: true),
                    content_type = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    file_size_bytes = table.Column<long>(type: "bigint", nullable: false),
                    width = table.Column<int>(type: "integer", nullable: true),
                    height = table.Column<int>(type: "integer", nullable: true),
                    duration_seconds = table.Column<double>(type: "double precision", nullable: true),
                    source_codec = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    content_hash = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    captured_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    uploaded_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    processing_status = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    is_deleted = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_media_items", x => x.id);
                    table.ForeignKey(
                        name: "fk_media_items_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "albums",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(128)", nullable: false),
                    name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    description = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true),
                    cover_media_id = table.Column<Guid>(type: "uuid", nullable: true),
                    cover_thumbnail_url = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_albums", x => x.id);
                    table.ForeignKey(
                        name: "fk_albums_media_items_cover_media_id",
                        column: x => x.cover_media_id,
                        principalTable: "media_items",
                        principalColumn: "id",
                        onDelete: ReferentialAction.SetNull);
                    table.ForeignKey(
                        name: "fk_albums_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "album_media",
                columns: table => new
                {
                    album_id = table.Column<Guid>(type: "uuid", nullable: false),
                    media_id = table.Column<Guid>(type: "uuid", nullable: false),
                    sort_order = table.Column<int>(type: "integer", nullable: false, defaultValue: 0)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_album_media", x => new { x.album_id, x.media_id });
                    table.ForeignKey(
                        name: "fk_album_media_albums_album_id",
                        column: x => x.album_id,
                        principalTable: "albums",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_album_media_media_items_media_id",
                        column: x => x.media_id,
                        principalTable: "media_items",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "share_links",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    token = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    album_id = table.Column<Guid>(type: "uuid", nullable: true),
                    media_id = table.Column<Guid>(type: "uuid", nullable: true),
                    created_by_user_id = table.Column<string>(type: "character varying(128)", nullable: false),
                    expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_share_links", x => x.id);
                    table.ForeignKey(
                        name: "fk_share_links_albums_album_id",
                        column: x => x.album_id,
                        principalTable: "albums",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_share_links_media_items_media_id",
                        column: x => x.media_id,
                        principalTable: "media_items",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_share_links_users_created_by_user_id",
                        column: x => x.created_by_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_album_media_media_id",
                table: "album_media",
                column: "media_id");

            migrationBuilder.CreateIndex(
                name: "ix_albums_cover_media_id",
                table: "albums",
                column: "cover_media_id");

            migrationBuilder.CreateIndex(
                name: "ix_albums_user_id",
                table: "albums",
                column: "user_id");

            migrationBuilder.CreateIndex(
                name: "ix_media_items_hash",
                table: "media_items",
                column: "content_hash",
                filter: "content_hash IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_media_items_pending",
                table: "media_items",
                column: "processing_status",
                filter: "processing_status = 1");

            migrationBuilder.CreateIndex(
                name: "ix_media_items_user_captured",
                table: "media_items",
                columns: new[] { "user_id", "captured_at" },
                filter: "is_deleted = false");

            migrationBuilder.CreateIndex(
                name: "ix_share_links_album_id",
                table: "share_links",
                column: "album_id");

            migrationBuilder.CreateIndex(
                name: "ix_share_links_created_by_user_id",
                table: "share_links",
                column: "created_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_share_links_media_id",
                table: "share_links",
                column: "media_id");

            migrationBuilder.CreateIndex(
                name: "ix_share_links_token",
                table: "share_links",
                column: "token",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "album_media");

            migrationBuilder.DropTable(
                name: "share_links");

            migrationBuilder.DropTable(
                name: "albums");

            migrationBuilder.DropTable(
                name: "media_items");

            migrationBuilder.DropTable(
                name: "users");
        }
    }
}

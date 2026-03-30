using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CleanSweep.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddFamilyAndQuota : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "quota_bytes",
                table: "users",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<Guid>(
                name: "family_id",
                table: "albums",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "families",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    name = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    created_by_user_id = table.Column<string>(type: "character varying(128)", nullable: false),
                    invite_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    invite_expires_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    quota_bytes = table.Column<long>(type: "bigint", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_families", x => x.id);
                    table.ForeignKey(
                        name: "fk_families_users_created_by_user_id",
                        column: x => x.created_by_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "family_media",
                columns: table => new
                {
                    family_id = table.Column<Guid>(type: "uuid", nullable: false),
                    media_id = table.Column<Guid>(type: "uuid", nullable: false),
                    shared_by_user_id = table.Column<string>(type: "character varying(128)", nullable: false),
                    shared_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_family_media", x => new { x.family_id, x.media_id });
                    table.ForeignKey(
                        name: "fk_family_media_families_family_id",
                        column: x => x.family_id,
                        principalTable: "families",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_family_media_media_items_media_id",
                        column: x => x.media_id,
                        principalTable: "media_items",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_family_media_users_shared_by_user_id",
                        column: x => x.shared_by_user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "family_members",
                columns: table => new
                {
                    family_id = table.Column<Guid>(type: "uuid", nullable: false),
                    user_id = table.Column<string>(type: "character varying(128)", nullable: false),
                    role = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "member"),
                    joined_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_family_members", x => new { x.family_id, x.user_id });
                    table.ForeignKey(
                        name: "fk_family_members_families_family_id",
                        column: x => x.family_id,
                        principalTable: "families",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "fk_family_members_users_user_id",
                        column: x => x.user_id,
                        principalTable: "users",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "ix_albums_family_id",
                table: "albums",
                column: "family_id");

            migrationBuilder.CreateIndex(
                name: "ix_families_created_by_user_id",
                table: "families",
                column: "created_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_families_invite_code",
                table: "families",
                column: "invite_code",
                unique: true,
                filter: "invite_code IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_family_media_media_id",
                table: "family_media",
                column: "media_id");

            migrationBuilder.CreateIndex(
                name: "ix_family_media_shared_by_user_id",
                table: "family_media",
                column: "shared_by_user_id");

            migrationBuilder.CreateIndex(
                name: "ix_family_members_user_id",
                table: "family_members",
                column: "user_id");

            migrationBuilder.AddForeignKey(
                name: "fk_albums_families_family_id",
                table: "albums",
                column: "family_id",
                principalTable: "families",
                principalColumn: "id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_albums_families_family_id",
                table: "albums");

            migrationBuilder.DropTable(
                name: "family_media");

            migrationBuilder.DropTable(
                name: "family_members");

            migrationBuilder.DropTable(
                name: "families");

            migrationBuilder.DropIndex(
                name: "ix_albums_family_id",
                table: "albums");

            migrationBuilder.DropColumn(
                name: "quota_bytes",
                table: "users");

            migrationBuilder.DropColumn(
                name: "family_id",
                table: "albums");
        }
    }
}

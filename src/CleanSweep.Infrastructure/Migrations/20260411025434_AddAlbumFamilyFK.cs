using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CleanSweep.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddAlbumFamilyFK : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_albums_families_family_id",
                table: "albums");

            migrationBuilder.AddForeignKey(
                name: "fk_albums_families_family_id",
                table: "albums",
                column: "family_id",
                principalTable: "families",
                principalColumn: "id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "fk_albums_families_family_id",
                table: "albums");

            migrationBuilder.AddForeignKey(
                name: "fk_albums_families_family_id",
                table: "albums",
                column: "family_id",
                principalTable: "families",
                principalColumn: "id");
        }
    }
}

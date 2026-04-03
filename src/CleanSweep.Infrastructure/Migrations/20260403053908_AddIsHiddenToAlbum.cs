using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace CleanSweep.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddIsHiddenToAlbum : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "is_hidden",
                table: "albums",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "is_hidden",
                table: "albums");
        }
    }
}
